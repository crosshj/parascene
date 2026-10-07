export const NOTIFICATION_PREVIEW_LIMIT = 5;

export function isDirectMessageMention(row) {
	return row?.type === 'chat_mention' && /^\/chat\/dm\//.test(String(row?.link || '').trim());
}

export function notificationDestination(row) {
	const link = typeof row?.link === 'string' ? row.link.trim() : '';
	if (link.startsWith('/') && !link.startsWith('//')) return link;
	const creationId = Number(row?.creation_id);
	return Number.isInteger(creationId) && creationId > 0 ? `/creations/${creationId}` : '';
}

// Unread notes fill the preview first. Recent read notes use whatever room is left.
export function notificationPreview(rows, limit = NOTIFICATION_PREVIEW_LIMIT) {
	const visible = (Array.isArray(rows) ? rows : []).filter((row) => !isDirectMessageMention(row));
	const unread = visible.filter((row) => !row?.acknowledged_at);
	const read = visible.filter((row) => row?.acknowledged_at);
	const room = Math.max(0, Number(limit) || 0);
	return [...unread.slice(0, room), ...read.slice(0, Math.max(0, room - Math.min(unread.length, room)))];
}

export function notificationSlots(rows, limit = NOTIFICATION_PREVIEW_LIMIT) {
	const preview = notificationPreview(rows, limit);
	const room = Math.max(0, Number(limit) || 0);
	return Array.from({ length: room }, (_, index) => preview[index] || null);
}
