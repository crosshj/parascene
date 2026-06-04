import { pullFeedBetaRows } from '../../api_routes/feedBeta/pullFeedBetaRows.js';
import { FEED_BETA_CURSOR_SENTINEL_AT } from '../../api_routes/feedBeta/cursor.js';
import { createSeededRng, shuffleInPlace } from '../../api_routes/feedBeta/rng.js';
import { mergeFeedBetaSeenIds } from '../../api_routes/feedBeta/seen.js';
import { feedRowCreationIdKey, feedRowIsVideoThread } from '../../api_routes/feedBeta/rowMedia.js';
import { isFeedRowVideoCreation } from '../../src/shared/chatFeedMobilePartition.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../../src/shared/chatFeedMobilePartition.js';

export const GOLDEN_VIEWER_ID = 9001;

/**
 * @param {number} [id]
 * @param {Iterable<string|number>} [seenIds]
 */
export function createGoldenPathUser(id = GOLDEN_VIEWER_ID, seenIds = []) {
	return {
		id,
		meta: {
			feedBetaEnabled: true,
			feedBetaSeen: mergeFeedBetaSeenIds({ meta: {} }, seenIds)
		}
	};
}

/**
 * @param {object} user
 * @param {Iterable<string|number>} servedIds
 */
export function userAfterServed(user, servedIds) {
	return {
		...user,
		meta: {
			...user.meta,
			feedBetaSeen: mergeFeedBetaSeenIds(user, servedIds)
		}
	};
}

/**
 * Author with the most creations in the fixture (good follow-sprinkle target).
 * @param {object[]} catalog
 */
export function pickFollowTargetUserId(catalog) {
	const counts = new Map();
	for (const row of catalog) {
		const uid = String(row.user_id);
		counts.set(uid, (counts.get(uid) ?? 0) + 1);
	}
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	return sorted.length ? Number(sorted[0][0]) : null;
}

/**
 * @param {object[]} catalog
 * @param {Set<string>|Iterable<string|number>} likedIds
 */
export function catalogWithViewerLikes(catalog, likedIds) {
	const liked = new Set([...likedIds].map((id) => String(id)));
	return catalog.map((row) => ({
		...row,
		viewer_liked: liked.has(String(row.created_image_id))
	}));
}

/**
 * Mock DB layer backed by the prod CSV catalog.
 * @param {object[]} catalog
 * @param {{
 *   followingUserIds?: number[],
 *   likedCreationIds?: Set<string>,
 *   authorProfiles?: Map<number, { created_at: string, user_name?: string }>
 * }} [opts]
 */
export function createGoldenPathQueries(catalog, opts = {}) {
	const followingUserIds = opts.followingUserIds ?? [];
	const likedCreationIds = opts.likedCreationIds ?? new Set();
	const authorProfiles = opts.authorProfiles ?? new Map();
	const hydrated = catalogWithViewerLikes(catalog, likedCreationIds);

	const topEngaged = hydrated
		.slice()
		.sort(
			(a, b) =>
				b.like_count + b.comment_count - (a.like_count + a.comment_count) ||
				Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))
		)
		.slice(0, 200);

	const backCatalog = hydrated
		.filter((row) => {
			const ageDays = (Date.now() - Date.parse(String(row.created_at))) / (24 * 60 * 60 * 1000);
			return ageDays >= 7;
		})
		.slice(0, 300);

	const videoHead = hydrated
		.filter((r) => feedRowIsVideoThread(r))
		.sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
		.slice(0, 24);

	return {
		selectFeedBetaSitewideCatalog: {
			getRecent: async () => hydrated,
			getTopEngaged: async () => topEngaged,
			getBackCatalogSlice: async () => backCatalog,
			getPublishedCount: async () => hydrated.length,
			getRandomSlice: async ({ seed = '', limit = 40 } = {}) => {
				const rng = createSeededRng(String(seed));
				const copy = hydrated.slice();
				shuffleInPlace(copy, rng);
				return copy.slice(0, limit);
			}
		},
		selectFeedItems: {
			getSitePublishedVideoFeedPage: async () => ({ rows: videoHead })
		},
		selectUserFollowing: {
			all: async () => followingUserIds.map((user_id) => ({ user_id }))
		},
		selectUsersByIds: async (ids) => {
			const map = new Map();
			for (const id of ids) {
				const profile = authorProfiles.get(Number(id));
				if (profile?.created_at) {
					map.set(Number(id), { created_at: profile.created_at });
					continue;
				}
				const authorRow = hydrated.find(
					(r) => Number(r.user_id) === Number(id) && r.author_created_at
				);
				if (authorRow?.author_created_at) {
					map.set(Number(id), { created_at: authorRow.author_created_at });
				}
			}
			return map;
		},
		selectUserProfilesByUserIds: async (ids) => {
			const map = new Map();
			for (const id of ids) {
				const profile = authorProfiles.get(Number(id));
				map.set(Number(id), {
					user_name: profile?.user_name ?? `user${id}`
				});
			}
			return map;
		}
	};
}

/**
 * @param {object|null|undefined} row
 * @returns {string|null}
 */
export function feedBetaRowPool(row) {
	const dev = row?.feed_beta_why?.developer;
	return dev && typeof dev.pool === 'string' ? dev.pool : null;
}

export function poolSampledRows(rows) {
	return (Array.isArray(rows) ? rows : []).filter((row) => {
		const pool = feedBetaRowPool(row);
		return pool && pool !== 'site_video_head';
	});
}

/**
 * @param {object[]} rows
 * @returns {Set<string>}
 */
export function poolsOnPage(rows) {
	const out = new Set();
	for (const row of Array.isArray(rows) ? rows : []) {
		const pool = feedBetaRowPool(row);
		if (pool) out.add(pool);
	}
	return out;
}

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
export function creationIdsOnPage(rows) {
	return (Array.isArray(rows) ? rows : [])
		.map((row) => feedRowCreationIdKey(row))
		.filter(Boolean);
}

/**
 * @param {object} opts
 */
export async function pullGoldenPathPage(opts) {
	const {
		queries,
		user,
		limit = 21,
		slotPack = null,
		offset = 0,
		afterAt = null,
		afterIdNum = null,
		refresh = false
	} = opts;
	return pullFeedBetaRows({
		queries,
		user,
		limit,
		offset,
		slotPack,
		afterAt,
		afterIdNum,
		enableNsfw: true,
		showOwnPosts: false,
		refresh
	});
}

/**
 * Mobile chat page 1 with slot-pack structure.
 * @param {object[]} rows
 */
export function assertMobileSlotPackShape(rows) {
	expect(rows.length).toBeGreaterThanOrEqual(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);
	const videoCount = rows.filter((r) => isFeedRowVideoCreation(r)).length;
	expect(videoCount).toBeGreaterThanOrEqual(6);
}

export { FEED_BETA_CURSOR_SENTINEL_AT };
