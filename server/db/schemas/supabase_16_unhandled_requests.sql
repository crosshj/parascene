-- Route misses seen by the app. One row per method, path pattern, host, and instance.
-- Query values, cookies, and bodies are not stored.
-- Apply before the admin Unhandled page can list rows. The app still returns 404 if this table is missing.

CREATE TABLE IF NOT EXISTS prsn_unhandled_requests (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	method text NOT NULL,
	path_key text NOT NULL,
	host text NOT NULL,
	app_version text NOT NULL,
	hit_count integer NOT NULL DEFAULT 0,
	first_seen_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	query_keys text,
	user_agent text,
	UNIQUE (method, path_key, host, app_version)
);

CREATE INDEX IF NOT EXISTS prsn_unhandled_requests_last_seen_idx
	ON prsn_unhandled_requests (last_seen_at DESC);

ALTER TABLE prsn_unhandled_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE prsn_unhandled_requests IS 'Parascene: aggregated API and OAuth route misses. RLS enabled without policies — only the service role can access. No query values, cookies, or bodies.';
