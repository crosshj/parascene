/**
 * Persisted cache for Connect page roster merge data from GET /api/servers.
 * Pairs with chatThreadsCache viewer id so we don't show another user's servers after account switch.
 */

export const CONNECT_SERVERS_CACHE_KEY = 'prsn-connect-servers-v1';

/** Same cadence as chat thread list: background refresh when older than this. */
export const CONNECT_SERVERS_STALE_MS = 60 * 1000;

/**
 * @returns {{
 *   viewerId: number,
 *   joinedServers: { id: number, name: string, can_manage: boolean }[],
 *   derivedSlugs: string[],
 *   cachedAt: number
 * } | null}
 */
export function readConnectServersCache() {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CONNECT_SERVERS_CACHE_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (!o || typeof o.cachedAt !== 'number') return null;
		const viewerId = o.viewerId != null ? Number(o.viewerId) : null;
		if (viewerId == null || !Number.isFinite(viewerId)) return null;
		if (!Array.isArray(o.joinedServers)) return null;
		if (!Array.isArray(o.derivedSlugs)) return null;
		return {
			viewerId,
			joinedServers: o.joinedServers,
			derivedSlugs: o.derivedSlugs,
			cachedAt: o.cachedAt
		};
	} catch {
		return null;
	}
}

/**
 * @param {number} viewerId
 * @param {{ id: number, name: string, can_manage: boolean }[]} joinedServers
 * @param {string[]} derivedSlugs
 */
export function writeConnectServersCache(viewerId, joinedServers, derivedSlugs) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(
			CONNECT_SERVERS_CACHE_KEY,
			JSON.stringify({
				viewerId: Number(viewerId),
				joinedServers,
				derivedSlugs,
				cachedAt: Date.now()
			})
		);
	} catch {
		// quota / private mode
	}
}

export function clearConnectServersCache() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CONNECT_SERVERS_CACHE_KEY);
	} catch {
		// ignore
	}
}

export function isConnectServersCacheStale(cachedAt) {
	return Date.now() - cachedAt > CONNECT_SERVERS_STALE_MS;
}
