import { feedRowCreationIdKey } from './rowMedia.js';

const SEEN_CAP = 400;

/**
 * @param {object|null|undefined} user
 * @returns {Set<string>}
 */
export function getFeedBetaSeenSet(user) {
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
 * Prior Feed [beta] API responses (`user.meta.feedBetaSeen`).
 * @param {object|null|undefined} row
 * @param {Set<string>} servedSeen
 * @returns {boolean}
 */
export function isFeedBetaServedSeen(row, servedSeen) {
	const key = feedRowCreationIdKey(row);
	return Boolean(key && servedSeen instanceof Set && servedSeen.has(key));
}

/**
 * Viewer liked this creation (hydrated on catalog rows).
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isFeedBetaViewerLiked(row) {
	return row?.viewer_liked === true;
}

/**
 * @param {number} pageIndex
 * @param {{ relaxFiltersFromPage?: number }} params
 * @returns {boolean}
 */
export function isFeedBetaRelaxedPage(pageIndex, params) {
	const from = Math.max(1, Number(params?.relaxFiltersFromPage) || 5);
	return Math.max(1, Number(pageIndex) || 1) >= from;
}

/**
 * Skip in pool draws: already served in Feed [beta] or already liked.
 * @param {object|null|undefined} row
 * @param {Set<string>} servedSeen
 * @param {{ ignoreSeen?: boolean, relaxed?: boolean }} [opts]
 * @returns {boolean}
 */
export function isFeedBetaRowExcludedFromPools(row, servedSeen, opts = {}) {
	if (opts.ignoreSeen === true || opts.relaxed === true) return false;
	return isFeedBetaServedSeen(row, servedSeen) || isFeedBetaViewerLiked(row);
}

/**
 * Eligible rows left in this catalog batch after excluding served / liked / feedBetaSeen.
 * @param {object[]} catalog
 * @param {Set<string>} servedSeen
 * @param {Set<string>} [alsoExclude]
 * @param {{ relaxed?: boolean }} [opts]
 * @returns {number}
 */
export function countFeedBetaRemainingEligible(catalog, servedSeen, alsoExclude = null, opts = {}) {
	const extra = alsoExclude instanceof Set ? alsoExclude : new Set();
	const relaxed = opts.relaxed === true;
	let n = 0;
	for (const row of Array.isArray(catalog) ? catalog : []) {
		const key = feedRowCreationIdKey(row);
		if (!key || extra.has(key)) continue;
		if (relaxed || !isFeedBetaRowExcludedFromPools(row, servedSeen)) n += 1;
	}
	return n;
}

/**
 * @param {object[]} catalog
 * @param {Set<string>} servedSeen
 * @returns {number}
 */
export function countFeedBetaUnseenInCatalog(catalog, servedSeen) {
	return countFeedBetaRemainingEligible(catalog, servedSeen);
}

/**
 * @param {object|null|undefined} user
 * @param {Iterable<string|number>} ids
 * @returns {string[]}
 */
export function mergeFeedBetaSeenIds(user, ids) {
	const prev = getFeedBetaSeenSet(user);
	for (const id of ids) {
		const s = String(id ?? '').trim();
		if (s) prev.add(s);
	}
	return Array.from(prev).slice(-SEEN_CAP);
}
