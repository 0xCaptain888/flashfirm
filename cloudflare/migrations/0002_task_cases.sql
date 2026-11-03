CREATE TABLE task_cases(firm TEXT PRIMARY KEY REFERENCES firms(id),task_root TEXT NOT NULL,receipt_hash TEXT NOT NULL,blob TEXT NOT NULL);
CREATE TABLE notification_acks(firm TEXT NOT NULL REFERENCES firms(id),id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(firm,id));
CREATE TRIGGER case_active BEFORE INSERT ON task_cases
WHEN (SELECT state FROM firms WHERE id=NEW.firm)!='ACTIVE'
BEGIN SELECT RAISE(ABORT,'WORKSPACE_CLOSED'); END;
CREATE TRIGGER case_immutable BEFORE UPDATE ON task_cases
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CASE'); END;
CREATE TRIGGER case_review_binding BEFORE INSERT ON task_cases
WHEN EXISTS(SELECT 1 FROM reviews WHERE firm=NEW.firm AND
 (json_extract(body,'$.commitment.policy.taskRoot')!=NEW.task_root OR json_extract(body,'$.resultRoot')!=NEW.receipt_hash))
BEGIN SELECT RAISE(ABORT,'CASE_REVIEW_MISMATCH'); END;
CREATE TRIGGER review_case_binding_insert BEFORE INSERT ON reviews
WHEN EXISTS(SELECT 1 FROM task_cases WHERE firm=NEW.firm AND
 (task_root!=json_extract(NEW.body,'$.commitment.policy.taskRoot') OR receipt_hash!=json_extract(NEW.body,'$.resultRoot')))
BEGIN SELECT RAISE(ABORT,'CASE_REVIEW_MISMATCH'); END;
CREATE TRIGGER review_case_binding_update BEFORE UPDATE ON reviews
WHEN EXISTS(SELECT 1 FROM task_cases WHERE firm=NEW.firm AND
 (task_root!=json_extract(NEW.body,'$.commitment.policy.taskRoot') OR receipt_hash!=json_extract(NEW.body,'$.resultRoot')))
BEGIN SELECT RAISE(ABORT,'CASE_REVIEW_MISMATCH'); END;
