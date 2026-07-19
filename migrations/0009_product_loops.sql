PRAGMA foreign_keys = ON;

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('student', 'guardian')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (identity_provider, identity_subject),
  UNIQUE (email, role)
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bootstrap_key_hash TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'guardian')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, principal_id)
);

ALTER TABLE demo_sessions ADD COLUMN principal_id TEXT REFERENCES principals(id);
ALTER TABLE demo_sessions ADD COLUMN household_id TEXT REFERENCES households(id);
ALTER TABLE demo_sessions ADD COLUMN student_id TEXT REFERENCES principals(id);
ALTER TABLE demo_sessions ADD COLUMN guardian_id TEXT REFERENCES principals(id);

CREATE INDEX demo_sessions_principal_idx ON demo_sessions(principal_id, expires_at);
CREATE INDEX household_members_principal_idx ON household_members(principal_id, household_id);

CREATE TABLE focus_blocks (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  course_name TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  selected_minutes INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  completed_chunk_ids_json TEXT NOT NULL,
  completed_chunk_count INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX focus_blocks_student_completed_idx ON focus_blocks(student_id, completed_at DESC);

CREATE TABLE rate_limit_windows (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX rate_limit_windows_expiry_idx ON rate_limit_windows(expires_at);

CREATE TABLE guardian_digest_deliveries (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  notification_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'sent', 'failed')),
  provider_message_id TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE school_supply_items ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'item'
  CHECK (item_kind IN ('item', 'group_label', 'separator'));

CREATE TABLE live_day_plan_versions (
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  approved_plan_json TEXT NOT NULL,
  approval_args_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (session_id, plan_version)
);

CREATE INDEX live_day_plan_student_history_idx
  ON live_day_plan_versions(approved_by, approved_at DESC);
