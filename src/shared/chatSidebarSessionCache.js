/**
 * Session snapshot of everything needed to paint the chat sidebar roster
 * (threads + joined servers + presence + viewer profile). Used only as a
 * placeholder while a fresh network load runs after leaving and returning to chat.
 */

export const CHAT_SIDEBAR_SESSION_ROSTER_KEY = 'prsn-chat-sidebar-roster-v1';

/**
 * @param {{
 *   onlineIds: Set<number>,
 *   lastSeenMsByUserId: Map<number, number>,
 *   lastActiveMsByUserId: Map<number, number>
 * }} snap
 */
export function serializePresenceSnapshot(snap) {
	if (!snap || typeof snap !== 'object') return null;
	const onlineIds = snap.onlineIds instanceof Set ? [...snap.onlineIds] : [];
	const lastSeenMsByUserId =
		snap.lastSeenMsByUserId instanceof Map ? [...snap.lastSeenMsByUserId.entries()] : [];
	const lastActiveMsByUserId =
		snap.lastActiveMsByUserId instanceof Map ? [...snap.lastActiveMsByUserId.entries()] : [];
	return { onlineIds, lastSeenMsByUserId, lastActiveMsByUserId };
}

/**
 * @param {unknown} raw
 * @returns {{ onlineIds: Set<number>, lastSeenMsByUserId: Map<number, number>, lastActiveMsByUserId: Map<number, number> }}
 */
export function deserializePresenceSnapshot(raw) {
	const empty = {
		onlineIds: new Set(),
		lastSeenMsByUserId: new Map(),
		lastActiveMsByUserId: new Map(),
	};
	if (!raw || typeof raw !== 'object') return empty;
	const o = raw;
	const onlineIds = new Set(
		Array.isArray(o.onlineIds) ? o.onlineIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : []
	);
	const lastSeenMsByUserId = new Map();
	if (Array.isArray(o.lastSeenMsByUserId)) {
		for (const pair of o.lastSeenMsByUserId) {
			if (!Array.isArray(pair) || pair.length < 2) continue;
			const id = Number(pair[0]);
			const ms = Number(pair[1]);
			if (Number.isFinite(id) && id > 0 && Number.isFinite(ms)) lastSeenMsByUserId.set(id, ms);
		}
	}
	const lastActiveMsByUserId = new Map();
	if (Array.isArray(o.lastActiveMsByUserId)) {
		for (const pair of o.lastActiveMsByUserId) {
			if (!Array.isArray(pair) || pair.length < 2) continue;
			const id = Number(pair[0]);
			const ms = Number(pair[1]);
			if (Number.isFinite(id) && id > 0 && Number.isFinite(ms)) lastActiveMsByUserId.set(id, ms);
		}
	}
	return { onlineIds, lastSeenMsByUserId, lastActiveMsByUserId };
}

/**
 * @param {number | null | undefined} viewerId
 * @param {{
 *   threads: unknown[],
 *   joined: unknown[],
 *   presenceSnapshot: { onlineIds: Set<number>, lastSeenMsByUserId: Map<number, number>, lastActiveMsByUserId: Map<number, number> },
 *   viewerProfile: unknown
 * }} payload
 */
export function writeSidebarRosterSessionCache(viewerId, payload) {
	if (typeof sessionStorage === 'undefined') return;
	const vid = viewerId != null ? Number(viewerId) : null;
	if (vid == null || !Number.isFinite(vid) || vid <= 0) return;
	try {
		const threads = Array.isArray(payload?.threads) ? payload.threads : [];
		const joined = Array.isArray(payload?.joined) ? payload.joined : [];
		const presenceSerialized = serializePresenceSnapshot(payload?.presenceSnapshot);
		const o = {
			v: 1,
			viewerId: vid,
			cachedAt: Date.now(),
			threads,
			joined,
			presence: presenceSerialized,
			viewerProfile: payload?.viewerProfile ?? null,
		};
		sessionStorage.setItem(CHAT_SIDEBAR_SESSION_ROSTER_KEY, JSON.stringify(o));
	} catch {
		// quota / private mode
	}
}

/**
 * @param {number | null | undefined} currentViewerId — must match stored viewer
 * @returns {{ threads: unknown[], joined: unknown[], presenceSnapshot: object, viewerProfile: unknown } | null}
 */
export function readSidebarRosterSessionCache(currentViewerId) {
	if (typeof sessionStorage === 'undefined') return null;
	const vid = currentViewerId != null ? Number(currentViewerId) : null;
	if (vid == null || !Number.isFinite(vid) || vid <= 0) return null;
	try {
		const raw = sessionStorage.getItem(CHAT_SIDEBAR_SESSION_ROSTER_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		const stored = o?.viewerId != null ? Number(o.viewerId) : null;
		if (stored == null || !Number.isFinite(stored) || stored !== vid) {
			sessionStorage.removeItem(CHAT_SIDEBAR_SESSION_ROSTER_KEY);
			return null;
		}
		if (!Array.isArray(o.threads) || !Array.isArray(o.joined)) return null;
		return {
			threads: o.threads,
			joined: o.joined,
			presenceSnapshot: deserializePresenceSnapshot(o.presence),
			viewerProfile: o.viewerProfile ?? null,
		};
	} catch {
		return null;
	}
}

export function clearSidebarRosterSessionCache() {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.removeItem(CHAT_SIDEBAR_SESSION_ROSTER_KEY);
	} catch {
		// ignore
	}
}
