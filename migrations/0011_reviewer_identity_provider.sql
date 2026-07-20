ALTER TABLE demo_sessions ADD COLUMN identity_provider_v2 TEXT
  CHECK (identity_provider_v2 IS NULL OR identity_provider_v2 IN ('google', 'judge'));

UPDATE demo_sessions
SET identity_provider_v2 = identity_provider
WHERE identity_provider IS NOT NULL;

CREATE INDEX demo_sessions_identity_v2_idx
  ON demo_sessions(identity_provider_v2, identity_subject, role, expires_at);
