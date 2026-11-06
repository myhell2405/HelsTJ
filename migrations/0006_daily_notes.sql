CREATE TABLE IF NOT EXISTS admin_daily_notes (
  note_date TEXT PRIMARY KEY CHECK (length(note_date) = 10),
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
