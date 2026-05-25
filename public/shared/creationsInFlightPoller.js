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
function parseCreationMeta(meta) {
	if (meta && typeof meta === 'object') return meta;
	if (typeof meta === 'string' && meta.trim()) {
		try {
			return JSON.parse(meta);
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Prepend session pending/creating placeholders ahead of API-mapped feed rows (dedupe by id + creation_token).
 * @param {object[]} feedItems
 * @param {(pending: object) => object | null} mapPending
 * @returns {object[]}
 */
export function mergeSessionPendingIntoFeedItems(feedItems, mapPending) {
	const apiItems = Array.isArray(feedItems) ? feedItems : [];
	const pending = getPendingCreationsFromSession();
	if (!pending.length || typeof mapPending !== 'function') {
		return apiItems;
	}

	const apiIds = new Set();
	const apiTokens = new Set();
	for (const item of apiItems) {
		const id = item?.created_image_id ?? item?.id;
		const numId = Number(id);
		if (Number.isFinite(numId) && numId > 0) {
			apiIds.add(numId);
		}
		const meta = parseCreationMeta(item?.meta);
		const token =
			typeof meta?.creation_token === 'string' ? meta.creation_token.trim() : '';
		if (token) apiTokens.add(token);
	}

	const placeholders = [];
	for (const row of pending) {
		const mapped = mapPending(row);
		if (!mapped) continue;
		const pid = Number(mapped.created_image_id ?? mapped.id);
		if (Number.isFinite(pid) && pid > 0 && apiIds.has(pid)) continue;
		const token =
			typeof row?.creation_token === 'string' ? row.creation_token.trim() : '';
		if (token && apiTokens.has(token)) continue;
		placeholders.push(mapped);
	}

	const combined = [...placeholders, ...apiItems];
	return combined.sort((a, b) => {
		const ta = Date.parse(String(a?.created_at || '')) || 0;
		const tb = Date.parse(String(b?.created_at || '')) || 0;
		return tb - ta;
	});
}

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
