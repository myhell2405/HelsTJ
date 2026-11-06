CREATE TABLE IF NOT EXISTS public_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS public_suggestions_pending
  ON public_suggestions(status, submitted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS suggestion_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  submission_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS suggestion_rate_limits_expiry
  ON suggestion_rate_limits(window_started_at);
