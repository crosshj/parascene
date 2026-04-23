/**
 * Client cache for "Audible notifications" (chat unread sound).
 * Mirrors server `meta.audibleNotifications` from GET /api/profile; default is on.
 */

export const CHAT_AUDIBLE_NOTIFICATIONS_STORAGE_KEY = 'chatAudibleNotificationsEnabled';

export function getChatAudibleNotificationsEnabled() {
	try {
		const v = window.localStorage?.getItem(CHAT_AUDIBLE_NOTIFICATIONS_STORAGE_KEY);
		if (v === '0' || v === 'false') return false;
		if (v === '1' || v === 'true') return true;
		return true;
	} catch {
		return true;
	}
}

export function setChatAudibleNotificationsEnabled(on) {
	try {
		window.localStorage?.setItem(CHAT_AUDIBLE_NOTIFICATIONS_STORAGE_KEY, on ? '1' : '0');
	} catch {
		// ignore
	}
}

/** `undefined` / missing from API → default true (matches server). */
export function hydrateChatAudibleNotificationsFromServer(serverValue) {
	const on = serverValue !== false;
	setChatAudibleNotificationsEnabled(on);
}

export function clearChatAudibleNotificationsStorage() {
	try {
		window.localStorage?.removeItem(CHAT_AUDIBLE_NOTIFICATIONS_STORAGE_KEY);
	} catch {
		// ignore
	}
}
