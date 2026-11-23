/**
 * Group recent notifications about the same creation into one summary row.
 * Older rows stay individual so the full history is not folded together.
 */

const COLLAPSE_TYPES = new Set([
	'comment',
	'comment_thread',
	'tip',
	'creation_mention',
	'comment_mention',
]);

const RECENT_WITHIN_HOURS = 24;

function parseJson(value) {
	if (value == null) return null;
	if (typeof value === 'object') return value;
	if (typeof value !== 'string') return null;
	try { return JSON.parse(value); } catch { return null; }
}

export function getCreationIdFromRow(row) {
	const target = parseJson(row?.target);
	const targetId = target?.creation_id;
	if (targetId != null && Number.isFinite(Number(targetId))) return Number(targetId);
	const link = typeof row?.link === 'string' ? row.link.trim() : '';
	const match = link.match(/^\/creations\/(\d+)/);
	if (!match?.[1]) return null;
	const id = Number(match[1]);
	return Number.isFinite(id) ? id : null;
}

function getRecentCutoffIso(hoursAgo = RECENT_WITHIN_HOURS) {
	const date = new Date();
	date.setHours(date.getHours() - hoursAgo);
	return date.toISOString();
}

function creationTitleFromRow(row) {
	const meta = parseJson(row?.meta);
	const title = typeof meta?.creation_title === 'string' ? meta.creation_title.trim() : '';
	return title || null;
}

export function notificationForCollapse(row) {
	const creationId = row?.creation_id != null && Number.isFinite(Number(row.creation_id))
		? Number(row.creation_id)
		: getCreationIdFromRow(row);
	return {
		id: row?.id,
		title: row?.title,
		message: row?.message,
		link: row?.link ?? null,
		type: row?.type ?? null,
		created_at: row?.created_at,
		acknowledged_at: row?.acknowledged_at ?? null,
		creation_id: creationId,
		creation_title: creationTitleFromRow(row),
	};
}

function stripForResponse(notification) {
	const creationId = notification.creation_id != null && Number.isFinite(Number(notification.creation_id))
		? Number(notification.creation_id)
		: getCreationIdFromRow(notification);
	return {
		id: notification.id,
		title: notification.title,
		message: notification.message,
		link: notification.link,
		type: notification.type ?? null,
		created_at: notification.created_at,
		acknowledged_at: notification.acknowledged_at,
		...(creationId != null ? { creation_id: creationId } : {}),
	};
}

export function collapseNotificationsByCreation(notifications) {
	const cutoff = getRecentCutoffIso();
	const recent = [];
	const older = [];
	for (const notification of notifications || []) {
		if ((notification.created_at || '').localeCompare(cutoff) >= 0) recent.push(notification);
		else older.push(notification);
	}

	const byCreation = new Map();
	const ungroupedRecent = [];
	for (const notification of recent) {
		const creationId = notification.creation_id ?? null;
		const canCollapse = creationId != null && notification.type && COLLAPSE_TYPES.has(notification.type);
		if (!canCollapse) {
			ungroupedRecent.push(notification);
			continue;
		}
		if (!byCreation.has(creationId)) byCreation.set(creationId, []);
		byCreation.get(creationId).push(notification);
	}

	const collapsed = [];
	for (const group of byCreation.values()) {
		group.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
		if (group.length === 1) {
			ungroupedRecent.push(group[0]);
			continue;
		}
		const latest = group[0];
		const commentCount = group.filter((notification) => notification.type === 'comment' || notification.type === 'comment_thread').length;
		const tipCount = group.filter((notification) => notification.type === 'tip').length;
		const parts = [];
		if (commentCount > 0) parts.push(commentCount === 1 ? '1 comment' : `${commentCount} comments`);
		if (tipCount > 0) parts.push(tipCount === 1 ? '1 tip' : `${tipCount} tips`);
		const creationTitle = typeof latest.creation_title === 'string' && latest.creation_title.trim()
			? latest.creation_title.trim()
			: null;
		const collapsedCreationId = latest.creation_id != null && Number.isFinite(Number(latest.creation_id))
			? Number(latest.creation_id)
			: getCreationIdFromRow(latest);
		collapsed.push({
			id: latest.id,
			title: creationTitle ? `Activity on "${creationTitle}"` : 'Activity on your creation',
			message: parts.length ? parts.join(', ') : 'New activity',
			link: latest.link,
			type: 'creation_activity',
			created_at: latest.created_at,
			acknowledged_at: group.every((notification) => notification.acknowledged_at) ? latest.acknowledged_at : null,
			count: group.length,
			unread_count: group.filter((notification) => !notification.acknowledged_at).length,
			...(collapsedCreationId != null ? { creation_id: collapsedCreationId } : {}),
		});
	}

	const unreadFirstThenCreated = (a, b) => {
		const aUnread = !a.acknowledged_at;
		const bUnread = !b.acknowledged_at;
		if (aUnread !== bUnread) return bUnread - aUnread;
		return (b.created_at || '').localeCompare(a.created_at || '');
	};
	const recentResult = [...collapsed, ...ungroupedRecent.map(stripForResponse)];
	recentResult.sort(unreadFirstThenCreated);
	const olderResult = older.map(stripForResponse);
	olderResult.sort(unreadFirstThenCreated);
	return [...recentResult, ...olderResult];
}

/** Link used to clear every notification represented by one collapsed creation row. */
export function creationAckLink(row) {
	const type = typeof row?.type === 'string' ? row.type.trim() : '';
	if (!COLLAPSE_TYPES.has(type)) return null;
	const creationId = getCreationIdFromRow(row);
	if (creationId == null) return null;
	return `/creations/${creationId}`;
}
