CREATE TABLE source_oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'google_classroom'),
  code_verifier_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX source_oauth_states_lookup_idx
  ON source_oauth_states(state_hash, session_id, expires_at, consumed_at);

CREATE TABLE source_connections (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_classroom', 'band_ical')),
  status TEXT NOT NULL CHECK (status IN ('active', 'error', 'revoked')),
  display_name TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  last_sync_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, provider)
);

CREATE INDEX source_connections_student_idx
  ON source_connections(student_id, provider, status);

CREATE TABLE source_courses (
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'google_classroom'),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT,
  subject TEXT,
  course_state TEXT NOT NULL CHECK (course_state = 'ACTIVE'),
  alternate_link TEXT,
  calendar_external_id TEXT,
  track_course_id TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (student_id, provider, external_id)
);

CREATE INDEX source_courses_track_idx
  ON source_courses(student_id, track_course_id, synced_at);

CREATE TABLE source_coursework (
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'google_classroom'),
  course_external_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  work_type TEXT,
  due_date TEXT,
  due_time TEXT,
  alternate_link TEXT,
  source_updated_at TEXT,
  submission_state TEXT,
  late INTEGER,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (student_id, provider, course_external_id, external_id)
);

CREATE INDEX source_coursework_due_idx
  ON source_coursework(student_id, due_date, due_time);

CREATE TABLE source_calendar_events (
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'band_ical'),
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  status TEXT,
  source_updated_at TEXT,
  feed_hash TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (student_id, provider, uid)
);

CREATE INDEX source_calendar_events_upcoming_idx
  ON source_calendar_events(student_id, starts_at);
