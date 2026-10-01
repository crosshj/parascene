/**
 * Shared notification row link/click rules for legacy pages and web components.
 * Chat SPA imports the copy under src/shared/notificationNav.js (keep in sync).
 */

import { navigateToChatPathFromOverlay } from '/shared/createSubmit.js';
import {
	navigateToCreationDetailFromSpa,
	navigateToSpaPageFromSpa,
	parseCreationNavigationTargetId,
	parseSpaOverlayTarget,
	shouldUseSpaPageOverlay
} from './spaPageOverlay.js';

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
	if (n.type === "tip" || n.type === "credits") return true;
	if (n.type === "chat_mention" && notificationChatHref(n)) return true;
	const href = notificationCreationHref(n);
	return !!href && n.type != null && CREATION_CLICK_TYPES.has(n.type);
}

/**
 * Follow a notification's primary link using the same SPA rules as the
 * chat notifications quick menu (overlay / in-shell chat, not a full reload).
 * @param {{ type?: string | null, link?: string | null, creation_id?: number | null }} notification
 * @returns {boolean} true when a href was handled
 */
export function navigateNotificationPrimaryHref(notification) {
	const href = notificationPrimaryHref(notification);
	if (!href) return false;

	if (parseCreationNavigationTargetId(href) && shouldUseSpaPageOverlay()) {
		navigateToCreationDetailFromSpa(href);
		return true;
	}
	if (notificationChatHref(notification)) {
		if (!navigateToChatPathFromOverlay(href)) {
			window.location.assign(href);
		}
		return true;
	}
	if (shouldUseSpaPageOverlay() && parseSpaOverlayTarget(href)) {
		navigateToSpaPageFromSpa(href);
		return true;
	}
	window.location.assign(href);
	return true;
}
