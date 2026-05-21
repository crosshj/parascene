/**
 * Shared notification row link/click rules (chat SPA + bundled app).
 * Keep in sync with public/shared/notificationNav.js.
 */

/** @param {{ link?: string | null, creation_id?: number | null }} n */
export function notificationCreationHref(n) {
	if (!n) return null;
	const link = typeof n.link === "string" ? n.link.trim() : "";
	if (/^\/creations\/\d+/.test(link)) return link;
	if (n.creation_id != null && Number.isFinite(Number(n.creation_id))) {
		return `/creations/${Number(n.creation_id)}`;
	}
	return null;
}

/** @param {{ link?: string | null }} n */
export function notificationChatHref(n) {
	if (!n) return null;
	const link = typeof n.link === "string" ? n.link.trim() : "";
	if (/^\/chat\//.test(link)) return link;
	return null;
}

/** @param {{ link?: string | null, creation_id?: number | null }} n */
export function notificationPrimaryHref(n) {
	return notificationChatHref(n) || notificationCreationHref(n);
}

const CREATION_CLICK_TYPES = new Set([
	"comment",
	"comment_thread",
	"tip",
	"creation_mention",
	"comment_mention",
	"creation_activity"
]);

/** @param {{ type?: string | null, link?: string | null, creation_id?: number | null }} n */
export function notificationPrimaryClickable(n) {
	if (!n) return false;
	if (n.type === "tip") return true;
	if (n.type === "chat_mention" && notificationChatHref(n)) return true;
	const href = notificationCreationHref(n);
	return !!href && n.type != null && CREATION_CLICK_TYPES.has(n.type);
}
