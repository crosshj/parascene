-- Google Photos connection (per-user). Run after supabase_01.sql and OAuth tables.

CREATE TABLE IF NOT EXISTS prsn_google_photos_connections (
	user_id bigint PRIMARY KEY REFERENCES prsn_users(id) ON DELETE CASCADE,
	refresh_token_enc text NOT NULL,
	scopes text NOT NULL DEFAULT '',
	album_id text,
	album_title text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	revoked_at timestamptz,
	meta jsonb
);

CREATE INDEX IF NOT EXISTS idx_prsn_google_photos_connections_revoked_at
	ON prsn_google_photos_connections(revoked_at);

ALTER TABLE prsn_google_photos_connections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE prsn_google_photos_connections IS 'Parascene: per-user Google Photos OAuth connection and default album.';

