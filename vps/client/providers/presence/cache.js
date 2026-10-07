import { createStorageCache } from '../../core/storageCache.js';

// WWW presence snapshot serialization; storage is owned by the VPS provider.
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


export function createPresenceCache(viewerId) {
	if (!viewerId) return null;
	const storage = createStorageCache(`prsn-vps-presence-v1:${viewerId}`);
	return {
		read() {
			const entry = storage.read();
			return entry ? { ...entry, data: deserializePresenceSnapshot(entry.data) } : null;
		},
		write(entry) { storage.write({ ...entry, data: serializePresenceSnapshot(entry.data) }); },
		clear: storage.clear,
	};
}
