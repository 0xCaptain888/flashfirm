CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  principal TEXT NOT NULL,
  blob TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL
);
CREATE INDEX push_membership ON push_subscriptions(organization,principal,enabled);
CREATE TRIGGER push_device_limit_insert BEFORE INSERT ON push_subscriptions
WHEN NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM push_subscriptions WHERE id=NEW.id)
AND (SELECT count(*) FROM push_subscriptions WHERE organization=NEW.organization AND principal=NEW.principal AND enabled=1)>=3
BEGIN SELECT RAISE(ABORT,'PUSH_DEVICE_LIMIT'); END;
CREATE TRIGGER push_device_limit_update BEFORE UPDATE ON push_subscriptions
WHEN NEW.enabled=1 AND OLD.enabled=0
AND (SELECT count(*) FROM push_subscriptions WHERE organization=NEW.organization AND principal=NEW.principal AND enabled=1)>=3
BEGIN SELECT RAISE(ABORT,'PUSH_DEVICE_LIMIT'); END;
CREATE TABLE push_outbox (
  id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL REFERENCES push_subscriptions(id),
  blob TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','SENDING','ACCEPTED','FAILED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  retry_at INTEGER NOT NULL,
  created INTEGER NOT NULL
);
