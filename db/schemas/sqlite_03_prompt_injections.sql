-- Prompt injection tags (run after sqlite_01.sql / sqlite_02.sql). Mirrors prsn_prompt_injections: tag = slug only; sigil from tag_type.

CREATE TABLE IF NOT EXISTS prompt_injections (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	tag TEXT NOT NULL,
	tag_type TEXT NOT NULL,
	injection_text TEXT NOT NULL,
	title TEXT,
	description TEXT,
	meta TEXT,
	owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
	visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'unlisted')),
	priority INTEGER NOT NULL DEFAULT 0,
	replaces_global INTEGER NOT NULL DEFAULT 0 CHECK (replaces_global IN (0, 1)),
	deleted_at TEXT,
	published_at TEXT,
	moderation_status TEXT,
	reviewed_at TEXT,
	forked_from_id INTEGER REFERENCES prompt_injections(id) ON DELETE SET NULL,
	usage_count INTEGER NOT NULL DEFAULT 0,
	last_used_at TEXT,
	locale TEXT,
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP INDEX IF EXISTS idx_prompt_injections_tag_lower;
DROP INDEX IF EXISTS idx_prompt_injections_tag_global_unique;
DROP INDEX IF EXISTS idx_prompt_injections_tag_user_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_injections_tag_global_unique
	ON prompt_injections (lower(tag), tag_type)
	WHERE owner_user_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_injections_tag_user_unique
	ON prompt_injections (owner_user_id, lower(tag), tag_type)
	WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_injections_tag_type_active
	ON prompt_injections (tag_type)
	WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_prompt_injections_owner
	ON prompt_injections (owner_user_id)
	WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_injections_public_listing
	ON prompt_injections (visibility, tag_type, lower(tag))
	WHERE visibility = 'public' AND deleted_at IS NULL AND is_active = 1;
