import { getFeedBetaRedis } from './feedBetaRedis.js';

/** Per-user recently seen creation ids (viewport impressions). */
export const FEED_BETA_SEEN_KEY_PREFIX = 'feed-beta:seen:';

/** ~30 days — short memory for pool exclusion, not analytics history. */
export const FEED_BETA_SEEN_TTL_SEC = 30 * 24 * 60 * 60;

/** Per-request priming from pipeline (same feed request). */
const SEEN_PRIME_TTL_MS = 10_000;

/** @type {Map<string, { at: number, set: Set<string> }>} */
const seenPrime = new Map();

/** @param {number|string} userId */
export function feedBetaSeenKey(userId) {
	return `${FEED_BETA_SEEN_KEY_PREFIX}${String(userId)}`;
}

/**
 * @param {unknown} raw
 * @returns {Set<string>}
 */
export function parseFeedBetaSeenMembers(raw) {
	if (!raw) return new Set();
	const list = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw) : [];
	const out = new Set();
	for (const id of list) {
		const s = String(id ?? '').trim();
		if (s) out.add(s);
	}
	return out;
}

export function primeFeedBetaSeenCache(userId, set) {
	if (userId == null || !(set instanceof Set)) return;
	seenPrime.set(String(userId), { at: Date.now(), set });
}

export function invalidateFeedBetaSeenCache(userId) {
	if (userId != null) seenPrime.delete(String(userId));
}

/**
 * @param {number|string} userId
 * @returns {Promise<Set<string>>}
 */
export async function loadFeedBetaSeenSetFromRedis(userId) {
	const primed = seenPrime.get(String(userId));
	if (primed && Date.now() - primed.at < SEEN_PRIME_TTL_MS) {
		return primed.set;
	}
	const r = getFeedBetaRedis();
	if (!r || userId == null) return new Set();
	try {
		const members = await r.smembers(feedBetaSeenKey(userId));
		const out = parseFeedBetaSeenMembers(members);
		primeFeedBetaSeenCache(userId, out);
		return out;
	} catch (err) {
		console.warn('[feedBeta seenRedis] load', err?.message || err);
		return new Set();
	}
}

/**
 * @param {number|string} userId
 * @param {Iterable<number|string>} creationIds
 * @returns {Promise<number>}
 */
export async function addFeedBetaSeenIdsToRedis(userId, creationIds) {
	const r = getFeedBetaRedis();
	if (!r || userId == null) return 0;
	const key = feedBetaSeenKey(userId);
	const ids = [];
	for (const id of creationIds) {
		const n = Number(id);
		if (Number.isFinite(n) && n > 0) ids.push(String(n));
	}
	if (ids.length === 0) return 0;
	try {
		const added = await r.sadd(key, ...ids);
		await r.expire(key, FEED_BETA_SEEN_TTL_SEC);
		invalidateFeedBetaSeenCache(userId);
		return Number(added) || 0;
	} catch (err) {
		console.warn('[feedBeta seenRedis] add', err?.message || err);
		return 0;
	}
}
