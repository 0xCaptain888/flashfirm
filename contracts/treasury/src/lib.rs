use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult};
mod ledger;
use ledger::{Ledger, Phase};

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
}

#[near(serializers = [json])]
pub struct Status {
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
        let deadline = deadline_ns.parse::<u64>().expect("Invalid deadline");
        assert!(
            deadline > env::block_timestamp(),
            "Deadline must be in future"
        );
        Self {
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
            "flashfirm-treasury/0.1",
            env::current_account_id(),
            &self.task_root,
            &self.recipients,
            &amounts_yocto,
            &evidence_root,
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
        self.apply(l);
    }
    pub fn make_refund_available(&mut self) {
        assert_eq!(env::predecessor_account_id(), self.buyer, "Buyer only");
        let mut l = self.ledger();
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
