CREATE TABLE mail_subscriptions (
  organization TEXT NOT NULL,
  principal TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL,
  PRIMARY KEY(organization,principal)
);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  blob TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','SENDING','DELIVERED','FAILED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  retry_at INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE operations_health (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  checked INTEGER NOT NULL
);
