import { interleaveSlotPackHead } from '../feed/pullMobileChatSlotPackFeed.js';
import {
	MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS,
	MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN,
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from '../../src/shared/chatFeedMobilePartition.js';
import { authorCountsFromRows, enforceCreatorCapOnPage, rowEngagementScore } from './creatorCap.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { appendFeedBetaMergeReason } from './reason.js';
import { feedRowCreationIdKey, feedRowIsVideoThread } from './rowMedia.js';

/**
 * @param {object|null|undefined} row
 * @returns {number}
 */
export function feedBetaRowCreatedAtMs(row) {
	const ms = Date.parse(String(row?.created_at ?? ''));
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * Page 1 (and post-fill): strict newest-first by `created_at`.
 * @param {object[]} rows
 * @returns {object[]}
 */
export function sortFeedBetaRowsNewestFirst(rows) {
	return (Array.isArray(rows) ? rows : [])
		.slice()
		.sort((a, b) => feedBetaRowCreatedAtMs(b) - feedBetaRowCreatedAtMs(a));
}

/**
 * @param {object[]} videos
 * @param {object[]} others
 * @param {number} max
 * @returns {object[]}
 */
function mergePageOneNewestFirst(videos, others, max) {
	return sortFeedBetaRowsNewestFirst([...videos, ...others]).slice(0, max);
}

function roundRobinTail(videos, others, max) {
	const out = [];
	let vi = 0;
	let oi = 0;
	while (out.length < max && (vi < videos.length || oi < others.length)) {
		if (vi < videos.length) out.push(videos[vi++]);
		if (out.length >= max) break;
		if (oi < others.length) out.push(others[oi++]);
	}
	return out;
}

/**
 * @param {object[]} videoRows
 * @param {object[]} otherRows
 * @returns {{ videos: object[], others: object[] }}
 */
function sortNewestFirst(videoRows, otherRows) {
	const byNew = (a, b) => feedBetaRowCreatedAtMs(b) - feedBetaRowCreatedAtMs(a);
	return {
		videos: videoRows.slice().sort(byNew),
		others: otherRows.slice().sort(byNew)
	};
}

/**
 * @param {object[]} videos
 * @param {object[]} others
 * @param {Set<string>} usedKeys
 * @returns {object[]}
 */
function spareRowsForCreatorCap(videos, others, usedKeys) {
	return [...videos, ...others]
		.filter((row) => {
			const key = feedRowCreationIdKey(row);
			return key && !usedKeys.has(key);
		})
		.sort((a, b) => rowEngagementScore(b) - rowEngagementScore(a));
}

/**
 * @param {object[]} rows
 * @param {object[]} videos
 * @param {object[]} others
 * @param {number} limit
 * @returns {object[]}
 */
function applyPageCreatorCap(rows, videos, others, limit) {
	const usedKeys = new Set();
	for (const row of rows) {
		const key = feedRowCreationIdKey(row);
		if (key) usedKeys.add(key);
	}
	const spare = spareRowsForCreatorCap(videos, others, usedKeys);
	return enforceCreatorCapOnPage(rows, {
		limit,
		spareRows: spare,
		maxPerCreator: FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage
	});
}

/**
 * @param {object} opts
 * @param {object[]} opts.videoRows
 * @param {object[]} opts.otherRows
 * @param {number} opts.limit
 * @param {boolean} opts.slotPackPageOne
 * @param {number} [opts.pageIndex]
 * @returns {{ rows: object[] }}
 */
export function mergeBetaPage({ videoRows, otherRows, limit, slotPackPageOne, pageIndex = 1 }) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const page = Math.max(1, Number(pageIndex) || 1);
	const pageOneChronological = page === 1;
	const { videos, others } = sortNewestFirst(videoRows, otherRows);

	if (slotPackPageOne) {
		const headBudget = Math.min(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN, safeLimit);
		const headVideos = videos.slice(
			0,
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
		);
		const headOthers = others.slice(
			0,
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS
		);
		const headRaw = interleaveSlotPackHead(headVideos, headOthers).slice(0, headBudget);
		const head = headRaw.map((row, index) => {
			const layout = feedRowIsVideoThread(row)
				? 'slot_pack_head_video'
				: 'slot_pack_head_image';
			return appendFeedBetaMergeReason(row, {
				merge_layout: layout,
				position_in_page: index + 1
			});
		});
		const usedV = new Set();
		const usedO = new Set();
		for (const row of head) {
			const id = Number(row.created_image_id ?? row.id);
			if (feedRowIsVideoThread(row)) usedV.add(id);
			else usedO.add(id);
		}
		const tailVideos = videos.filter((r) => !usedV.has(Number(r.created_image_id ?? r.id)));
		const tailOthers = others.filter((r) => !usedO.has(Number(r.created_image_id ?? r.id)));
		const tailBudget = Math.max(0, safeLimit - head.length);
		const tailRaw = pageOneChronological
			? mergePageOneNewestFirst(tailVideos, tailOthers, tailBudget)
			: roundRobinTail(tailVideos, tailOthers, tailBudget);
		const tail = tailRaw.map((row, i) =>
			appendFeedBetaMergeReason(row, {
				merge_layout: pageOneChronological ? 'page_one_chronological' : 'slot_pack_tail',
				position_in_page: head.length + i + 1
			})
		);
		const headKeys = new Set();
		for (const row of head) {
			const key = feedRowCreationIdKey(row);
			if (key) headKeys.add(key);
		}
		const tailSpare = spareRowsForCreatorCap(tailVideos, tailOthers, headKeys);
		const cappedTail = enforceCreatorCapOnPage(tail, {
			limit: tailBudget,
			spareRows: tailSpare,
			maxPerCreator: FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage,
			seedAuthorCounts: authorCountsFromRows(head)
		});
		const sortedTail = pageOneChronological ? sortFeedBetaRowsNewestFirst(cappedTail) : cappedTail;
		return { rows: [...head, ...sortedTail] };
	}

	const mergedRaw = pageOneChronological
		? mergePageOneNewestFirst(videos, others, safeLimit)
		: roundRobinTail(videos, others, safeLimit);
	const mergeLayout = pageOneChronological ? 'page_one_chronological' : 'round_robin';
	const merged = mergedRaw.map((row, i) =>
		appendFeedBetaMergeReason(row, { merge_layout: mergeLayout, position_in_page: i + 1 })
	);
	const capped = applyPageCreatorCap(merged, videos, others, safeLimit);
	return {
		rows: pageOneChronological ? sortFeedBetaRowsNewestFirst(capped) : capped
	};
}
