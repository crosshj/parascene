import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../../src/shared/chatFeedMobilePartition.js';
import { feedRowCreationIdKey } from './rowMedia.js';
import { isFeedBetaRelaxedPage, countFeedBetaRemainingEligible } from './seen.js';

/**
 * @param {number} pageIndex
 * @param {{ hasMoreThroughPage?: number }} params
 * @returns {boolean}
 */
export function isFeedBetaAssumedHasMorePage(pageIndex, params) {
	const through = Math.max(1, Number(params?.hasMoreThroughPage) || 5);
	return Math.max(1, Number(pageIndex) || 1) <= through;
}

/**
 * Whether beta feed pagination should continue after this page.
 *
 * When `sitewideCatalogSize` is set, scroll continues until `feedBetaSeen` covers
 * the published sitewide catalog (not when a candidate batch or page cap runs out).
 *
 * @param {object} opts
 * @param {number} opts.pageIndex
 * @param {object[]} opts.rows
 * @param {number} opts.safeLimit
 * @param {object[]} opts.catalog
 * @param {Set<string>} opts.servedSeen
 * @param {{ maxPageIndex: number, hasMoreThroughPage?: number }} opts.params
 * @param {boolean} [opts.isSlotPackPageOne]
 * @param {number|null|undefined} [opts.sitewideCatalogSize]
 * @returns {boolean}
 */
export function computeBetaHasMore({
	pageIndex,
	rows,
	safeLimit,
	catalog,
	servedSeen,
	params,
	isSlotPackPageOne = false,
	sitewideCatalogSize = null
}) {
	const servedCount = servedSeen instanceof Set ? servedSeen.size : 0;
	const siteTotal = Number(sitewideCatalogSize);
	const hasSiteTotal = Number.isFinite(siteTotal) && siteTotal > 0;

	if (hasSiteTotal && servedCount >= siteTotal) {
		return false;
	}

	const rowCount = Array.isArray(rows) ? rows.length : 0;

	if (hasSiteTotal && servedCount < siteTotal) {
		return rowCount > 0;
	}

	if (pageIndex >= params.maxPageIndex) return false;
	if (rowCount === 0) return false;

	if (isFeedBetaAssumedHasMorePage(pageIndex, params)) return true;

	if (isFeedBetaRelaxedPage(pageIndex, params)) return true;

	const catalogSize = Array.isArray(catalog) ? catalog.length : 0;
	const servedThisPage = new Set();
	for (const row of rows) {
		const key = feedRowCreationIdKey(row);
		if (key) servedThisPage.add(key);
	}
	const remainingEligible = countFeedBetaRemainingEligible(catalog, servedSeen, servedThisPage, {
		relaxed: isFeedBetaRelaxedPage(pageIndex, params)
	});

	const filledEnough =
		rowCount >= safeLimit ||
		(isSlotPackPageOne && rowCount >= MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);

	if (!filledEnough) return false;

	if (remainingEligible > 0) return true;

	if (catalogSize >= safeLimit) return true;

	return false;
}
