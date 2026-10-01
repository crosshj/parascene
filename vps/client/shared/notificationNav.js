/** Shared notification target rules adapted to the VPS SPA router. */

/** @param {{ link?: string | null, creation_id?: number | null }} notification */
export function notificationCreationHref(notification) {
	if (!notification) return null;
	const link = typeof notification.link === 'string' ? notification.link.trim() : '';
	if (/^\/creations\/\d+/.test(link)) return link;
	if (notification.creation_id != null && Number.isFinite(Number(notification.creation_id))) {
		return `/creations/${Number(notification.creation_id)}`;
	}
	return null;
}

/** @param {{ link?: string | null }} notification */
export function notificationChatHref(notification) {
	if (!notification) return null;
	const link = typeof notification.link === 'string' ? notification.link.trim() : '';
	return /^\/chat\//.test(link) ? link : null;
}

/** @param {{ link?: string | null, creation_id?: number | null }} notification */
export function notificationPrimaryHref(notification) {
	return notificationChatHref(notification) || notificationCreationHref(notification);
}

const CREATION_CLICK_TYPES = new Set([
	'comment',
	'comment_thread',
	'tip',
	'creation_mention',
	'comment_mention',
	'creation_activity',
]);

export function notificationPrimaryClickable(notification) {
	if (!notification) return false;
	if (notification.type === 'tip' || notification.type === 'credits') return true;
	if (notification.type === 'chat_mention' && notificationChatHref(notification)) return true;
	const href = notificationCreationHref(notification);
	return Boolean(href && notification.type != null && CREATION_CLICK_TYPES.has(notification.type));
}

export function navigateNotificationPrimaryHref(notification) {
	const href = notificationPrimaryHref(notification);
	if (!href) return false;
	document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href } }));
	return true;
}
