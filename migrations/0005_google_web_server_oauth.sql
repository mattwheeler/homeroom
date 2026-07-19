CREATE TABLE source_oauth_states_web (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'google_classroom'),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO source_oauth_states_web (
  id, state_hash, session_id, provider, expires_at, consumed_at, created_at
)
SELECT id, state_hash, session_id, provider, expires_at, consumed_at, created_at
FROM source_oauth_states;

DROP TABLE source_oauth_states;

ALTER TABLE source_oauth_states_web RENAME TO source_oauth_states;

CREATE INDEX source_oauth_states_lookup_idx
  ON source_oauth_states(state_hash, session_id, expires_at, consumed_at);
