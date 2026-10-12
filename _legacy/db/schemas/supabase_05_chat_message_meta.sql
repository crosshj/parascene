-- Optional metadata on chat messages (e.g. founder "canvas" with title in meta.canvas.title, body in message body).

ALTER TABLE prsn_chat_messages
	ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN prsn_chat_messages.meta IS 'Parascene chat: extension JSON (e.g. canvas title in meta.canvas.title; body in message body).';

CREATE INDEX IF NOT EXISTS idx_prsn_chat_messages_thread_canvas
	ON prsn_chat_messages (thread_id, created_at DESC, id DESC)
	WHERE meta ? 'canvas';
