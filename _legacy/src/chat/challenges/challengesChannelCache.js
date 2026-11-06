/**
 * Shared persisted cache for `#challenges` channel messages.
 * Used by participant `/challenges` and organizer `/challenges/organize` (stale-then-refresh).
 */

export const CHALLENGES_CHANNEL_CACHE_KEY = 'prsn-challenges-channel-v1';
/** Legacy organize-only key — read once and migrate. */
export const CHALLENGES_ORGANIZE_CACHE_KEY_LEGACY = 'prsn-challenges-organize-v1';

/** Prefer a background refetch after this age; stale data still paints instantly. */
export const CHALLENGES_CHANNEL_STALE_MS = 60 * 1000;

/**
 * @param {unknown} o
 * @returns {{
 *   viewerId: number,
 *   viewerUserName: string,
 *   threadId: number,
 *   messages: object[],
 *   cachedAt: number
 * } | null}
 */
function normalizeCacheObject(o) {
	if (!o || typeof o !== 'object' || typeof o.cachedAt !== 'number') return null;
	const viewerId = o.viewerId != null ? Number(o.viewerId) : NaN;
	const threadId = o.threadId != null ? Number(o.threadId) : NaN;
	const viewerUserName =
		typeof o.viewerUserName === 'string' && o.viewerUserName.trim()
			? o.viewerUserName.trim()
			: '';
	if (!Number.isFinite(viewerId) || viewerId <= 0) return null;
	if (!Number.isFinite(threadId) || threadId <= 0) return null;
	if (!viewerUserName) return null;
	if (!Array.isArray(o.messages)) return null;
	return {
		viewerId,
		viewerUserName,
		threadId,
		messages: o.messages,
		cachedAt: o.cachedAt
	};
}

/**
 * @returns {{
 *   viewerId: number,
 *   viewerUserName: string,
 *   threadId: number,
 *   messages: object[],
 *   cachedAt: number
 * } | null}
 */
export function readChallengesChannelCache() {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CHALLENGES_CHANNEL_CACHE_KEY);
		if (raw) {
			const parsed = normalizeCacheObject(JSON.parse(raw));
			if (parsed) return parsed;
		}
		const legacyRaw = localStorage.getItem(CHALLENGES_ORGANIZE_CACHE_KEY_LEGACY);
		if (!legacyRaw) return null;
		const legacy = normalizeCacheObject(JSON.parse(legacyRaw));
		if (!legacy) return null;
		writeChallengesChannelCache(legacy);
		try {
			localStorage.removeItem(CHALLENGES_ORGANIZE_CACHE_KEY_LEGACY);
		} catch {
			// ignore
		}
		return legacy;
	} catch {
		return null;
	}
}

/**
 * @param {{
 *   viewerId: number,
 *   viewerUserName: string,
 *   threadId: number,
 *   messages: object[]
 * }} payload
 */
export function writeChallengesChannelCache(payload) {
	if (typeof localStorage === 'undefined') return;
	try {
		const viewerId = Number(payload?.viewerId);
		const threadId = Number(payload?.threadId);
		const viewerUserName =
			typeof payload?.viewerUserName === 'string' ? payload.viewerUserName.trim() : '';
		if (!Number.isFinite(viewerId) || viewerId <= 0) return;
		if (!Number.isFinite(threadId) || threadId <= 0) return;
		if (!viewerUserName) return;
		if (!Array.isArray(payload?.messages)) return;
		localStorage.setItem(
			CHALLENGES_CHANNEL_CACHE_KEY,
			JSON.stringify({
				viewerId,
				viewerUserName,
				threadId,
				messages: payload.messages,
				cachedAt: Date.now()
			})
		);
	} catch {
		// quota / private mode
	}
}

export function clearChallengesChannelCache() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CHALLENGES_CHANNEL_CACHE_KEY);
		localStorage.removeItem(CHALLENGES_ORGANIZE_CACHE_KEY_LEGACY);
	} catch {
		// ignore
	}
}

export function isChallengesChannelCacheStale(cachedAt) {
	return Date.now() - Number(cachedAt || 0) > CHALLENGES_CHANNEL_STALE_MS;
}

/**
 * Cheap fingerprint so background refresh can skip a full remount when unchanged.
 * @param {object[]} messages
 */
export function challengesMessagesFingerprint(messages) {
	const list = Array.isArray(messages) ? messages : [];
	const n = list.length;
	if (n === 0) return '0';
	const first = list[0];
	const last = list[n - 1];
	const a = first?.id != null ? String(first.id) : '';
	const b = last?.id != null ? String(last.id) : '';
	const bodyHint =
		typeof last?.body === 'string' ? String(last.body.length) : '0';
	return `${n}:${a}:${b}:${bodyHint}`;
}

/**
 * Fingerprint a single chat message body for save-conflict checks.
 * @param {string | object | null | undefined} body
 */
export function challengeConfigBodyFingerprint(body) {
	const raw = typeof body === 'string' ? body : body != null ? JSON.stringify(body) : '';
	let h = 0;
	for (let i = 0; i < raw.length; i++) {
		h = (h * 31 + raw.charCodeAt(i)) | 0;
	}
	return `${raw.length}:${h}`;
}

/* ---- Back-compat aliases (organizeCache consumers) ---- */

export const CHALLENGES_ORGANIZE_CACHE_KEY = CHALLENGES_CHANNEL_CACHE_KEY;
export const CHALLENGES_ORGANIZE_STALE_MS = CHALLENGES_CHANNEL_STALE_MS;
export const readChallengesOrganizeCache = readChallengesChannelCache;
export const writeChallengesOrganizeCache = writeChallengesChannelCache;
export const clearChallengesOrganizeCache = clearChallengesChannelCache;
export const isChallengesOrganizeCacheStale = isChallengesChannelCacheStale;
export const organizeMessagesFingerprint = challengesMessagesFingerprint;
