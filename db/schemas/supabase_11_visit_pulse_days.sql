-- Visit pulse: one row per UTC day (summary columns + details jsonb for timeline drill-down).

CREATE TABLE IF NOT EXISTS prsn_visit_pulse_days (
  day date PRIMARY KEY,
  unique_visitors integer NOT NULL DEFAULT 0,
  authed_visitors integer NOT NULL DEFAULT 0,
  anon_visitors integer NOT NULL DEFAULT 0,
  total_hits integer NOT NULL DEFAULT 0,
  total_active_blocks integer NOT NULL DEFAULT 0,
  flushed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE prsn_visit_pulse_days ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE prsn_visit_pulse_days IS 'Parascene: daily visit pulse rollup from Redis (15-min activity ranges per visitor in details). Summary columns for cross-day trends; details for same-day timeline.';
