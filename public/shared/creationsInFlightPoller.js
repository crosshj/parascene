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
	return findCreationsPollStatusUpdates(creationsFromApi, root).length > 0;
}

function normalizeCreationListStatus(status) {
	if (status == null || status === '') return '';
	return String(status).trim().toLowerCase();
}

function isInFlightCreationStatus(status) {
	const st = normalizeCreationListStatus(status);
	return st === 'creating' || st === 'pending';
}

/**
 * Rows whose in-flight DOM card should be replaced with API data (e.g. creating → completed).
 * @param {unknown[]} creationsFromApi
 * @param {ParentNode|null} root
 * @returns {Array<{ creationId: string, apiRow: object }>}
 */
export function findCreationsPollStatusUpdates(creationsFromApi, root) {
	if (!root) return [];
	const list = Array.isArray(creationsFromApi) ? creationsFromApi : [];
	const byId = new Map();
	for (const row of list) {
		if (row?.id != null) byId.set(String(row.id), row);
	}

	const updates = [];
	const seen = new Set();

	const consider = (creationId, domStatus) => {
		if (!creationId || seen.has(creationId)) return;
		const apiRow = byId.get(String(creationId));
		if (!apiRow) return;
		const apiStatus = normalizeCreationListStatus(apiRow.status);
		const dom = normalizeCreationListStatus(domStatus);
		if (!isInFlightCreationStatus(dom)) return;
		if (apiStatus === dom) return;
		if (isInFlightCreationStatus(apiStatus)) return;
		seen.add(creationId);
		updates.push({ creationId: String(creationId), apiRow });
	};

	for (const el of root.querySelectorAll(
		'.route-media[data-image-id][data-status="creating"], .route-media[data-image-id][data-status="pending"]'
	)) {
		consider(el.getAttribute('data-image-id'), el.getAttribute('data-status'));
	}
	for (const el of root.querySelectorAll(
		'.feed-card[data-creation-id][data-creation-status="creating"], .feed-card[data-creation-id][data-creation-status="pending"]'
	)) {
		consider(el.getAttribute('data-creation-id'), el.getAttribute('data-creation-status'));
	}

	return updates;
}

const DEFAULT_PENDING_TTL_MS = 3000;

/**
 * Drop session pending rows that are stale or already visible from the API list.
 * @param {unknown[]} creationsFromApi
 * @param {{ dispatchEvent?: boolean, ttlMs?: number, creationsResultOk?: boolean }} [options]
 * @returns {boolean} whether sessionStorage changed
 */
export function prunePendingCreationsSession(creationsFromApi, options = {}) {
	const {
		dispatchEvent = false,
		ttlMs = DEFAULT_PENDING_TTL_MS,
		creationsResultOk = true,
	} = options;
	const pendingCreations = getPendingCreationsFromSession();
	if (!pendingCreations.length) return false;

	const creations = Array.isArray(creationsFromApi) ? creationsFromApi : [];
	const nowMs = Date.now();
	const creationsByToken = new Map();
	for (const item of creations) {
		const meta = parseCreationMeta(item?.meta);
		const token = meta && typeof meta.creation_token === 'string' ? meta.creation_token : null;
		if (token) creationsByToken.set(token, item);
	}

	const pendingWithinTtl = creationsResultOk
		? pendingCreations.filter((p) => {
				const createdAtRaw = typeof p?.created_at === 'string' ? p.created_at : '';
				const createdAtMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
				if (!Number.isFinite(createdAtMs)) return true;
				return nowMs - createdAtMs <= ttlMs;
			})
		: pendingCreations;

	const filteredPending = pendingWithinTtl.filter((p) => {
		const token = typeof p.creation_token === 'string' ? p.creation_token : null;
		if (!token) return true;
		return !creationsByToken.has(token);
	});

	const shouldPurge = pendingCreations.some((p) => {
		const token = typeof p?.creation_token === 'string' ? p.creation_token : null;
		return Boolean(token) && creationsByToken.has(token);
	});
	const ttlPurged = filteredPending.length !== pendingCreations.length;
	if (!shouldPurge && !ttlPurged) return false;

	const newPendingStr = JSON.stringify(filteredPending);
	const oldPendingStr = sessionStorage.getItem('pendingCreations') || '[]';
	if (newPendingStr === oldPendingStr) return false;

	try {
		sessionStorage.setItem('pendingCreations', newPendingStr);
	} catch {
		return false;
	}
	if (dispatchEvent) {
		try {
			document.dispatchEvent(new CustomEvent('creations-pending-updated'));
		} catch {
			// ignore
		}
	}
	return true;
}
