CREATE TABLE IF NOT EXISTS admin_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES admin_todos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_todos_parent_id ON admin_todos(parent_id, id);

INSERT INTO admin_todos (id, parent_id, title) VALUES
  (1, NULL, 'Proyek Rika Andriani'),
  (2, 1, 'Buat 4 CV'),
  (3, 2, 'CV Versi Business Analyst (BA) / IT Business Analyst'),
  (4, 2, 'CV Versi Data Analyst / Junior Data Analyst'),
  (5, 2, 'CV Versi System Analyst / IT Support & Operations Specialist'),
  (6, 2, 'CV Versi Software Developer (Web / Full-Stack Junior)'),
  (7, 1, 'Rapikan all of my job board'),
  (8, 7, 'LinkedIn'),
  (9, 7, 'Kalibrr'),
  (10, 7, 'Indeed'),
  (11, 7, 'Jobstreet'),
  (12, 7, 'Karirhub'),
  (13, 7, 'Glints'),
  (14, 1, 'Rapikan email untuk job hunter'),
  (15, 1, 'Realisasikan CV.');
