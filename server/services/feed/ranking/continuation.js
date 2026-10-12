import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from "../../../../client/shared/chatFeedMobilePartition.js";
import { isFeedRelaxedPage, countFeedRemainingEligible } from "./seen.js";
import { isFeedAssumedHasMorePage } from "./hasMore.js";
import { feedRowCreationIdKey } from "./rowMedia.js";

/**
 * @param {object} opts
 * @returns {string}
 */
export function resolveFeedHasMoreReason(opts) {
	const {
		pageIndex,
		rows,
		safeLimit,
		catalog,
		servedSeen,
		params,
		isSlotPackPageOne = false,
		sitewideCatalogSize = null,
		hasMore
	} = opts;

	if (!hasMore) {
		const servedCount = servedSeen instanceof Set ? servedSeen.size : 0;
		const siteTotal = Number(sitewideCatalogSize);
		if (Number.isFinite(siteTotal) && siteTotal > 0 && servedCount >= siteTotal) {
			return 'exhausted_site';
		}
		if (pageIndex >= params.maxPageIndex) return 'exhausted_page_cap';
		if (!Array.isArray(rows) || rows.length === 0) return 'empty_page';
		return 'underfilled_batch';
	}

	if (isFeedAssumedHasMorePage(pageIndex, params)) return 'assumed_early_pages';
	if (isFeedRelaxedPage(pageIndex, params)) return 'relaxed_deep_scroll';

	const siteTotal = Number(sitewideCatalogSize);
	const servedCount = servedSeen instanceof Set ? servedSeen.size : 0;
	if (Number.isFinite(siteTotal) && siteTotal > 0 && servedCount < siteTotal) {
		return 'site_catalog_remaining';
	}

	const servedThisPage = new Set();
	for (const row of Array.isArray(rows) ? rows : []) {
		const key = feedRowCreationIdKey(row);
		if (key) servedThisPage.add(key);
	}
	const remainingEligible = countFeedRemainingEligible(catalog, servedSeen, servedThisPage, {
		relaxed: isFeedRelaxedPage(pageIndex, params)
	});
	if (remainingEligible > 0) return 'batch_eligible_remaining';

	return 'catalog_batch_large';
}

/**
 * Client echoes `feed_ack` on the next request so page index and under-fill are known
 * even when `offset` ≠ completed_page × limit (short pages).
 *
 * @param {Record<string, unknown>} query
 * @returns {{ completed_page: number, page_filled: boolean, served_count: number } | null}
 */
export function parseFeedAckFromQuery(query) {
	const raw = query?.feed_ack;
	if (raw == null || String(raw).trim() === '') return null;
	const s = String(raw).trim();
	try {
		const json = Buffer.from(s, 'base64url').toString('utf8');
		const data = JSON.parse(json);
		const completed = Number(data?.completed_page);
		if (!Number.isFinite(completed) || completed < 1) return null;
		const sessionId = typeof data?.session_id === 'string' ? data.session_id.trim().slice(0, 64) : '';
		return {
			completed_page: completed,
			page_filled: data?.page_filled === true,
			served_count: Math.max(0, Number(data?.served_count) || 0),
			...(sessionId ? { session_id: sessionId } : {})
		};
	} catch {
		return null;
	}
}

/**
 * @param {object} opts
 * @returns {object}
 */
export function buildFeedContinuation(opts) {
	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const safeLimit = Math.min(Math.max(1, Number(opts.safeLimit) || 20), 100);
	const rowCount = Array.isArray(opts.rows) ? opts.rows.length : 0;
	const servedSeen = opts.servedSeen instanceof Set ? opts.servedSeen : new Set();
	const catalog = Array.isArray(opts.catalog) ? opts.catalog : [];
	const params = opts.params;
	const isSlotPackPageOne = Boolean(opts.isSlotPackPageOne);
	const hasMore = Boolean(opts.hasMore);

	const filledEnough =
		rowCount >= safeLimit ||
		(isSlotPackPageOne && rowCount >= MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);

	const servedThisPage = new Set();
	for (const row of opts.rows || []) {
		const key = feedRowCreationIdKey(row);
		if (key) servedThisPage.add(key);
	}
	const relaxNext = isFeedRelaxedPage(pageIndex + 1, params);
	const catalogRemaining = countFeedRemainingEligible(catalog, servedSeen, servedThisPage, {
		relaxed: isFeedRelaxedPage(pageIndex, params)
	});

	const sitewideTotal = Number(opts.sitewideCatalogSize);
	const sitewide =
		Number.isFinite(sitewideTotal) && sitewideTotal > 0 ? sitewideTotal : null;

	return {
		v: 1,
		completed_page: pageIndex,
		next_page: pageIndex + 1,
		page_filled: filledEnough,
		served_count: rowCount,
		seen_count: servedSeen.size,
		relax_filters_next: relaxNext,
		catalog_remaining: catalogRemaining,
		sitewide_total: sitewide,
		has_more: hasMore,
		has_more_reason: resolveFeedHasMoreReason({
			pageIndex,
			rows: opts.rows,
			safeLimit,
			catalog,
			servedSeen,
			params,
			isSlotPackPageOne,
			sitewideCatalogSize: sitewide,
			hasMore
		})
	};
}
