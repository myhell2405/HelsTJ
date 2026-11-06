CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('job_added', 'job_edited', 'job_deleted', 'user_added', 'user_deleted')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS activity_log_created_at ON activity_log(created_at DESC, id DESC);
