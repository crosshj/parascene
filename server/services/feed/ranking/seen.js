import { feedRowCreationIdKey } from "./rowMedia.js";
import { loadFeedSeenSetFromRedis } from "./seenRedis.js";

/** Max legacy meta ids merged with Redis seen. */
const SEEN_CAP = 400;

/**
 * @param {object|null|undefined} user
 * @returns {Set<string>}
 */
export function getFeedSeenSet(user) {
	const raw = user?.meta?.feedBetaSeen;
	if (!Array.isArray(raw)) return new Set();
	const out = new Set();
	for (const id of raw) {
		const s = String(id ?? '').trim();
		if (s) out.add(s);
	}
	return out;
}

/**
 * Prior ranked-feed API responses (`user.meta.feedBetaSeen`).
 * @param {object|null|undefined} row
 * @param {Set<string>} servedSeen
 * @returns {boolean}
 */
export function isFeedServedSeen(row, servedSeen) {
	const key = feedRowCreationIdKey(row);
	return Boolean(key && servedSeen instanceof Set && servedSeen.has(key));
}

/**
 * Viewer liked this creation (hydrated on catalog rows).
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isFeedViewerLiked(row) {
	return row?.viewer_liked === true;
}

/**
 * @param {number} pageIndex
 * @param {{ relaxFiltersFromPage?: number }} params
 * @returns {boolean}
 */
export function isFeedRelaxedPage(pageIndex, params) {
	const from = Math.max(1, Number(params?.relaxFiltersFromPage) || 5);
	return Math.max(1, Number(pageIndex) || 1) >= from;
}

/**
 * Skip in pool draws: already served in the ranked feed or already liked.
 * @param {object|null|undefined} row
 * @param {Set<string>} servedSeen
 * @param {{ ignoreSeen?: boolean, relaxed?: boolean }} [opts]
 * @returns {boolean}
 */
export function isFeedRowExcludedFromPools(row, servedSeen, opts = {}) {
	if (opts.ignoreSeen === true || opts.relaxed === true) return false;
	return isFeedServedSeen(row, servedSeen) || isFeedViewerLiked(row);
}

/**
 * Eligible rows left in this catalog batch after excluding served / liked / feedSeen.
 * @param {object[]} catalog
 * @param {Set<string>} servedSeen
 * @param {Set<string>} [alsoExclude]
 * @param {{ relaxed?: boolean }} [opts]
 * @returns {number}
 */
export function countFeedRemainingEligible(catalog, servedSeen, alsoExclude = null, opts = {}) {
	const extra = alsoExclude instanceof Set ? alsoExclude : new Set();
	const relaxed = opts.relaxed === true;
	let n = 0;
	for (const row of Array.isArray(catalog) ? catalog : []) {
		const key = feedRowCreationIdKey(row);
		if (!key || extra.has(key)) continue;
		if (relaxed || !isFeedRowExcludedFromPools(row, servedSeen)) n += 1;
	}
	return n;
}

/**
 * @param {object[]} catalog
 * @param {Set<string>} servedSeen
 * @returns {number}
 */
export function countFeedUnseenInCatalog(catalog, servedSeen) {
	return countFeedRemainingEligible(catalog, servedSeen);
}

/**
 * @param {object|null|undefined} user
 * @param {Iterable<string|number>} ids
 * @returns {string[]}
 */
export function mergeFeedSeenIds(user, ids) {
	const prev = getFeedSeenSet(user);
	for (const id of ids) {
		const s = String(id ?? '').trim();
		if (s) prev.add(s);
	}
	return Array.from(prev).slice(-SEEN_CAP);
}

/**
 * Legacy meta.feedBetaSeen + Redis seen set (short TTL, no Postgres on read path).
 * @param {object} queries
 * @param {object|null|undefined} user
 * @returns {Promise<Set<string>>}
 */
export async function loadFeedSeenSetForUser(queries, user) {
	void queries;
	const out = getFeedSeenSet(user);
	if (user?.id == null) return out;
	const redisSeen = await loadFeedSeenSetFromRedis(user.id);
	for (const id of redisSeen) out.add(id);
	return out;
}
