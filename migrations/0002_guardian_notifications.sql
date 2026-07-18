CREATE TABLE guardian_notifications (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  task_record_id TEXT NOT NULL,
  notification_json TEXT NOT NULL,
  approval_args_hash TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (session_id, notification_type, task_record_id)
);

CREATE INDEX guardian_notifications_recipient_idx
  ON guardian_notifications(recipient_id, sent_at);
