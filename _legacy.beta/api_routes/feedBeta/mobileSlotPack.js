import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { isFeedBetaRowExcludedFromPools } from './seen.js';
import { stampFeedBetaRowReason } from './reason.js';
import { feedBetaRowCreatedAtMs } from './mergeBetaPage.js';
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
 * Video slots are filled newest-first (legacy slot-pack head behavior).
 * Non-video slots use pool ids below.
 *
 * @typedef {{ media: 'video'|'nonVideo', pool: string, fallbacks: string[] }} MobileSlotSpec
 */

/** @type {MobileSlotSpec[]} */
export const MOBILE_CHAT_EDITORIAL_SLOT_PLAN = [
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_24h', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_24h', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_24h', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_24h', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'new', fallbacks: ['hot_24h', 'hot_7d', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
	{ media: 'nonVideo', pool: 'catalog_unseen', fallbacks: ['hot_7d', 'new', 'newcomer'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_24h', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_7d', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'catalog_unseen', 'hot_7d'] },
	{ media: 'video', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
	{ media: 'nonVideo', pool: 'new', fallbacks: ['recent_comment', 'hot_7d', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'recent_comment', fallbacks: ['hot_7d', 'hot_24h', 'catalog_unseen'] },
	{ media: 'nonVideo', pool: 'catalog_unseen', fallbacks: ['new', 'hot_7d', 'newcomer'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'hot_7d', 'catalog_unseen'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'catalog_unseen', 'hot_7d'] },
	{ media: 'video', pool: 'new', fallbacks: ['recent_comment', 'catalog_unseen', 'newcomer'] },
	{ media: 'video', pool: 'new', fallbacks: ['newcomer', 'catalog_unseen', 'hot_7d'] },
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
 * Site-wide spotlight videos: newest first, never filtered by seen (legacy slot-pack head).
 *
 * @param {object[]} videoHead — `snapshot.video_head` or live site video page
 * @param {object[]} catalog — full candidate catalog for fallback
 * @param {object} ctx — score context
 * @param {{ enableNsfw?: boolean, viewerUserId?: number, showOwnPosts?: boolean }} opts
 * @returns {object[]}
 */
function buildSpotlightVideoQueue(videoHead, catalog, ctx, opts) {
	const enableNsfw = opts.enableNsfw === true;
	const viewerUserId = opts.viewerUserId;
	const showOwnPosts = opts.showOwnPosts === true;
	const used = new Set();
	/** @type {object[]} */
	const out = [];

	const pushVideo = (raw, pool) => {
		const row = normalizeFeedBetaMediaFields(raw);
		if (!rowVisible(row, enableNsfw, viewerUserId, showOwnPosts)) return;
		if (!feedRowIsVideoThread(row)) return;
		const key = feedRowCreationIdKey(row);
		if (!key || used.has(key)) return;
		used.add(key);
		out.push({
			row,
			isVideo: true,
			isOther: false,
			isOwn: viewerUserId != null && String(row.user_id) === String(viewerUserId),
			pool,
			...scoreFeedBetaRow(row, ctx)
		});
	};

	const headList = Array.isArray(videoHead) ? videoHead : [];
	const sortedHead = headList
		.slice()
		.sort((a, b) => feedBetaRowCreatedAtMs(b) - feedBetaRowCreatedAtMs(a));
	for (const raw of sortedHead) {
		pushVideo(raw, 'site_video_head');
	}

	const catalogList = Array.isArray(catalog) ? catalog : [];
	const sortedCatalog = catalogList
		.slice()
		.sort((a, b) => feedBetaRowCreatedAtMs(b) - feedBetaRowCreatedAtMs(a));
	for (const raw of sortedCatalog) {
		if (out.length >= FEED_BETA_DEFAULT_PARAMS.slotPackVideoCap + 12) break;
		pushVideo(raw, 'new');
	}

	return out;
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
		if (!feedRowIsOtherThread(row)) continue;
		scoredEntries.push({
			row,
			isVideo: false,
			isOther: true,
			isOwn: viewerUserId != null && String(row.user_id) === String(viewerUserId),
			...scoreFeedBetaRow(row, ctx)
		});
	}

	const nonVideoEntries = scoredEntries;
	const ownNonVideoEntries = scoredEntries.filter((entry) => entry.isOwn);

	const spotlightVideoQueue = buildSpotlightVideoQueue(opts.videoHead, catalog, ctx, {
		enableNsfw,
		viewerUserId,
		showOwnPosts
	});
	let videoRecencyIdx = 0;

	const used = new Set();
	const out = [];
	const slotPlan = MOBILE_CHAT_EDITORIAL_SLOT_PLAN.slice(0, MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);

	function takeNextSpotlightVideo() {
		while (videoRecencyIdx < spotlightVideoQueue.length) {
			const entry = spotlightVideoQueue[videoRecencyIdx];
			videoRecencyIdx += 1;
			const key = feedRowCreationIdKey(entry.row);
			if (!key || used.has(key)) continue;
			return entry;
		}
		return null;
	}

	for (let slotIndex = 0; slotIndex < slotPlan.length; slotIndex += 1) {
		const spec = slotPlan[slotIndex];
		let picked = null;
		let pickedPool = null;

		if (spec.media === 'video') {
			const spotlightPick = takeNextSpotlightVideo();
			if (spotlightPick) {
				picked = spotlightPick;
				pickedPool = spotlightPick.pool ?? 'site_video_head';
			}
		} else {
			const poolIds = [spec.pool, ...(spec.fallbacks ?? [])];
			let baseEntries = nonVideoEntries;
			if (poolIds.includes('own_activity')) {
				baseEntries = [...baseEntries, ...ownNonVideoEntries];
			}

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
