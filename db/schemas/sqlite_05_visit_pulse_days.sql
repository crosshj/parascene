-- Visit pulse: one row per UTC day (summary columns + details JSON for timeline drill-down).

CREATE TABLE IF NOT EXISTS visit_pulse_days (
  day TEXT NOT NULL PRIMARY KEY,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  authed_visitors INTEGER NOT NULL DEFAULT 0,
  anon_visitors INTEGER NOT NULL DEFAULT 0,
  total_hits INTEGER NOT NULL DEFAULT 0,
  total_active_blocks INTEGER NOT NULL DEFAULT 0,
  flushed_at TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT NOT NULL DEFAULT '{}'
);
