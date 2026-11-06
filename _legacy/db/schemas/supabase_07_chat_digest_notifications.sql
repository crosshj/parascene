-- Email digest + notification helpers for chat (run after supabase_04_chat_read_state.sql).

-- Distinct users who have at least one unread message from someone else, with that message
-- created on or after p_since (used by the notifications cron digest window).
CREATE OR REPLACE FUNCTION prsn_chat_user_ids_with_digestible_unread(p_since timestamptz)
RETURNS TABLE (user_id bigint)
LANGUAGE sql
STABLE
AS $$
	SELECT DISTINCT m.user_id
	FROM prsn_chat_members m
	WHERE EXISTS (
		SELECT 1
		FROM prsn_chat_messages msg
		WHERE msg.thread_id = m.thread_id
			AND msg.sender_id <> m.user_id
			AND msg.created_at >= p_since
			AND (
				m.last_read_message_id IS NULL
				OR msg.id > m.last_read_message_id
			)
	);
$$;

COMMENT ON FUNCTION prsn_chat_user_ids_with_digestible_unread(timestamptz) IS 'Parascene: user ids eligible for chat section in activity digest (recent unread from others).';

-- Top threads with digestible unread for one user (same recency rule as user_ids RPC).
CREATE OR REPLACE FUNCTION prsn_chat_digest_unread_threads(p_user_id bigint, p_since timestamptz, p_limit int)
RETURNS TABLE (
	thread_id bigint,
	thread_type text,
	channel_slug text,
	dm_pair_key text,
	unread_count bigint
)
LANGUAGE sql
STABLE
AS $$
	SELECT
		t.id,
		t.type,
		t.channel_slug,
		t.dm_pair_key,
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
	WHERE m.user_id = p_user_id
		AND EXISTS (
			SELECT 1
			FROM prsn_chat_messages msg
			WHERE msg.thread_id = m.thread_id
				AND msg.sender_id <> p_user_id
				AND msg.created_at >= p_since
				AND (
					m.last_read_message_id IS NULL
					OR msg.id > m.last_read_message_id
				)
		)
	ORDER BY (
		SELECT MAX(msg2.created_at)
		FROM prsn_chat_messages msg2
		WHERE msg2.thread_id = t.id
			AND msg2.sender_id <> p_user_id
			AND (
				m.last_read_message_id IS NULL
				OR msg2.id > m.last_read_message_id
			)
	) DESC NULLS LAST
	LIMIT GREATEST(1, LEAST(COALESCE(NULLIF(p_limit, 0), 8), 24));
$$;

COMMENT ON FUNCTION prsn_chat_digest_unread_threads(bigint, timestamptz, int) IS 'Parascene: thread rows with recent unread for digest email (ordered by latest unread activity).';
