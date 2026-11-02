use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult};
mod ledger;
mod review;
use ledger::{Ledger, Phase};
use review::ReviewGate;

// One task per contract account. Funding currency is native NEAR, not USD.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Treasury {
    buyer: AccountId,
    evaluators: Vec<AccountId>,
    recipients: Vec<AccountId>,
    task_root: String,
    plan_hash: Option<String>,
    evidence_root: Option<String>,
    deadline: u64,
    phase: u8,
    funded: u128,
    credits: Vec<u128>,
    pending: Vec<u128>,
    paid: u128,
    approvals: [bool; 3],
    arbiter: AccountId,
    policy_hash: String,
    appeal_window: u64,
    arbitration_deadline: u64,
    release_at: Option<u64>,
    challenge_root: Option<String>,
    resolution_root: Option<String>,
    resolution_upheld: bool,
}

#[near(serializers = [json])]
pub struct Status {
    version: String,
    arbiter: AccountId,
    policy_hash: String,
    appeal_window_ns: String,
    arbitration_deadline_ns: String,
    release_at_ns: Option<String>,
    challenge_root: Option<String>,
    resolution_root: Option<String>,
    resolution_upheld: bool,
    release_allowed: bool,
    buyer: AccountId,
    evaluators: Vec<AccountId>,
    recipients: Vec<AccountId>,
    task_root: String,
    plan_hash: Option<String>,
    evidence_root: Option<String>,
    deadline_ns: String,
    phase: String,
    funded_yocto: U128,
    credits_yocto: Vec<U128>,
    pending_yocto: Vec<U128>,
    paid_yocto: U128,
    approvals: [bool; 3],
}

#[near]
impl Treasury {
    #[init]
    pub fn new(
        buyer: AccountId,
        evaluators: Vec<AccountId>,
        recipients: Vec<AccountId>,
        task_root: String,
        deadline_ns: String,
        arbiter: AccountId,
        policy_hash: String,
        appeal_window_ns: String,
        arbitration_window_ns: String,
    ) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "Initialize from the deployment account"
        );
        assert_eq!(evaluators.len(), 3, "Exactly three evaluators required");
        assert!(
            (1..=16).contains(&recipients.len()),
            "Invalid recipient count"
        );
        assert!(
            recipients.contains(&buyer),
            "Buyer must be a recipient for refunds"
        );
        for (i, account) in evaluators.iter().enumerate() {
            assert!(!evaluators[..i].contains(account), "Duplicate evaluator");
            assert!(
                account != &buyer && !recipients.contains(account),
                "Evaluators must be distinct from buyer and recipients"
            );
        }
        for (i, account) in recipients.iter().enumerate() {
            assert!(!recipients[..i].contains(account), "Duplicate recipient");
            assert_ne!(
                account,
                &env::current_account_id(),
                "Treasury cannot be a recipient"
            );
        }
        Self::check_hash(&task_root);
        Self::check_hash(&policy_hash);
        assert!(arbiter != buyer && arbiter != env::current_account_id() && !evaluators.contains(&arbiter) && !recipients.contains(&arbiter), "Arbiter must be distinct from all task parties");
        let appeal_window = appeal_window_ns.parse::<u64>().expect("Invalid appeal window");
        let arbitration_window = arbitration_window_ns.parse::<u64>().expect("Invalid arbitration window");
        assert!((60_000_000_000..=604_800_000_000_000).contains(&appeal_window), "Appeal window must be 60 seconds to 7 days");
        assert!((60_000_000_000..=604_800_000_000_000).contains(&arbitration_window), "Arbitration window must be 60 seconds to 7 days");
        let deadline = deadline_ns.parse::<u64>().expect("Invalid deadline");
        assert!(
            deadline > env::block_timestamp(),
            "Deadline must be in future"
        );
        Self {
            arbiter, policy_hash, appeal_window,
            arbitration_deadline: deadline.checked_add(appeal_window).and_then(|n| n.checked_add(arbitration_window)).expect("Deadline overflow"),
            release_at: None, challenge_root: None, resolution_root: None, resolution_upheld: false,
            buyer,
            evaluators,
            recipients: recipients.clone(),
            task_root,
            plan_hash: None,
            evidence_root: None,
            deadline,
            phase: 0,
            funded: 0,
            credits: vec![0; recipients.len()],
            pending: vec![0; recipients.len()],
            paid: 0,
            approvals: [false; 3],
        }
    }
    #[payable]
    pub fn fund(&mut self) {
        assert_eq!(env::predecessor_account_id(), self.buyer, "Buyer only");
        let mut l = self.ledger();
        l.fund(
            env::attached_deposit().as_yoctonear(),
            env::block_timestamp(),
        )
        .expect("Cannot fund");
        self.apply(l);
    }
    pub fn propose(&mut self, amounts_yocto: Vec<U128>, evidence_root: String) -> String {
        assert_eq!(
            env::predecessor_account_id(),
            self.buyer,
            "Buyer approves recipient allocation"
        );
        Self::check_hash(&evidence_root);
        let amounts: Vec<u128> = amounts_yocto.iter().map(|n| n.0).collect();
        let mut l = self.ledger();
        l.propose(amounts, env::block_timestamp())
            .expect("Invalid proposal");
        let encoded = near_sdk::serde_json::to_vec(&(
            "flashfirm-treasury/0.2",
            env::current_account_id(),
            &self.task_root,
            &self.recipients,
            &amounts_yocto,
            &evidence_root,
            &self.policy_hash,
            &self.arbiter,
            self.appeal_window,
            self.arbitration_deadline,
        ))
        .unwrap();
        let digest = env::sha256(&encoded)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        self.plan_hash = Some(digest.clone());
        self.evidence_root = Some(evidence_root);
        self.apply(l);
        digest
    }
    pub fn approve(&mut self, plan_hash: String) {
        assert_eq!(
            self.plan_hash.as_ref(),
            Some(&plan_hash),
            "Plan hash mismatch"
        );
        let index = self
            .evaluators
            .iter()
            .position(|a| a == &env::predecessor_account_id())
            .expect("Evaluator only");
        let mut l = self.ledger();
        l.approve(index, env::block_timestamp())
            .expect("Invalid approval");
        if l.phase == Phase::Approved {
            let mut gate = self.review_gate();
            gate.quorum(env::block_timestamp()).expect("Invalid release window");
            self.release_at = gate.release_at;
        }
        self.apply(l);
    }
    pub fn challenge(&mut self, plan_hash: String, reason_root: String) {
        assert_eq!(self.plan_hash.as_ref(), Some(&plan_hash), "Plan hash mismatch");
        Self::check_hash(&reason_root);
        let caller = env::predecessor_account_id();
        assert!(self.recipients.contains(&caller) || self.evaluators.contains(&caller), "Task party only");
        assert!(matches!(self.ledger().phase, Phase::Reviewing | Phase::Approved), "No reviewable plan");
        let mut gate = self.review_gate();
        gate.challenge(env::block_timestamp()).expect("Challenge unavailable");
        self.challenge_root = Some(reason_root);
    }
    pub fn resolve_challenge(&mut self, plan_hash: String, challenge_root: String, uphold: bool, resolution_root: String) {
        assert_eq!(env::predecessor_account_id(), self.arbiter, "Pinned arbiter only");
        assert_eq!(self.plan_hash.as_ref(), Some(&plan_hash), "Plan hash mismatch");
        assert_eq!(self.challenge_root.as_ref(), Some(&challenge_root), "Challenge mismatch");
        Self::check_hash(&resolution_root);
        assert!(matches!(self.ledger().phase, Phase::Reviewing | Phase::Approved), "Plan closed");
        let mut gate = self.review_gate();
        gate.resolve(uphold, env::block_timestamp()).expect("Resolution unavailable");
        self.resolution_root = Some(resolution_root);
        self.resolution_upheld = uphold;
        if !uphold {
            let mut l = self.ledger(); l.reject_plan(self.buyer_index()).expect("Refund rejected"); self.apply(l);
        }
    }
    pub fn make_refund_available(&mut self) {
        assert_eq!(env::predecessor_account_id(), self.buyer, "Buyer only");
        let mut l = self.ledger();
        if self.review_gate().timed_out(env::block_timestamp()) {
            l.reject_plan(self.buyer_index()).expect("Dispute timeout refund unavailable");
            self.apply(l); return;
        }
        assert!(self.challenge_root.is_none(), "Pending challenge uses arbitration timeout");
        l.refund(
            self.recipients
                .iter()
                .position(|a| a == &self.buyer)
                .unwrap(),
            env::block_timestamp(),
        )
        .expect("Refund unavailable");
        self.apply(l);
    }
    pub fn claim(&mut self) -> Promise {
        let recipient = env::predecessor_account_id();
        self.claim_for(recipient)
    }
    // Anyone may pay the gas for a fixed recipient. The caller cannot redirect
    // funds or change the approved amount; this also supports recovery retries.
    pub fn claim_for(&mut self, recipient: AccountId) -> Promise {
        let index = self
            .recipients
            .iter()
            .position(|a| a == &recipient)
            .expect("Recipient not allowlisted");
        let mut l = self.ledger();
        if l.phase == Phase::Approved {
            assert!(self.review_gate().can_release(env::block_timestamp()), "Appeal window or challenge blocks payment");
        }
        let amount = l.claim(index).expect("Claim unavailable");
        self.apply(l);
        Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_claim".into(),
                    near_sdk::serde_json::to_vec(
                        &near_sdk::serde_json::json!({"recipient_index":index}),
                    )
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(10),
                ),
            )
    }
    #[private]
    pub fn on_claim(&mut self, recipient_index: usize) -> bool {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Expected one transfer result"
        );
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        let mut l = self.ledger();
        l.resolve(recipient_index, success)
            .expect("No pending transfer");
        self.apply(l);
        success
    }
    pub fn get_status(&self) -> Status {
        Status {
            version: "flashfirm-treasury/0.2".into(),
            arbiter: self.arbiter.clone(), policy_hash: self.policy_hash.clone(),
            appeal_window_ns: self.appeal_window.to_string(), arbitration_deadline_ns: self.arbitration_deadline.to_string(),
            release_at_ns: self.release_at.map(|n| n.to_string()), challenge_root: self.challenge_root.clone(),
            resolution_root: self.resolution_root.clone(), resolution_upheld: self.resolution_upheld,
            release_allowed: self.ledger().phase == Phase::Approved && self.review_gate().can_release(env::block_timestamp()),
            buyer: self.buyer.clone(),
            evaluators: self.evaluators.clone(),
            recipients: self.recipients.clone(),
            task_root: self.task_root.clone(),
            plan_hash: self.plan_hash.clone(),
            evidence_root: self.evidence_root.clone(),
            deadline_ns: self.deadline.to_string(),
            phase: format!("{:?}", self.ledger().phase),
            funded_yocto: U128(self.funded),
            credits_yocto: self.credits.iter().map(|n| U128(*n)).collect(),
            pending_yocto: self.pending.iter().map(|n| U128(*n)).collect(),
            paid_yocto: U128(self.paid),
            approvals: self.approvals,
        }
    }
}

impl Treasury {
    fn buyer_index(&self) -> usize { self.recipients.iter().position(|a| a == &self.buyer).unwrap() }
    fn review_gate(&self) -> ReviewGate {
        ReviewGate { review_deadline: self.deadline, appeal_window: self.appeal_window, arbitration_deadline: self.arbitration_deadline, release_at: self.release_at, challenged: self.challenge_root.is_some(), resolved: self.resolution_root.is_some(), upheld: self.resolution_upheld }
    }
    fn check_hash(value: &str) {
        assert!(
            value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()),
            "Expected SHA-256 hex"
        );
    }
    fn ledger(&self) -> Ledger {
        Ledger {
            phase: match self.phase {
                0 => Phase::Empty,
                1 => Phase::Funded,
                2 => Phase::Reviewing,
                3 => Phase::Approved,
                4 => Phase::RefundAvailable,
                _ => Phase::Closed,
            },
            funded: self.funded,
            credits: self.credits.clone(),
            pending: self.pending.clone(),
            paid: self.paid,
            approvals: self.approvals,
            deadline: self.deadline,
        }
    }
    fn apply(&mut self, l: Ledger) {
        self.phase = match l.phase {
            Phase::Empty => 0,
            Phase::Funded => 1,
            Phase::Reviewing => 2,
            Phase::Approved => 3,
            Phase::RefundAvailable => 4,
            Phase::Closed => 5,
        };
        self.funded = l.funded;
        self.credits = l.credits;
        self.pending = l.pending;
        self.paid = l.paid;
        self.approvals = l.approvals;
    }
}
