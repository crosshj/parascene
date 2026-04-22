/**
 * DOM + sessionStorage signals for “creations still in flight” polling.
 * Shared by `app-route-creations` (`creations.js`) and chat `#creations` pseudo-channel.
 */

export function getPendingCreationsFromSession() {
	try {
		const pending = JSON.parse(sessionStorage.getItem('pendingCreations') || '[]');
		return Array.isArray(pending) ? pending : [];
	} catch {
		return [];
	}
}

/**
 * @param {ParentNode|null} root — `[data-creations-container]` on the Creations route, or `[data-chat-messages]` in chat.
 */
export function shouldContinueCreationsPoll(root) {
	if (!root) return false;
	if (root.querySelector('.route-media[data-image-id][data-status="creating"]')) return true;
	if (root.querySelector('.route-media[data-image-id][data-status="pending"]')) return true;
	if (root.querySelector('.feed-card[data-creation-id][data-creation-status="creating"]')) return true;
	if (root.querySelector('.feed-card[data-creation-id][data-creation-status="pending"]')) return true;
	return getPendingCreationsFromSession().length > 0;
}

/**
 * Pending placeholders (DOM or session) — used with `hasUpdates` to decide throttled full reload.
 * @param {ParentNode|null} root
 */
export function hasPendingCreationsReloadHint(root) {
	if (!root) return false;
	if (root.querySelector('.route-media[data-image-id][data-status="pending"]')) return true;
	if (root.querySelector('.feed-card[data-creation-id][data-creation-status="pending"]')) return true;
	return getPendingCreationsFromSession().length > 0;
}

/**
 * @param {unknown[]} creationsFromApi — `result.data.images` from `GET /api/create/images` (default limit).
 * @param {ParentNode|null} root
 */
export function computeCreationsPollHasListUpdates(creationsFromApi, root) {
	if (!root) return false;
	const list = Array.isArray(creationsFromApi) ? creationsFromApi : [];
	for (const el of root.querySelectorAll('.route-media[data-image-id][data-status="creating"]')) {
		const creationId = el.getAttribute('data-image-id');
		const updatedCreation = list.find((c) => c != null && String(c.id) === String(creationId));
		if (updatedCreation && updatedCreation.status && updatedCreation.status !== 'creating') {
			return true;
		}
	}
	for (const el of root.querySelectorAll('.feed-card[data-creation-id][data-creation-status="creating"]')) {
		const creationId = el.getAttribute('data-creation-id');
		const updatedCreation = list.find((c) => c != null && String(c.id) === String(creationId));
		if (updatedCreation && updatedCreation.status && updatedCreation.status !== 'creating') {
			return true;
		}
	}
	return false;
}
