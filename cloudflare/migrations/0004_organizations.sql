CREATE TABLE organizations (id TEXT PRIMARY KEY,title TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE organization_members (
  organization TEXT NOT NULL REFERENCES organizations(id),
  principal TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','EDITOR','VIEWER')),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(organization,principal)
);
CREATE TABLE organization_sessions (
  hash TEXT PRIMARY KEY REFERENCES tokens(hash),
  organization TEXT NOT NULL,
  principal TEXT NOT NULL,
  FOREIGN KEY(organization,principal) REFERENCES organization_members(organization,principal)
);
CREATE TABLE organization_invites (
  hash TEXT PRIMARY KEY,
  organization TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('EDITOR','VIEWER')),
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
