ALTER TABLE demo_sessions ADD COLUMN identity_provider TEXT CHECK (identity_provider IS NULL OR identity_provider = 'google');
ALTER TABLE demo_sessions ADD COLUMN identity_subject TEXT;
ALTER TABLE demo_sessions ADD COLUMN identity_email TEXT;

CREATE INDEX demo_sessions_identity_idx
  ON demo_sessions(identity_provider, identity_subject, role, expires_at);
