-- Channel default canvas: prsn_chat_threads.meta.canvas.pinned_message_id (message id). API reads/writes meta.

ALTER TABLE prsn_chat_threads
	ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

