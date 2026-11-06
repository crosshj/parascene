import { getFeedBetaRedis } from '../feedBeta/feedBetaRedis.js';
import {
	buildChallengeFeedSnapshotShared,
	applyChallengeViewerOverlay
} from './challengeFeedSnapshotShared.js';

export const CHALLENGE_FEED_SNAPSHOT_REDIS_KEY = 'feed-beta:challenge-snapshot:v3';
export const CHALLENGE_FEED_SNAPSHOT_REBUILD_LOCK_KEY = 'feed-beta:challenge-snapshot:rebuild-lock';

/** Rebuilt on write invalidation; TTL is a safety net. */
export const CHALLENGE_FEED_SNAPSHOT_TTL_SEC = 20 * 60;
export const CHALLENGE_FEED_SNAPSHOT_REBUILD_LOCK_TTL_SEC = 30;

const MEM_TTL_MS = 45_000;

/** Shared snapshot schema version written by `buildChallengeFeedSnapshotShared`. */
export const CHALLENGE_FEED_SNAPSHOT_VERSION = 2;

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isChallengeFeedSnapshotCachePayload(raw) {
	return Boolean(
		raw &&
			typeof raw === 'object' &&
			!Array.isArray(raw) &&
			Number(/** @type {{ version?: unknown }} */ (raw).version) ===
				CHALLENGE_FEED_SNAPSHOT_VERSION
	);
}

/** @type {{ at: number, snapshot: object|null, dirty: boolean }} */
let mem = { at: 0, snapshot: null, dirty: false };

/** @type {Promise<object|null>|null} */
let rebuildInFlight = null;

export function invalidateChallengeFeedSnapshotMemCache() {
	mem = { at: 0, snapshot: null, dirty: false };
}

/**
 * Drop Redis + mark mem stale. Keeps the last snapshot in mem so readers can
 * serve it while a single-flight rebuild runs.
 */
export async function invalidateChallengeFeedSnapshotCache() {
	mem = { at: 0, snapshot: mem.snapshot, dirty: true };
	const r = getFeedBetaRedis();
	if (!r) return false;
	try {
		await r.del(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY);
		return true;
	} catch (err) {
		console.warn('[feed] challengeFeedSnapshotCache invalidate', err?.message || err);
		return false;
	}
}

/**
 * Invalidate and kick a background rebuild (single-flight).
 * @param {{ queries?: object }} [opts]
 */
export function invalidateAndRebuildChallengeFeedSnapshotCache(opts = {}) {
	void invalidateChallengeFeedSnapshotCache()
		.then(() => rebuildChallengeFeedSnapshotCache({ queries: opts.queries }))
		.catch((err) => {
			console.warn('[feed] challengeFeedSnapshotCache invalidate+rebuild', err?.message || err);
		});
}

export function isChallengeFeedSnapshotMemCacheFresh() {
	return Boolean(mem.snapshot && !mem.dirty && Date.now() - mem.at < MEM_TTL_MS);
}

/** @param {object|null|undefined} snapshot */
export function primeChallengeFeedSnapshotMemCache(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return;
	mem = { at: Date.now(), snapshot, dirty: false };
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadChallengeFeedSnapshotSharedCached() {
	const now = Date.now();
	if (mem.snapshot && !mem.dirty && now - mem.at < MEM_TTL_MS) {
		return mem.snapshot;
	}
	const r = getFeedBetaRedis();
	if (r) {
		try {
			const raw = await r.get(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY);
			if (isChallengeFeedSnapshotCachePayload(raw)) {
				mem = { at: now, snapshot: raw, dirty: false };
				return raw;
			}
		} catch (err) {
			console.warn('[feed] challengeFeedSnapshotCache load', err?.message || err);
		}
	}
	// Redis miss / error: serve stale mem while a rebuild runs after invalidation.
	if (mem.snapshot) return mem.snapshot;
	return null;
}

/**
 * @param {object} snapshot
 */
export async function saveChallengeFeedSnapshotToRedis(snapshot) {
	const r = getFeedBetaRedis();
	if (!r || !snapshot) {
		if (snapshot) mem = { at: Date.now(), snapshot, dirty: false };
		return false;
	}
	try {
		await r.set(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY, snapshot, {
			ex: CHALLENGE_FEED_SNAPSHOT_TTL_SEC
		});
		mem = { at: Date.now(), snapshot, dirty: false };
		return true;
	} catch (err) {
		console.warn('[feed] challengeFeedSnapshotCache save', err?.message || err);
		mem = { at: Date.now(), snapshot, dirty: false };
		return false;
	}
}

/**
 * @returns {Promise<boolean>}
 */
async function tryAcquireRebuildLock() {
	const r = getFeedBetaRedis();
	if (!r) return true;
	try {
		const ok = await r.set(CHALLENGE_FEED_SNAPSHOT_REBUILD_LOCK_KEY, '1', {
			nx: true,
			ex: CHALLENGE_FEED_SNAPSHOT_REBUILD_LOCK_TTL_SEC
		});
		return ok === true || ok === 'OK';
	} catch (err) {
		console.warn('[feed] challengeFeedSnapshotCache lock', err?.message || err);
		return true;
	}
}

async function releaseRebuildLock() {
	const r = getFeedBetaRedis();
	if (!r) return;
	try {
		await r.del(CHALLENGE_FEED_SNAPSHOT_REBUILD_LOCK_KEY);
	} catch {
		// lock TTL is the safety net
	}
}

/**
 * @param {{ queries?: object }} opts
 */
export async function rebuildChallengeFeedSnapshotCache(opts = {}) {
	if (rebuildInFlight) return rebuildInFlight;

	rebuildInFlight = (async () => {
		const gotLock = await tryAcquireRebuildLock();
		if (!gotLock) {
			// Another process is rebuilding — prefer stale snapshot over a second rebuild.
			return mem.snapshot || (await loadChallengeFeedSnapshotSharedCached());
		}
		try {
			const shared = await buildChallengeFeedSnapshotShared(opts);
			if (shared?.ok === true || shared?.reason === 'no_challenges_thread') {
				await saveChallengeFeedSnapshotToRedis(shared);
			}
			return shared;
		} finally {
			await releaseRebuildLock();
		}
	})().finally(() => {
		rebuildInFlight = null;
	});

	return rebuildInFlight;
}

/**
 * @param {{ viewerUserId?: number, queries?: object }} opts
 */
export async function pullChallengeFeedSnapshotCached(opts = {}) {
	let shared = await loadChallengeFeedSnapshotSharedCached();
	if (mem.dirty || !shared) {
		void rebuildChallengeFeedSnapshotCache({ queries: opts.queries }).catch((err) => {
			console.warn('[feed] challengeFeedSnapshotCache rebuild', err?.message || err);
		});
	}
	if (!shared) {
		return { ok: false, active: false, reason: 'cache_miss' };
	}
	return applyChallengeViewerOverlay(shared, opts.viewerUserId);
}
