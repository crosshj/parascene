import { interleaveSlotPackHead } from '../feed/pullMobileChatSlotPackFeed.js';
import {
	MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS,
	MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN,
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from '../../src/shared/chatFeedMobilePartition.js';
import { authorCountsFromRows, enforceCreatorCapOnPage } from './creatorCap.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { appendFeedBetaMergeReason } from './reason.js';
import { feedRowCreationIdKey, feedRowIsVideoThread } from './rowMedia.js';

/**
 * @param {object[]} videos — newest first
 * @param {object[]} others — newest first
 * @returns {object[]}
 */
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
	const byNew = (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
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
function spareRowsNewestFirst(videos, others, usedKeys) {
	const byNew = (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
	return [...videos, ...others]
		.filter((row) => {
			const key = feedRowCreationIdKey(row);
			return key && !usedKeys.has(key);
		})
		.sort(byNew);
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
	const spare = spareRowsNewestFirst(videos, others, usedKeys);
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
 * @returns {{ rows: object[] }}
 */
export function mergeBetaPage({ videoRows, otherRows, limit, slotPackPageOne }) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
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
		const tailRaw = roundRobinTail(tailVideos, tailOthers, Math.max(0, safeLimit - head.length));
		const tail = tailRaw.map((row, i) =>
			appendFeedBetaMergeReason(row, {
				merge_layout: 'slot_pack_tail',
				position_in_page: head.length + i + 1
			})
		);
		const headKeys = new Set();
		for (const row of head) {
			const key = feedRowCreationIdKey(row);
			if (key) headKeys.add(key);
		}
		const tailSpare = spareRowsNewestFirst(tailVideos, tailOthers, headKeys);
		const tailBudget = Math.max(0, safeLimit - head.length);
		const cappedTail = enforceCreatorCapOnPage(tail, {
			limit: tailBudget,
			spareRows: tailSpare,
			maxPerCreator: FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage,
			seedAuthorCounts: authorCountsFromRows(head)
		});
		return { rows: [...head, ...cappedTail] };
	}

	const mergedRaw = roundRobinTail(videos, others, safeLimit);
	const merged = mergedRaw.map((row, i) =>
		appendFeedBetaMergeReason(row, { merge_layout: 'round_robin', position_in_page: i + 1 })
	);
	return { rows: applyPageCreatorCap(merged, videos, others, safeLimit) };
}
