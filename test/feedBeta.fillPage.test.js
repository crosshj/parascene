import { describe, expect, test } from '@jest/globals';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';

function catalogRow(id, opts = {}) {
	const {
		mediaType = 'image',
		userId = id,
		ageHours = 2,
		likeCount = 40,
		viewerLiked = false
	} = opts;
	const created = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: created,
		user_id: userId,
		meta,
		like_count: likeCount,
		comment_count: 3,
		nsfw: false,
		viewer_liked: viewerLiked
	};
}

describe('pullFeedBetaRows page fill', () => {
	test('page 1 returns full limit when creator cap would otherwise leave four items', async () => {
		const catalog = [
			...Array.from({ length: 12 }, (_, i) =>
				catalogRow(i + 1, { mediaType: 'video', userId: 101, likeCount: 80 })
			),
			...Array.from({ length: 12 }, (_, i) =>
				catalogRow(100 + i, { userId: 202, likeCount: 70 })
			)
		];
		const randomPool = Array.from({ length: 120 }, (_, i) =>
			catalogRow(5000 + i, { userId: 300 + (i % 50), likeCount: 1, ageHours: 200 + i })
		);
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => [],
				getBackCatalogSlice: async () => [],
				getRandomSlice: async () => randomPool
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 7, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };

		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 28,
			offset: 0,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});

		expect(pull.rows.length).toBe(28);
		const authorCounts = pull.rows.reduce((acc, r) => {
			const uid = String(r.user_id);
			acc[uid] = (acc[uid] || 0) + 1;
			return acc;
		}, {});
		for (const count of Object.values(authorCounts)) {
			expect(count).toBeLessThanOrEqual(FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage);
		}
		const backfillPools = new Set(['page_fill', 'db_random_fallback']);
		const backfillRows = pull.rows.filter((r) =>
			backfillPools.has(r.feed_beta_why?.developer?.pool)
		);
		expect(backfillRows.length).toBeGreaterThan(0);
	});

	test('page 1 fills to limit when strict pools exhaust (all liked) via relaxed page fill', async () => {
		const catalog = Array.from({ length: 20 }, (_, i) =>
			catalogRow(i + 1, { viewerLiked: true, userId: (i % 3) + 1 })
		);
		const randomPool = Array.from({ length: 80 }, (_, i) =>
			catalogRow(9000 + i, { userId: 50 + (i % 45), ageHours: 400 + i })
		);
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => [],
				getBackCatalogSlice: async () => [],
				getRandomSlice: async () => randomPool
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 3, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };

		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 28,
			offset: 0,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});

		expect(pull.rows.length).toBe(28);
	});
});
