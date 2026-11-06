-- Optional reply context and future comment extensions stored as JSON.
-- Run after supabase_02_comments.sql.

ALTER TABLE public.prsn_comments_created_image
	ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.prsn_comments_created_image.meta IS 'Parascene: comment extensions (e.g. meta.reply). API merges; service role access.';
