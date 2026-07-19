CREATE TABLE guardian_student_settings (
  guardian_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  settings_version INTEGER NOT NULL CHECK (settings_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guardian_id, student_id)
);

CREATE INDEX guardian_student_settings_student_idx
  ON guardian_student_settings(student_id, updated_at);
