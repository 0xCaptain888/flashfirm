CREATE TABLE task_flows (
  firm TEXT PRIMARY KEY REFERENCES firms(id),
  blob TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE task_payment_claims (
  chain TEXT NOT NULL,
  hash TEXT NOT NULL,
  firm TEXT,
  invoice TEXT NOT NULL,
  PRIMARY KEY(chain,hash)
);
CREATE TABLE recovery_holds (firm TEXT PRIMARY KEY);
-- The historical independent demonstration can never become a task payout.
INSERT INTO task_payment_claims VALUES('near','Hmd9xudaq3CZz8emgddqAWfQtfgAkNsNx26oEWbJaKJn',NULL,'INDEPENDENT_DEMONSTRATION');
INSERT INTO task_payment_claims VALUES('0xa4b1','0xa461af7a19f1fced4ed75e1c177250adfc07c87088d21ac2de0126c8864ad014',NULL,'INDEPENDENT_DEMONSTRATION');
CREATE TRIGGER task_flow_active_insert BEFORE INSERT ON task_flows
WHEN (SELECT state FROM firms WHERE id=NEW.firm)!='ACTIVE'
BEGIN SELECT RAISE(ABORT,'WORKSPACE_CLOSED'); END;
CREATE TRIGGER task_flow_active_update BEFORE UPDATE ON task_flows
WHEN (SELECT state FROM firms WHERE id=NEW.firm)!='ACTIVE'
BEGIN SELECT RAISE(ABORT,'WORKSPACE_CLOSED'); END;
