-- Comment reactions: one row per (comment, user, emoji_key).
-- Run after supabase_01.sql (prsn_comments_created_image must exist).

CREATE TABLE IF NOT EXISTS prsn_comment_reactions (
	comment_id bigint NOT NULL REFERENCES prsn_comments_created_image(id) ON DELETE CASCADE,
	user_id bigint NOT NULL REFERENCES prsn_users(id) ON DELETE CASCADE,
	emoji_key text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE(comment_id, user_id, emoji_key)
);

CREATE INDEX IF NOT EXISTS idx_prsn_comment_reactions_comment_id
	ON prsn_comment_reactions(comment_id);

CREATE INDEX IF NOT EXISTS idx_prsn_comment_reactions_user_id
	ON prsn_comment_reactions(user_id);

ALTER TABLE prsn_comment_reactions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE prsn_comment_reactions IS 'Parascene: emoji reactions on comments. One per (comment, user, emoji_key). RLS enabled without policies - only service role can access.';
