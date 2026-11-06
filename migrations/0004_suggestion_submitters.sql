ALTER TABLE public_suggestions
  ADD COLUMN submitter_name TEXT NOT NULL DEFAULT '';

ALTER TABLE public_suggestions
  ADD COLUMN relationship TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS suggestion_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_username TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS suggestion_review_log_created_at
  ON suggestion_review_log(created_at DESC, id DESC);
