import { getFeedBetaRedis } from '../feedBeta/feedBetaRedis.js';
import {
	buildChallengeFeedSnapshotShared,
	applyChallengeViewerOverlay
} from './challengeFeedSnapshotShared.js';

export const CHALLENGE_FEED_SNAPSHOT_REDIS_KEY = 'feed-beta:challenge-snapshot:v1';

/** Rebuilt by scheduled worker; TTL is a safety net. */
export const CHALLENGE_FEED_SNAPSHOT_TTL_SEC = 20 * 60;

const MEM_TTL_MS = 45_000;

/** @type {{ at: number, snapshot: object|null }} */
let mem = { at: 0, snapshot: null };

export function invalidateChallengeFeedSnapshotMemCache() {
	mem = { at: 0, snapshot: null };
}

export function isChallengeFeedSnapshotMemCacheFresh() {
	return Boolean(mem.snapshot && Date.now() - mem.at < MEM_TTL_MS);
}

/** @param {object|null|undefined} snapshot */
export function primeChallengeFeedSnapshotMemCache(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return;
	mem = { at: Date.now(), snapshot };
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadChallengeFeedSnapshotSharedCached() {
	const now = Date.now();
	if (mem.snapshot && now - mem.at < MEM_TTL_MS) {
		return mem.snapshot;
	}
	const r = getFeedBetaRedis();
	if (!r) return null;
	try {
		const raw = await r.get(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY);
		if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
		mem = { at: now, snapshot: raw };
		return raw;
	} catch (err) {
		console.warn('[feed] challengeFeedSnapshotCache load', err?.message || err);
		return null;
	}
}

/**
 * @param {object} snapshot
 */
export async function saveChallengeFeedSnapshotToRedis(snapshot) {
	const r = getFeedBetaRedis();
	if (!r || !snapshot) return false;
	try {
		await r.set(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY, snapshot, {
			ex: CHALLENGE_FEED_SNAPSHOT_TTL_SEC
		});
		mem = { at: Date.now(), snapshot };
		return true;
	} catch (err) {
		console.warn('[feed] challengeFeedSnapshotCache save', err?.message || err);
		return false;
	}
}

/**
 * @param {{ queries?: object }} opts
 */
export async function rebuildChallengeFeedSnapshotCache(opts = {}) {
	const shared = await buildChallengeFeedSnapshotShared(opts);
	if (shared?.ok === true || shared?.reason === 'no_challenges_thread') {
		await saveChallengeFeedSnapshotToRedis(shared);
	}
	return shared;
}

/**
 * @param {{ viewerUserId?: number, queries?: object }} opts
 */
export async function pullChallengeFeedSnapshotCached(opts = {}) {
	let shared = await loadChallengeFeedSnapshotSharedCached();
	if (!shared) {
		void rebuildChallengeFeedSnapshotCache({ queries: opts.queries }).catch((err) => {
			console.warn('[feed] challengeFeedSnapshotCache rebuild', err?.message || err);
		});
		return { ok: false, active: false, reason: 'cache_miss' };
	}
	return applyChallengeViewerOverlay(shared, opts.viewerUserId);
}
