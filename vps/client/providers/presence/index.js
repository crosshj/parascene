import { createPresenceHeartbeat } from './heartbeat.js';
import { createPresenceCache } from './cache.js';
import { createQuery } from '../../core/query.js';
import { getDmOtherUserId } from '../../shared/dmIdentity.js';

// Snapshot parsing, caching, failure fallback and grace are ported from the
// active WWW chatPage.js. The provider owns requests and app-lifetime cleanup.
export function createPresenceProvider({ viewerId, fetchImpl = globalThis.fetch } = {}) {
	const heartbeat = createPresenceHeartbeat({ fetchImpl });
	const cache = createPresenceCache(viewerId);
	const rosterMod = { getDmOtherUserId };
	const dmLastSeenOnlineAtByUserId = new Map();
	const DM_OFFLINE_GRACE_MS = 45 * 1000;
	let lastPresenceOnlineSnapshot = null;
	let lastPresenceOnlineSnapshotAt = 0;
	const PRESENCE_ONLINE_SNAPSHOT_TTL_MS = 15000;
	let lastPresenceLastActiveCache = null;
	let lastPresenceLastActiveCacheAt = 0;
	let lastPresenceLastActiveCacheKey = '';
	const PRESENCE_LAST_ACTIVE_SNAPSHOT_TTL_MS = 15000;
	let started = false, destroyed = false, pollTimer = null;
	let threads = [], refreshing = null, queued = false;
	let removeVisibilityListener = () => {};
	const controllers = new Set();
	async function fetch(url, options) {
		const controller = new AbortController();
		controllers.add(controller);
		try {
			const response = await fetchImpl(url, { ...options, signal: controller.signal });
			// Snapshot bodies must also be abortable until JSON has been consumed.
			if (!response.ok) { controllers.delete(controller); return response; }
			return { ok: response.ok, json: async () => {
				try { return await response.json(); }
				finally { controllers.delete(controller); }
			} };
		} catch (error) { controllers.delete(controller); throw error; }
	}
	function isDmConsideredOnlineWithGrace(otherUserId, onlineIds) {
		const oid = Number(otherUserId);
		if (!Number.isFinite(oid) || oid <= 0) return false;
		const now = Date.now();
		if (onlineIds && onlineIds.has(oid)) {
			dmLastSeenOnlineAtByUserId.set(oid, now);
			return true;
		}
		const last = dmLastSeenOnlineAtByUserId.get(oid);
		if (last != null && now - last < DM_OFFLINE_GRACE_MS) {
			return true;
		}
		return false;
	}

	async function fetchPresenceOnlineSnapshot({ allowCached = false } = {}) {
		if (
			allowCached &&
			lastPresenceOnlineSnapshot &&
			Date.now() - lastPresenceOnlineSnapshotAt < PRESENCE_ONLINE_SNAPSHOT_TTL_MS
		) {
			return lastPresenceOnlineSnapshot;
		}
		try {
			const res = await fetch('/api/presence/online', { credentials: 'include' });
			if (!res.ok) {
				return lastPresenceOnlineSnapshot || { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
			}
			const data = await res.json().catch(() => ({}));
			if (destroyed) return {};
			const users = Array.isArray(data.users) ? data.users : [];
			const onlineIds = new Set();
			const lastSeenMsByUserId = new Map();
			for (const u of users) {
				const id = Number(u.user_id);
				if (!Number.isFinite(id) || id <= 0) continue;
				onlineIds.add(id);
				const ms = Date.parse(String(u?.presence_last_seen_at || ''));
				if (Number.isFinite(ms)) {
					lastSeenMsByUserId.set(id, ms);
					dmLastSeenOnlineAtByUserId.set(id, ms);
				}
			}
			const snapshot = { onlineIds, lastSeenMsByUserId };
			lastPresenceOnlineSnapshot = snapshot;
			lastPresenceOnlineSnapshotAt = Date.now();
			return snapshot;
		} catch {
			return lastPresenceOnlineSnapshot || { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
		}
	}

	async function fetchPresenceLastActiveSnapshot(userIds, { allowCached = false } = {}) {
		const ids = Array.isArray(userIds)
			? [...new Set(userIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))]
			: [];
		if (ids.length === 0) return new Map();
		const idsKey = ids.join(',');
		if (
			allowCached &&
			lastPresenceLastActiveCache &&
			lastPresenceLastActiveCacheKey === idsKey &&
			Date.now() - lastPresenceLastActiveCacheAt < PRESENCE_LAST_ACTIVE_SNAPSHOT_TTL_MS
		) {
			return new Map(lastPresenceLastActiveCache);
		}
		try {
			const res = await fetch('/api/presence/last-active', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_ids: ids })
			});
			if (!res.ok) return new Map();
			const data = await res.json().catch(() => ({}));
			if (destroyed) return {};
			const users = Array.isArray(data.users) ? data.users : [];
			const out = new Map();
			for (const u of users) {
				const id = Number(u?.user_id);
				if (!Number.isFinite(id) || id <= 0) continue;
				const activeMs = Date.parse(String(u?.last_active_at || ''));
				const presenceMs = Date.parse(String(u?.presence_last_seen_at || ''));
				const a = Number.isFinite(activeMs) ? activeMs : 0;
				const p = Number.isFinite(presenceMs) ? presenceMs : 0;
				const best = Math.max(a, p);
				if (best > 0) out.set(id, best);
			}
			lastPresenceLastActiveCache = out;
			lastPresenceLastActiveCacheAt = Date.now();
			lastPresenceLastActiveCacheKey = idsKey;
			return out;
		} catch {
			if (lastPresenceLastActiveCache && lastPresenceLastActiveCacheKey === idsKey) {
				return new Map(lastPresenceLastActiveCache);
			}
			return new Map();
		}
	}

	function collectDmOtherUserIdsForPresence(threads) {
		const list = Array.isArray(threads) ? threads : [];
		const ids = [];
		for (const t of list) {
			if (!t || t.type !== 'dm') continue;
			const oid = Number(rosterMod.getDmOtherUserId(t));
			if (!Number.isFinite(oid) || oid <= 0) continue;
			if (viewerId != null && Number.isFinite(Number(viewerId)) && Number(oid) === Number(viewerId)) {
				continue;
			}
			ids.push(oid);
		}
		return [...new Set(ids)];
	}


	const query = createQuery({ key: ['presence', viewerId], cache, load: async () => {
		const [online, lastActiveMsByUserId] = await Promise.all([
			fetchPresenceOnlineSnapshot({ allowCached: true }),
			fetchPresenceLastActiveSnapshot(collectDmOtherUserIdsForPresence(threads), { allowCached: true }),
		]);
		return { ...online, lastActiveMsByUserId };
	} });
	function refresh() {
		if (destroyed || !viewerId) return Promise.resolve();
		if (refreshing) { queued = true; return refreshing; }
		refreshing = query.refresh().catch(() => undefined).finally(() => {
			refreshing = null;
			if (queued && !destroyed) { queued = false; void refresh(); }
		});
		return refreshing;
	}
	function onVisibility() {
		if (document.visibilityState === 'visible') void refresh();
	}
	function start() {
		if (started || destroyed || !viewerId) return;
		started = true;
		heartbeat.start();
		void refresh();
		// WWW polls the roster even when hidden/offline; only heartbeat pauses.
		pollTimer = setInterval(() => void refresh(), 30000);
		document.addEventListener('visibilitychange', onVisibility);
		const target = document;
		removeVisibilityListener = () => target.removeEventListener('visibilitychange', onVisibility);
	}
	function destroy() {
		if (destroyed) return;
		destroyed = true;
		heartbeat.destroy(); clearInterval(pollTimer); query.destroy();
		for (const controller of controllers) controller.abort();
		controllers.clear(); dmLastSeenOnlineAtByUserId.clear();
		removeVisibilityListener();
	}
	return {
		query, start, refresh, destroy, markActivity: heartbeat.markActivity,
		setThreads(next) {
			const before = collectDmOtherUserIdsForPresence(threads).join(',');
			threads = Array.isArray(next) ? next : [];
			if (started && before !== collectDmOtherUserIdsForPresence(threads).join(',')) void refresh();
		},
		isOnline(id) { return isDmConsideredOnlineWithGrace(id, query.data?.onlineIds); },
		lastActiveMs(id) {
			for (const source of [query.data?.lastActiveMsByUserId, query.data?.lastSeenMsByUserId, dmLastSeenOnlineAtByUserId]) {
				const ms = Number(source?.get(Number(id)));
				if (Number.isFinite(ms) && ms > 0) return ms;
			}
			return 0;
		},
		preload() {}, syncExternalCache() {}, clearCache() { cache?.clear(); destroy(); },
	};
}
