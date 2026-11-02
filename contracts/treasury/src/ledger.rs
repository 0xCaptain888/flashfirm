// Pure accounting model. Compiles and tests without an SDK or network.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    Empty,
    Funded,
    Reviewing,
    Approved,
    RefundAvailable,
    Closed,
}

#[derive(Clone, Debug)]
pub struct Ledger {
    pub phase: Phase,
    pub funded: u128,
    pub credits: Vec<u128>,
    pub pending: Vec<u128>,
    pub paid: u128,
    pub approvals: [bool; 3],
    pub deadline: u64,
}

impl Ledger {
    pub fn new(recipients: usize, deadline: u64) -> Self {
        assert!((1..=16).contains(&recipients), "Invalid recipient count");
        Self {
            phase: Phase::Empty,
            funded: 0,
            credits: vec![0; recipients],
            pending: vec![0; recipients],
            paid: 0,
            approvals: [false; 3],
            deadline,
        }
    }
    pub fn fund(&mut self, amount: u128, now: u64) -> Result<(), &'static str> {
        if self.phase != Phase::Empty || amount == 0 || now >= self.deadline {
            return Err("Cannot fund");
        }
        self.funded = amount;
        self.phase = Phase::Funded;
        Ok(())
    }
    pub fn propose(&mut self, amounts: Vec<u128>, now: u64) -> Result<(), &'static str> {
        if self.phase != Phase::Funded
            || now >= self.deadline
            || amounts.len() != self.credits.len()
        {
            return Err("Cannot propose");
        }
        let total = amounts
            .iter()
            .try_fold(0u128, |sum, value| sum.checked_add(*value))
            .ok_or("Overflow")?;
        if total != self.funded {
            return Err("Budget not conserved");
        }
        self.credits = amounts;
        self.phase = Phase::Reviewing;
        Ok(())
    }
    pub fn approve(&mut self, evaluator: usize, now: u64) -> Result<(), &'static str> {
        if self.phase != Phase::Reviewing || evaluator >= 3 || now >= self.deadline {
            return Err("Cannot approve");
        }
        if self.approvals[evaluator] {
            return Err("Duplicate approval");
        }
        self.approvals[evaluator] = true;
        if self.approvals.iter().filter(|&&value| value).count() >= 2 {
            self.phase = Phase::Approved;
        }
        Ok(())
    }
    pub fn refund(&mut self, buyer_index: usize, now: u64) -> Result<(), &'static str> {
        if !matches!(self.phase, Phase::Funded | Phase::Reviewing)
            || now < self.deadline
            || buyer_index >= self.credits.len()
        {
            return Err("Cannot refund");
        }
        self.credits.fill(0);
        self.credits[buyer_index] = self.funded;
        self.phase = Phase::RefundAvailable;
        Ok(())
    }
    pub fn claim(&mut self, recipient: usize) -> Result<u128, &'static str> {
        if !matches!(self.phase, Phase::Approved | Phase::RefundAvailable)
            || recipient >= self.credits.len()
        {
            return Err("Cannot claim");
        }
        let amount = self.credits[recipient];
        if amount == 0 || self.pending[recipient] != 0 {
            return Err("No available claim");
        }
        self.credits[recipient] = 0;
        self.pending[recipient] = amount;
        Ok(amount)
    }
    pub fn resolve(&mut self, recipient: usize, success: bool) -> Result<(), &'static str> {
        if recipient >= self.pending.len() || self.pending[recipient] == 0 {
            return Err("No pending transfer");
        }
        let amount = self.pending[recipient];
        self.pending[recipient] = 0;
        if success {
            self.paid = self.paid.checked_add(amount).ok_or("Overflow")?;
        } else {
            self.credits[recipient] = amount;
        }
        if self.paid == self.funded {
            self.phase = Phase::Closed;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn approved() -> Ledger {
        let mut l = Ledger::new(4, 100);
        l.fund(1000, 1).unwrap();
        l.propose(vec![0, 500, 250, 250], 2).unwrap();
        l.approve(0, 3).unwrap();
        l.approve(1, 4).unwrap();
        l
    }
    fn conserved(l: &Ledger) {
        assert_eq!(
            l.credits.iter().sum::<u128>() + l.pending.iter().sum::<u128>() + l.paid,
            l.funded
        );
    }
    #[test]
    fn duplicate_approval_cannot_form_quorum() {
        let mut l = Ledger::new(2, 100);
        l.fund(100, 1).unwrap();
        l.propose(vec![0, 100], 2).unwrap();
        l.approve(0, 3).unwrap();
        assert!(l.approve(0, 4).is_err());
        assert!(l.claim(1).is_err());
    }
    #[test]
    fn payout_requires_complete_budget() {
        let mut l = Ledger::new(2, 100);
        l.fund(100, 1).unwrap();
        assert!(l.propose(vec![0, 99], 2).is_err());
        assert_eq!(l.phase, Phase::Funded);
    }
    #[test]
    fn proposal_is_immutable_after_first_vote() {
        let mut l = approved();
        assert!(l.propose(vec![1000, 0, 0, 0], 5).is_err());
    }
    #[test]
    fn failed_transfer_restores_credit() {
        let mut l = approved();
        assert_eq!(l.claim(1).unwrap(), 500);
        assert!(l.claim(1).is_err());
        conserved(&l);
        l.resolve(1, false).unwrap();
        conserved(&l);
        assert_eq!(l.claim(1).unwrap(), 500);
        l.resolve(1, true).unwrap();
        conserved(&l);
        assert!(l.claim(1).is_err());
    }
    #[test]
    fn closes_only_after_all_callbacks_succeed() {
        let mut l = approved();
        for i in 1..4 {
            l.claim(i).unwrap();
        }
        assert_eq!(l.phase, Phase::Approved);
        for i in 1..4 {
            l.resolve(i, true).unwrap();
            conserved(&l);
        }
        assert_eq!(l.phase, Phase::Closed);
    }
    #[test]
    fn buyer_refund_after_deadline() {
        let mut l = Ledger::new(2, 100);
        l.fund(100, 1).unwrap();
        l.propose(vec![0, 100], 2).unwrap();
        l.approve(0, 3).unwrap();
        assert!(l.refund(0, 99).is_err());
        l.refund(0, 100).unwrap();
        assert!(l.approve(1, 100).is_err());
        assert_eq!(l.claim(0).unwrap(), 100);
        l.resolve(0, true).unwrap();
        assert_eq!(l.phase, Phase::Closed);
    }
    #[test]
    fn cannot_refund_approved_obligations() {
        let mut l = approved();
        assert!(l.refund(0, 101).is_err());
        conserved(&l);
    }
    #[test]
    fn arithmetic_overflow_is_rejected() {
        let mut l = Ledger::new(2, 100);
        l.fund(u128::MAX, 1).unwrap();
        assert!(l.propose(vec![u128::MAX, 1], 2).is_err());
    }
    #[test]
    fn funds_and_callbacks_cannot_be_replayed() {
        let mut l = approved();
        assert!(l.fund(1, 9).is_err());
        l.claim(1).unwrap();
        l.resolve(1, true).unwrap();
        assert!(l.resolve(1, true).is_err());
        conserved(&l);
    }
}
