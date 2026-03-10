-- Comment reactions: one row per (comment, user, emoji_key).
-- Run after sqlite_01.sql (comments_created_image must exist).

CREATE TABLE IF NOT EXISTS comment_reactions (
	comment_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	emoji_key TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (comment_id) REFERENCES comments_created_image(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	UNIQUE(comment_id, user_id, emoji_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id
	ON comment_reactions(comment_id);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_user_id
	ON comment_reactions(user_id);
