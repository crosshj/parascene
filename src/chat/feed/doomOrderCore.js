/**
 * Pure doom scroll ordering from accumulated `/api/feed` rows (no DOM / fetch).
 */

import { getChatFeedItemKey } from './feedChannelData.js';
import { isFeedRowVideoCreation } from '../../shared/chatFeedMobilePartition.js';

/**
 * @param {object} item
 * @param {number} startCreationId
 * @returns {boolean}
 */
export function feedRowMatchesCreation(item, startCreationId) {
	const cid = Number(item?.created_image_id ?? item?.id);
	return Number.isFinite(cid) && cid === startCreationId;
}

/**
 * Deduped video creations in feed accumulation order.
 *
 * @param {object[]} feedAccumulated
 * @param {(it: object) => string} [getItemKey]
 * @returns {{ orderedVideos: object[], videoByKey: Map<string, object> }}
 */
export function collectDedupedVideoCreationsFromFeedAccumulation(
	feedAccumulated,
	getItemKey = getChatFeedItemKey
) {
	/** @type {Map<string, object>} */
	const videoByKey = new Map();
	/** @type {object[]} */
	const orderedVideos = [];
	const list = Array.isArray(feedAccumulated) ? feedAccumulated : [];
	for (const it of list) {
		if (!isFeedRowVideoCreation(it)) continue;
		const key = getItemKey(it);
		if (videoByKey.has(key)) continue;
		videoByKey.set(key, it);
		orderedVideos.push(it);
	}
	return { orderedVideos, videoByKey };
}

/**
 * Treat doom URL as window start: keep anchor clip first; drop newer clips above anchor.
 *
 * @param {object[]} orderedVideos — deduped video rows in feed order
 * @param {number} startCreationId
 * @param {(it: object) => string} [getItemKey]
 * @returns {{ windowVideos: object[], anchorIndex: number }}
 */
export function trimDoomVideosToAnchorStart(
	orderedVideos,
	startCreationId,
	getItemKey = getChatFeedItemKey
) {
	const list = Array.isArray(orderedVideos) ? orderedVideos : [];
	const anchorIndex = list.findIndex((it) => feedRowMatchesCreation(it, startCreationId));
	if (anchorIndex < 0) {
		return { windowVideos: list.slice(), anchorIndex: -1 };
	}
	if (anchorIndex === 0) {
		return { windowVideos: list.slice(), anchorIndex: 0 };
	}
	const sliced = list.slice(anchorIndex);
	return { windowVideos: sliced, anchorIndex: 0 };
}

/**
 * Optional merge of a summary item when anchor was missing from feed pages.
 *
 * @param {object[]} orderedVideos
 * @param {object | null | undefined} summaryItem
 * @param {number} startCreationId
 * @param {(it: object) => string} [getItemKey]
 * @returns {{ orderedVideos: object[], anchorIndex: number }}
 */
export function mergeSummaryVideoIfMissingAnchor(
	orderedVideos,
	summaryItem,
	startCreationId,
	getItemKey = getChatFeedItemKey
) {
	const list = Array.isArray(orderedVideos) ? [...orderedVideos] : [];
	let anchorIndex = list.findIndex((it) => feedRowMatchesCreation(it, startCreationId));
	if (anchorIndex >= 0) {
		return { orderedVideos: list, anchorIndex };
	}
	if (
		summaryItem &&
		typeof summaryItem === 'object' &&
		isFeedRowVideoCreation(summaryItem)
	) {
		const k = getItemKey(summaryItem);
		const keys = new Set(list.map((x) => getItemKey(x)));
		if (!keys.has(k)) {
			list.push(summaryItem);
		}
		anchorIndex = list.findIndex((x) => feedRowMatchesCreation(x, startCreationId));
	}
	return { orderedVideos: list, anchorIndex };
}

/**
 * Full pipeline: accumulate → dedupe videos → optional summary → trim to anchor.
 *
 * @param {object} opts
 * @param {object[]} opts.feedAccumulated
 * @param {number} opts.startCreationId
 * @param {object | null | undefined} [opts.summaryItem] — `/api/creations/:id/summary` item when feed missed anchor
 * @param {(it: object) => string} [opts.getItemKey]
 * @returns {{ windowVideos: object[], anchorIndex: number }}
 */
export function buildDoomVideoWindowFromFeed({
	feedAccumulated,
	startCreationId,
	summaryItem = null,
	getItemKey = getChatFeedItemKey
}) {
	const { orderedVideos } = collectDedupedVideoCreationsFromFeedAccumulation(
		feedAccumulated,
		getItemKey
	);
	const merged = mergeSummaryVideoIfMissingAnchor(
		orderedVideos,
		summaryItem,
		startCreationId,
		getItemKey
	);
	if (merged.anchorIndex < 0) {
		return { windowVideos: merged.orderedVideos, anchorIndex: -1 };
	}
	return trimDoomVideosToAnchorStart(merged.orderedVideos, startCreationId, getItemKey);
}
