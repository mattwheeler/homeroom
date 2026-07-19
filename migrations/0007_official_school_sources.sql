CREATE TABLE school_source_connections (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('school_calendar', 'school_supplies')),
  status TEXT NOT NULL CHECK (status IN ('active', 'error', 'revoked')),
  display_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  secondary_source_url TEXT,
  last_sync_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, provider, source_url)
);

CREATE INDEX school_source_connections_student_idx
  ON school_source_connections(student_id, provider, status);

CREATE TABLE school_calendar_events (
  connection_id TEXT NOT NULL REFERENCES school_source_connections(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  category TEXT NOT NULL CHECK (category IN ('school_closed', 'student_holiday', 'early_release', 'registration', 'school_event')),
  audience TEXT NOT NULL CHECK (audience IN ('all_students', 'elementary', 'staff')),
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_updated_at TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, uid)
);

CREATE INDEX school_calendar_events_student_date_idx
  ON school_calendar_events(student_id, starts_at, category);

CREATE TABLE school_supply_lists (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE REFERENCES school_source_connections(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE school_supply_items (
  list_id TEXT NOT NULL REFERENCES school_supply_lists(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  text TEXT NOT NULL,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  source_ordinal INTEGER NOT NULL CHECK (source_ordinal > 0),
  PRIMARY KEY (list_id, item_id)
);

CREATE INDEX school_supply_items_order_idx
  ON school_supply_items(list_id, source_ordinal);
