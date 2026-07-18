PRAGMA foreign_keys = ON;

CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  seed_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'guardian')),
  state_json TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  source_version INTEGER NOT NULL,
  active_plan_version INTEGER,
  csrf_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE plan_versions (
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL,
  source_version INTEGER NOT NULL,
  proposal_json TEXT NOT NULL,
  approved_plan_json TEXT NOT NULL,
  approval_args_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (session_id, plan_version)
);

CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  expected_state_version INTEGER NOT NULL,
  expected_plan_version INTEGER NOT NULL,
  expected_source_version INTEGER NOT NULL,
  approval_nonce_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  result_json TEXT
);

CREATE TABLE practice_results (
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  status TEXT NOT NULL,
  hints_used INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  validated_steps_json TEXT NOT NULL,
  final_answer TEXT,
  completed_at TEXT,
  PRIMARY KEY (session_id, exercise_id)
);

CREATE TABLE guardian_projections (
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  projection_version INTEGER NOT NULL,
  projection_json TEXT NOT NULL,
  projection_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (session_id, projection_version)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  source_record_ids_json TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, sequence)
);

CREATE TABLE ai_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  openai_response_ids_json TEXT NOT NULL,
  tool_trace_json TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX demo_sessions_expiry_idx ON demo_sessions(expires_at);
CREATE INDEX audit_events_session_idx ON audit_events(session_id, sequence);
CREATE INDEX ai_turns_session_idx ON ai_turns(session_id, created_at);
