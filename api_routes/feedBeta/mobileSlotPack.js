import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { isFeedBetaRowExcludedFromPools } from './seen.js';
import { stampFeedBetaRowReason } from './reason.js';
import { scoreFeedBetaRow } from './score.js';
import {
	feedRowCreationIdKey,
	feedRowIsOtherThread,
	feedRowIsVideoThread,
	normalizeFeedBetaMediaFields
} from './rowMedia.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../../src/shared/chatFeedMobilePartition.js';

/**
 * Mobile chat `#feed` page 1 — per-slot pool priority (4v+3i × 3).
 * Maps aspirational editorial shape to v0 pool ids.
 *
 * @typedef {{ media: 'video'|'nonVideo', pool: string, fallbacks: string[] }} MobileSlotSpec
 */

/** @type {MobileSlotSpec[]} */
export const MOBILE_CHAT_EDITORIAL_SLOT_PLAN = [
	{ media: 'video', pool: 'hot_24h', fallbacks: ['hot_7d', 'recent_comment', 'new', 'catalog_unseen'] },
	{ media: 'video', pool: 'hot_24h', fallbacks: ['hot_7d', 'recent_comment', 'new', 'catalog_unseen'] },
	{ media: 'video', pool: 'recent_comment', fallbacks: ['hot_24h', 'hot_7d', 'new', 'catalog_unseen'] },
	{ media: 'video', pool: 'hot_7d', fallbacks: ['hot_24h', 'recent_comment', 'catalog_unseen', 'new'] },
	{ media: 'nonVideo', pool: 'hot_24h', fallbacks: ['hot_7d', 'new', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
	{ media: 'nonVideo', pool: 'catalog_unseen', fallbacks: ['hot_7d', 'new', 'newcomer'] },
	{ media: 'video', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
	{ media: 'video', pool: 'hot_24h', fallbacks: ['hot_7d', 'recent_comment', 'catalog_unseen'] },
	{ media: 'video', pool: 'catalog_unseen', fallbacks: ['hot_7d', 'new', 'newcomer'] },
	{ media: 'video', pool: 'newcomer', fallbacks: ['new', 'catalog_unseen', 'hot_7d'] },
	{ media: 'nonVideo', pool: 'hot_7d', fallbacks: ['hot_24h', 'recent_comment', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'recent_comment', fallbacks: ['hot_7d', 'hot_24h', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'catalog_unseen', fallbacks: ['new', 'hot_7d', 'newcomer'] },
	{ media: 'video', pool: 'hot_7d', fallbacks: ['hot_24h', 'catalog_unseen', 'new'] },
	{ media: 'video', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
	{ media: 'video', pool: 'catalog_unseen', fallbacks: ['hot_7d', 'new', 'newcomer'] },
	{ media: 'video', pool: 'newcomer', fallbacks: ['new', 'catalog_unseen', 'hot_7d'] },
	{ media: 'nonVideo', pool: 'follow_sprinkle', fallbacks: ['hot_7d', 'catalog_unseen', 'new'] },
	{ media: 'nonVideo', pool: 'own_activity', fallbacks: ['recent_comment', 'follow_sprinkle', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'own_activity', fallbacks: ['recent_comment', 'follow_sprinkle', 'catalog_unseen'] }
];

function rowVisible(row, enableNsfw, viewerUserId, showOwnPosts) {
	if (!row || typeof row !== 'object') return false;
	if (!enableNsfw && row.nsfw) return false;
	if (!feedRowCreationIdKey(row)) return false;
	if (!showOwnPosts && viewerUserId != null && String(row.user_id) === String(viewerUserId)) {
		return false;
	}
	return true;
}

/**
 * @param {object} entry
 * @param {string} poolId
 * @param {number} viewerUserId
 */
function entryMatchesPool(entry, poolId, viewerUserId) {
	const row = entry.row;
	switch (poolId) {
		case 'hot_24h':
			return entry.inHot24 && entry.engagement > 0;
		case 'hot_7d':
			return entry.inHot7 && entry.engagement > 0 && !entry.inHot24;
		case 'new':
			return entry.isNewPublish;
		case 'newcomer':
			return entry.isNewcomer;
		case 'catalog_unseen':
			return true;
		case 'recent_comment':
			return Number(row?.comment_count ?? 0) > 0;
		case 'follow_sprinkle':
			return entry.isFollow;
		case 'own_activity':
			return (
				viewerUserId != null &&
				String(row?.user_id) === String(viewerUserId) &&
				(Number(row?.like_count ?? 0) > 0 || Number(row?.comment_count ?? 0) > 0)
			);
		default:
			return false;
	}
}

/**
 * @param {object[]} entries
 * @param {string} poolId
 */
function sortPoolEntries(entries, poolId) {
	const copy = entries.slice();
	if (poolId === 'recent_comment') {
		copy.sort(
			(a, b) =>
				Number(b.row?.comment_count ?? 0) - Number(a.row?.comment_count ?? 0) ||
				b.score - a.score
		);
		return copy;
	}
	if (poolId === 'new') {
		copy.sort((a, b) => a.ageHours - b.ageHours || b.score - a.score);
		return copy;
	}
	if (poolId === 'hot_24h' || poolId === 'hot_7d') {
		copy.sort((a, b) => b.engagement - a.engagement || b.score - a.score);
		return copy;
	}
	copy.sort((a, b) => b.score - a.score);
	return copy;
}

/**
 * Draw mobile slot-pack page 1 in editorial slot order (21 structured slots).
 * @param {object[]} catalog
 * @param {object} opts
 * @returns {object[]}
 */
export function drawMobileEditorialSlotPackPage(catalog, opts) {
	const params = FEED_BETA_DEFAULT_PARAMS;
	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const seen = opts.ignoreSeen === true ? new Set() : opts.seen instanceof Set ? opts.seen : new Set();
	const skipSeenFilter = opts.ignoreSeen === true;
	const enableNsfw = opts.enableNsfw === true;
	const viewerUserId = opts.viewerUserId;
	const showOwnPosts = opts.showOwnPosts === true;
	const ctx = opts.scoreContext;
	const stampBase = {
		thread: null,
		page_index: pageIndex,
		page_seed: opts.pageSeed ?? opts.shuffleSeed,
		source: 'mobile_slot_draw',
		ignore_seen: opts.ignoreSeen === true,
		relax_filters: false
	};

	const scoredEntries = [];
	for (const raw of Array.isArray(catalog) ? catalog : []) {
		const row = normalizeFeedBetaMediaFields(raw);
		if (!rowVisible(row, enableNsfw, viewerUserId, showOwnPosts)) continue;
		const key = feedRowCreationIdKey(row);
		if (!key || isFeedBetaRowExcludedFromPools(row, seen, { relaxed: false })) continue;
		const isVideo = feedRowIsVideoThread(row);
		const isOther = feedRowIsOtherThread(row);
		if (!isVideo && !isOther) continue;
		scoredEntries.push({
			row,
			isVideo,
			isOther,
			isOwn: viewerUserId != null && String(row.user_id) === String(viewerUserId),
			...scoreFeedBetaRow(row, ctx)
		});
	}

	const videoEntries = scoredEntries.filter((entry) => entry.isVideo);
	const nonVideoEntries = scoredEntries.filter((entry) => entry.isOther);
	const ownVideoEntries = scoredEntries.filter((entry) => entry.isVideo && entry.isOwn);
	const ownNonVideoEntries = scoredEntries.filter((entry) => entry.isOther && entry.isOwn);

	const used = new Set();
	const out = [];
	const slotPlan = MOBILE_CHAT_EDITORIAL_SLOT_PLAN.slice(0, MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);

	for (let slotIndex = 0; slotIndex < slotPlan.length; slotIndex += 1) {
		const spec = slotPlan[slotIndex];
		const poolIds = [spec.pool, ...(spec.fallbacks ?? [])];
		let baseEntries = spec.media === 'video' ? videoEntries : nonVideoEntries;
		if (poolIds.includes('own_activity')) {
			baseEntries = [
				...baseEntries,
				...(spec.media === 'video' ? ownVideoEntries : ownNonVideoEntries)
			];
		}

		let picked = null;
		let pickedPool = null;
		for (const poolId of poolIds) {
			const candidates = sortPoolEntries(
				baseEntries.filter(
					(entry) =>
						entryMatchesPool(entry, poolId, viewerUserId) &&
						!used.has(feedRowCreationIdKey(entry.row))
				),
				poolId
			);
			if (candidates.length > 0) {
				picked = candidates[0];
				pickedPool = poolId;
				break;
			}
		}

		if (!picked) {
			const remainder = sortPoolEntries(
				baseEntries.filter((entry) => !used.has(feedRowCreationIdKey(entry.row))),
				'catalog_unseen'
			);
			if (remainder.length > 0) {
				picked = remainder[0];
				pickedPool = 'fill_remainder';
			}
		}

		if (!picked) continue;

		const key = feedRowCreationIdKey(picked.row);
		if (!key) continue;
		used.add(key);

		const thread = spec.media === 'video' ? 'video' : 'other';
		out.push(
			stampFeedBetaRowReason(
				picked.row,
				{
					...stampBase,
					pool: pickedPool,
					thread,
					mobile_slot_index: slotIndex + 1,
					mobile_slot_media: spec.media
				},
				picked
			)
		);
	}

	return out.slice(0, params.slotPackVideoCap + params.slotPackOtherCap);
}
