import { authorCountsFromRows } from "./creatorCap.js";
import { FEED_DEFAULT_PARAMS } from "./params.js";
import { stampFeedRowReason } from "./reason.js";
import { feedRowCreationIdKey, normalizeFeedMediaFields } from "./rowMedia.js";
import { isFeedRelaxedPage, isFeedRowExcludedFromPools } from "./seen.js";

/**
 * @param {object|null|undefined} row
 * @param {object} opts
 * @returns {boolean}
 */
function rowEligibleForPageFill(row, opts) {
	if (!row || typeof row !== 'object') return false;
	if (!opts.enableNsfw && row.nsfw) return false;
	if (!feedRowCreationIdKey(row)) return false;
	if (
		!opts.showOwnPosts &&
		opts.viewerUserId != null &&
		String(row.user_id) === String(opts.viewerUserId)
	) {
		return false;
	}
	const key = feedRowCreationIdKey(row);
	if (key && opts.excludeKeys.has(key)) return false;
	if (isFeedRowExcludedFromPools(row, opts.servedSeen, { relaxed: opts.relaxed })) {
		return false;
	}
	return true;
}

/**
 * Prefer authors with fewer slots on this page so creator cap does not strand a short page.
 * @param {object[]} rows
 * @param {Map<string, number>} authorCounts
 * @param {number} maxPerCreator
 */
function sortCandidatesForPageFill(rows, authorCounts, maxPerCreator) {
	const cap = Math.max(1, Number(maxPerCreator) || 2);
	return rows.slice().sort((a, b) => {
		const ua = String(a.user_id ?? '');
		const ub = String(b.user_id ?? '');
		const ca = ua ? authorCounts.get(ua) || 0 : 0;
		const cb = ub ? authorCounts.get(ub) || 0 : 0;
		const aBlocked = ua && ca >= cap;
		const bBlocked = ub && cb >= cap;
		if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
		if (ca !== cb) return ca - cb;
		return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
	});
}

/**
 * Append ranked/catalog/random candidates until `safeLimit` or candidates exhausted.
 *
 * @param {object[]} existing
 * @param {object[]} candidates
 * @param {object} opts
 * @returns {object[]}
 */
export function appendFeedPageFillCandidates(existing, candidates, opts) {
	const params = FEED_DEFAULT_PARAMS;
	const safeLimit = Math.min(Math.max(1, Number(opts.safeLimit) || 20), 100);
	const out = Array.isArray(existing) ? [...existing] : [];
	if (out.length >= safeLimit) return out;

	const servedSeen = opts.servedSeen instanceof Set ? opts.servedSeen : new Set();
	const excludeKeys = new Set();
	for (const row of out) {
		const key = feedRowCreationIdKey(row);
		if (key) excludeKeys.add(key);
	}

	const authorCounts = authorCountsFromRows(out);
	const maxPerCreator = params.maxCreationsPerAuthorPerPage;
	const filterOpts = {
		enableNsfw: opts.enableNsfw === true,
		showOwnPosts: opts.showOwnPosts === true,
		viewerUserId: opts.viewerUserId,
		excludeKeys,
		servedSeen,
		relaxed: opts.relaxFilters === true
	};

	const eligible = [];
	for (const raw of Array.isArray(candidates) ? candidates : []) {
		const row = normalizeFeedMediaFields(raw);
		if (!rowEligibleForPageFill(row, filterOpts)) continue;
		eligible.push(row);
	}

	const sorted = sortCandidatesForPageFill(eligible, authorCounts, maxPerCreator);
	const stampBase = opts.stampBase ?? {
		pool: 'page_fill',
		thread: null,
		page_index: opts.pageIndex ?? 1,
		page_seed: opts.pageSeed ?? null,
		source: 'page_fill',
		relax_filters: filterOpts.relaxed
	};

	for (const row of sorted) {
		if (out.length >= safeLimit) break;
		const key = feedRowCreationIdKey(row);
		const uid = String(row.user_id ?? '');
		if (uid) {
			const n = authorCounts.get(uid) || 0;
			if (n >= maxPerCreator) continue;
			authorCounts.set(uid, n + 1);
		}
		if (key) excludeKeys.add(key);

		out.push(stampFeedRowReason(row, stampBase, null));
	}

	return out;
}

/**
 * Backfill from the in-memory candidate catalog (same request batch).
 * @param {object[]} rows
 * @param {object[]} catalog
 * @param {object} opts
 * @returns {object[]}
 */
export function fillFeedPageFromCatalog(rows, catalog, opts) {
	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const relaxed =
		opts.forceRelaxFill === true ||
		opts.relaxFilters === true ||
		pageIndex <= (FEED_DEFAULT_PARAMS.pageFillRelaxSeenFromPage ?? 1);
	return appendFeedPageFillCandidates(rows, catalog, {
		...opts,
		relaxFilters: relaxed,
		stampBase: {
			pool: 'page_fill',
			thread: null,
			page_index: pageIndex,
			page_seed: opts.pageSeed ?? null,
			source: 'page_fill_catalog',
			relax_filters: relaxed
		}
	});
}

/**
 * Once ranked pools stop filling pages, walk the sitewide catalog newest → oldest from the
 * session cursor, skipping anything served this session. Seen items stay eligible: heavy
 * viewers can have seen most of the site, and this walk is what keeps their feed going.
 * Mutates `session`.
 *
 * @param {object} queries
 * @param {number} userId
 * @param {object} opts
 * @param {object[]} opts.rows
 * @param {number} opts.safeLimit
 * @param {{ served: Set<string>, tail: object|null, tailExhausted: boolean }} opts.session
 * @param {number} opts.pageIndex
 * @param {string} opts.pageSeed
 * @param {boolean} opts.enableNsfw
 * @param {boolean} opts.showOwnPosts
 * @returns {Promise<object[]>}
 */
export async function fillFeedPageFromPast(queries, userId, opts) {
	let rows = Array.isArray(opts.rows) ? opts.rows : [];
	const safeLimit = Math.min(Math.max(1, Number(opts.safeLimit) || 20), 100);
	const session = opts.session;
	const getOlderThan = queries?.selectFeedSitewideCatalog?.getOlderThan;
	if (!session || typeof getOlderThan !== 'function') return rows;

	const exclude = new Set(session.served);
	for (const row of rows) {
		const key = feedRowCreationIdKey(row);
		if (key) exclude.add(key);
	}
	const stampBase = {
		pool: 'from_the_past',
		thread: null,
		page_index: opts.pageIndex ?? 1,
		page_seed: opts.pageSeed ?? null,
		source: 'session_past',
		relax_filters: true
	};
	for (let attempt = 0; attempt < 5 && rows.length < safeLimit && !session.tailExhausted; attempt += 1) {
		const page = await getOlderThan(userId, {
			beforeCreatedAt: session.tail?.created_at ?? null,
			beforeId: session.tail?.created_image_id ?? null,
			limit: safeLimit - rows.length,
			exclude
		});
		if (page.cursor) session.tail = page.cursor;
		if (page.exhausted) session.tailExhausted = true;
		for (const row of page.rows) {
			const key = feedRowCreationIdKey(row);
			if (key) exclude.add(key);
		}
		rows = appendFeedPageFillCandidates(rows, page.rows, {
			safeLimit,
			servedSeen: new Set(),
			relaxFilters: true,
			enableNsfw: opts.enableNsfw === true,
			showOwnPosts: opts.showOwnPosts === true,
			viewerUserId: userId,
			pageIndex: opts.pageIndex,
			pageSeed: opts.pageSeed,
			stampBase
		});
	}
	return rows;
}

/**
 * Honor client `limit`: ranked merge + creator cap can under-fill; backfill with
 * diversity-first catalog/random rows (relaxed seen/liked on page 1 fill).
 *
 * @param {object} queries
 * @param {number} userId
 * @param {object} opts
 * @param {object[]} opts.rows
 * @param {number} opts.safeLimit
 * @param {string} opts.pageSeed
 * @param {number} opts.pageIndex
 * @param {Set<string>} opts.servedSeen
 * @param {boolean} opts.enableNsfw
 * @param {boolean} opts.showOwnPosts
 * @param {object[]} [opts.catalog]
 * @returns {Promise<object[]>}
 */
export async function ensureFeedPageFilledToLimit(queries, userId, opts) {
	let rows = Array.isArray(opts.rows) ? opts.rows : [];
	const safeLimit = Math.min(Math.max(1, Number(opts.safeLimit) || 20), 100);
	if (rows.length >= safeLimit) return rows;

	const params = FEED_DEFAULT_PARAMS;
	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const pageSeed = opts.pageSeed != null ? String(opts.pageSeed) : String(userId);
	const servedSeen = opts.servedSeen instanceof Set ? opts.servedSeen : new Set();
	const fillOpts = {
		safeLimit,
		pageSeed,
		pageIndex,
		servedSeen,
		enableNsfw: opts.enableNsfw === true,
		showOwnPosts: opts.showOwnPosts === true,
		viewerUserId: userId
	};

	const catalog = Array.isArray(opts.catalog) ? opts.catalog : [];
	const catalogFromSnapshot = opts.catalogFromSnapshot === true;
	if (catalog.length > 0) {
		rows = fillFeedPageFromCatalog(rows, catalog, {
			...fillOpts,
			forceRelaxFill:
				opts.forceRelaxFill === true || (catalogFromSnapshot && pageIndex >= 2)
		});
	}
	if (rows.length >= safeLimit) return rows;

	const getRandom = queries.selectFeedSitewideCatalog?.getRandomSlice;
	if (typeof getRandom !== 'function') return rows;

	const maxAttempts = catalogFromSnapshot
		? 1
		: Math.max(1, Number(params.pageFillMaxRandomAttempts) || 4);
	const strictRelaxed = isFeedRelaxedPage(pageIndex, params);
	const relaxFill =
		opts.forceRelaxFill === true ||
		pageIndex <= (params.pageFillRelaxSeenFromPage ?? 1) ||
		strictRelaxed;

	for (let attempt = 0; attempt < maxAttempts && rows.length < safeLimit; attempt += 1) {
		const needed = safeLimit - rows.length;
		const fetchLimit = Math.min(
			catalogFromSnapshot
				? Math.min(params.randomFallbackFetchLimit, Math.max(needed * 8, needed + 16))
				: params.randomFallbackFetchLimit,
			Math.max(needed * 12, needed + 24)
		);
		let candidates = [];
		try {
			candidates = await getRandom(userId, {
				seed: `${pageSeed}:page-fill:${attempt}`,
				limit: fetchLimit
			});
		} catch {
			continue;
		}
		rows = appendFeedPageFillCandidates(rows, candidates, {
			...fillOpts,
			relaxFilters: relaxFill || attempt > 0,
			stampBase: {
				pool: 'page_fill',
				thread: null,
				page_index: pageIndex,
				page_seed: pageSeed,
				source: 'page_fill_random',
				relax_filters: relaxFill || attempt > 0
			}
		});
	}

	return rows;
}
