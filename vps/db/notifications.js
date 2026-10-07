const NOTIFICATIONS_TABLE = "prsn_notifications";
const NOTIFICATION_FIELDS = "id, user_id, role, title, message, link, created_at, acknowledged_at, actor_user_id, type, target, meta";

function parseJsonField(value) {
	if (value == null) return null;
	if (typeof value === 'object') return value;
	if (typeof value !== 'string') return null;
	try { return JSON.parse(value); } catch { return null; }
}

// Direct-message mentions already count as message unread, so the bell skips them.
export function isDmChatMentionNotification(row) {
	if (row?.type !== 'chat_mention') return false;
	const meta = parseJsonField(row?.meta);
	if (String(meta?.thread_type || '').trim() === 'dm') return true;
	const target = parseJsonField(row?.target);
	if (String(target?.thread_type || '').trim() === 'dm') return true;
	const link = typeof row?.link === 'string' ? row.link.trim() : '';
	return /^\/chat\/dm\//.test(link);
}

function attentionItem(row) {
	const title = String(row?.title || '').trim() || String(row?.message || '').trim() || row?.type || 'Notification';
	return {
		id: row?.id ?? null,
		type: row?.type || '',
		title,
		link: typeof row?.link === 'string' ? row.link : '',
	};
}

// Bell count keeps channel mentions. Tab attention leaves every chat mention out,
// because those messages are already in the threads unread summary.
export function summarizeNotificationUnread(rows) {
	const unread = (rows || []).filter((row) => !row?.acknowledged_at);
	const visible = unread.filter((row) => !isDmChatMentionNotification(row));
	const mentions = visible.filter((row) => row?.type === 'chat_mention');
	const attention = visible.filter((row) => row?.type !== 'chat_mention');
	return {
		count: visible.length,
		attention: attention.length,
		items: attention.map(attentionItem),
		skipped: [
			...unread.filter(isDmChatMentionNotification).map((row) => ({ ...attentionItem(row), reason: 'direct message mention, already in unread messages' })),
			...mentions.map((row) => ({ ...attentionItem(row), reason: 'chat mention, already in unread messages' })),
		],
	};
}

function scoped(query, userId, role) {
	const clauses = [`user_id.eq.${Number(userId)}`];
	if (typeof role === "string" && role.trim()) clauses.push(`role.eq.${role.trim()}`);
	return query.or(clauses.join(","));
}

export function createNotificationsStore(client) {
	return {
		async list(userId, role, { limit = 25 } = {}) {
			const safeLimit = Math.min(200, Math.max(1, Number(limit) || 25));
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).select(NOTIFICATION_FIELDS),
				userId,
				role
			).order("created_at", { ascending: false }).limit(safeLimit);
			if (error) throw error;
			return data || [];
		},

		async acknowledge(userId, role, id) {
			const notificationId = Number(id);
			if (!Number.isInteger(notificationId) || notificationId <= 0) return 0;
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).update({ acknowledged_at: new Date().toISOString() }).eq("id", notificationId),
				userId,
				role
			).select("id");
			if (error) throw error;
			return data?.length || 0;
		},

		async unreadCount(userId, role) {
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).select('id, type, title, message, meta, target, link, acknowledged_at').is('acknowledged_at', null),
				userId,
				role
			).limit(200);
			if (error) throw error;
			return summarizeNotificationUnread(data);
		},

		async acknowledgeAll(userId, role) {
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).update({ acknowledged_at: new Date().toISOString() }).is("acknowledged_at", null),
				userId,
				role
			).select("id");
			if (error) throw error;
			return data?.length || 0;
		}
	};
}
