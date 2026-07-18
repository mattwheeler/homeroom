CREATE TABLE learning_sessions (
  id TEXT PRIMARY KEY,
  demo_session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (10, 15, 20)),
  support_preference TEXT NOT NULL CHECK (support_preference IN ('example_first', 'questions_first', 'mix_it_up')),
  source_label TEXT NOT NULL,
  started_at TEXT NOT NULL,
  target_ends_at TEXT NOT NULL,
  completed_at TEXT,
  turn_count INTEGER NOT NULL,
  context_json TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX learning_sessions_one_active_idx
  ON learning_sessions(demo_session_id)
  WHERE status = 'active';

CREATE INDEX learning_sessions_student_course_idx
  ON learning_sessions(student_id, course_id, started_at);

CREATE TABLE learner_signals (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  scope_course_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  statement TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_learning_session_id TEXT NOT NULL REFERENCES learning_sessions(id),
  confidence REAL NOT NULL,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  learned_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, scope_course_id, signal_type, statement)
);

CREATE INDEX learner_signals_context_idx
  ON learner_signals(student_id, scope_course_id, status, expires_at);

CREATE TABLE learning_progress (
  student_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('exploring', 'practicing')),
  sessions_completed INTEGER NOT NULL,
  last_session_at TEXT NOT NULL,
  next_review_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (student_id, course_id, objective_id)
);

CREATE TABLE learner_memory_events (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('signal_saved', 'signal_deleted')),
  actor_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX learner_memory_events_student_idx
  ON learner_memory_events(student_id, created_at);
