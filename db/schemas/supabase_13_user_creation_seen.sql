-- Feed [beta] viewport seen state: one row per (viewer, creation).
-- Run after supabase_01.sql (prsn_users, prsn_created_images must exist).
--
-- Raw impression events are not stored here; this table is the per-user rollup
-- (first/last seen, counts, interaction timestamps). Use meta for attribution
-- snapshots (source_pool, position, feed_session_id, surface, etc.).

CREATE TABLE IF NOT EXISTS prsn_user_creation_seen (
	user_id bigint NOT NULL REFERENCES prsn_users(id) ON DELETE CASCADE,
	creation_id bigint NOT NULL REFERENCES prsn_created_images(id) ON DELETE CASCADE,
	first_seen_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
	clicked_at timestamptz,
	liked_at timestamptz,
	commented_at timestamptz,
	replied_at timestamptz,
	meta jsonb NOT NULL DEFAULT '{}'::jsonb,
	PRIMARY KEY (user_id, creation_id)
);

CREATE INDEX IF NOT EXISTS idx_prsn_user_creation_seen_user_last_seen
	ON prsn_user_creation_seen(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_prsn_user_creation_seen_creation_id
	ON prsn_user_creation_seen(creation_id);

ALTER TABLE prsn_user_creation_seen ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE prsn_user_creation_seen IS 'Parascene: feed viewport seen rollup per viewer and creation. Upsert on qualified impression; interaction timestamps set when the viewer clicks/likes/comments/replies. meta holds extensible attribution (source_pool, position, feed_session_id, surface). RLS enabled without policies — service role / API only.';
