/**
 * Which notification rows belong in the global bell (SPA + legacy).
 * Chat owns DM UX — DM chat_mention rows stay in DB for history but are hidden here.
 */

function parseJsonField(value) {
	if (value == null) return null;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 * @param {{ type?: string | null, meta?: string | object | null, target?: string | object | null, link?: string | null }} row
 * @returns {boolean}
 */
export function isDmChatMentionNotification(row) {
	if (row?.type !== "chat_mention") return false;
	const meta = parseJsonField(row?.meta);
	if (String(meta?.thread_type || "").trim() === "dm") return true;
	const target = parseJsonField(row?.target);
	if (String(target?.thread_type || "").trim() === "dm") return true;
	const link = typeof row?.link === "string" ? row.link.trim() : "";
	return /^\/chat\/dm\//.test(link);
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
export function filterNotificationsForBell(rows) {
	return (rows ?? []).filter((row) => !isDmChatMentionNotification(row));
}

/**
 * @param {object[]} rows
 * @returns {number}
 */
export function countUnreadNotificationsForBell(rows) {
	return filterNotificationsForBell(rows).filter((row) => !row?.acknowledged_at).length;
}
