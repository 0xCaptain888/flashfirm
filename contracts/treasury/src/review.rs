// Immutable timing rules. Units are nanoseconds on chain; tests use integers.
#[derive(Clone, Debug)]
pub struct ReviewGate {
    pub review_deadline: u64,
    pub appeal_window: u64,
    pub arbitration_deadline: u64,
    pub release_at: Option<u64>,
    pub challenged: bool,
    pub resolved: bool,
    pub upheld: bool,
}
impl ReviewGate {
    pub fn quorum(&mut self, now: u64) -> Result<(), &'static str> {
        if self.release_at.is_some() || now >= self.review_deadline { return Err("Invalid quorum time"); }
        self.release_at = Some(now.checked_add(self.appeal_window).ok_or("Time overflow")?);
        Ok(())
    }
    pub fn challenge(&mut self, now: u64) -> Result<(), &'static str> {
        let cutoff = self.release_at.unwrap_or(self.review_deadline);
        if self.challenged || self.resolved || now >= cutoff { return Err("Challenge window closed"); }
        self.challenged = true;
        Ok(())
    }
    pub fn resolve(&mut self, uphold: bool, now: u64) -> Result<(), &'static str> {
        if !self.challenged || self.resolved || now >= self.arbitration_deadline { return Err("Resolution unavailable"); }
        if uphold && self.release_at.is_none() { return Err("Cannot uphold without quorum"); }
        self.resolved = true; self.upheld = uphold;
        Ok(())
    }
    pub fn can_release(&self, now: u64) -> bool {
        self.release_at.is_some_and(|at| now >= at) && (!self.challenged || (self.resolved && self.upheld))
    }
    pub fn timed_out(&self, now: u64) -> bool { self.challenged && !self.resolved && now >= self.arbitration_deadline }
}
#[cfg(test)]
mod tests {
 use super::*;
 fn gate()->ReviewGate { ReviewGate{review_deadline:100,appeal_window:20,arbitration_deadline:200,release_at:None,challenged:false,resolved:false,upheld:false} }
 #[test] fn approval_waits_for_window(){let mut g=gate();g.quorum(50).unwrap();assert!(!g.can_release(69));assert!(g.can_release(70));assert!(g.challenge(70).is_err());}
 #[test] fn challenge_blocks_until_pinned_arbitration(){let mut g=gate();g.quorum(50).unwrap();g.challenge(69).unwrap();assert!(!g.can_release(150));g.resolve(true,150).unwrap();assert!(g.can_release(150));assert!(g.resolve(false,151).is_err());}
 #[test] fn rejection_never_releases(){let mut g=gate();g.quorum(50).unwrap();g.challenge(60).unwrap();g.resolve(false,61).unwrap();assert!(!g.can_release(500));assert!(!g.timed_out(500));}
 #[test] fn nonresponsive_arbiter_has_bounded_timeout(){let mut g=gate();g.challenge(50).unwrap();assert!(g.resolve(true,60).is_err());assert!(!g.timed_out(199));assert!(g.timed_out(200));assert!(g.resolve(false,200).is_err());assert!(!g.can_release(200));}
 #[test] fn challenge_before_quorum_remains_blocking(){let mut g=gate();g.challenge(20).unwrap();g.quorum(30).unwrap();assert!(!g.can_release(50));g.resolve(true,40).unwrap();assert!(!g.can_release(49));assert!(g.can_release(50));}
}
