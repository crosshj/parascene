-- Chat read state: per-member last read pointer + unread counts (run after supabase_03_chat.sql).

ALTER TABLE prsn_chat_members
	ADD COLUMN IF NOT EXISTS last_read_message_id bigint REFERENCES prsn_chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prsn_chat_members_user_thread_read
	ON prsn_chat_members(user_id, thread_id);

COMMENT ON COLUMN prsn_chat_members.last_read_message_id IS 'Parascene: last message id the user has read in this thread (unread = messages from others with id > this).';

-- Postgres does not allow changing the OUT/RETURNS row shape with CREATE OR REPLACE; drop first.
DROP FUNCTION IF EXISTS prsn_chat_threads_for_user(bigint);

CREATE OR REPLACE FUNCTION prsn_chat_threads_for_user(p_user_id bigint)
RETURNS TABLE (
	thread_id bigint,
	thread_type text,
	dm_pair_key text,
	channel_slug text,
	thread_created_at timestamptz,
	last_message_at timestamptz,
	last_message_body text,
	last_sender_id bigint,
	last_message_id bigint,
	last_read_message_id bigint,
	unread_count bigint
)
LANGUAGE sql
STABLE
AS $$
	SELECT
		t.id,
		t.type,
		t.dm_pair_key,
		t.channel_slug,
		t.created_at,
		lm.created_at,
		lm.body,
		lm.sender_id,
		lm.id,
		m.last_read_message_id,
		(
			SELECT COUNT(*)::bigint
			FROM prsn_chat_messages m3
			WHERE m3.thread_id = t.id
				AND m3.sender_id <> p_user_id
				AND (
					m.last_read_message_id IS NULL
					OR m3.id > m.last_read_message_id
				)
		) AS unread_count
	FROM prsn_chat_members m
	INNER JOIN prsn_chat_threads t ON t.id = m.thread_id
	LEFT JOIN LATERAL (
		SELECT m2.id, m2.created_at, m2.body, m2.sender_id
		FROM prsn_chat_messages m2
		WHERE m2.thread_id = t.id
		ORDER BY m2.created_at DESC, m2.id DESC
		LIMIT 1
	) lm ON true
	WHERE m.user_id = p_user_id
	ORDER BY COALESCE(lm.created_at, t.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION prsn_chat_unread_total(p_user_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
	SELECT COALESCE(SUM(s.cnt), 0)::bigint
	FROM (
		SELECT (
			SELECT COUNT(*)::bigint
			FROM prsn_chat_messages m3
			WHERE m3.thread_id = m.thread_id
				AND m3.sender_id <> p_user_id
				AND (
					m.last_read_message_id IS NULL
					OR m3.id > m.last_read_message_id
				)
		) AS cnt
		FROM prsn_chat_members m
		WHERE m.user_id = p_user_id
	) s;
$$;
