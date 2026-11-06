import { describe, expect, test } from '@jest/globals';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';
import { supplementBetaPageFromRandomFallback } from '../api_routes/feedBeta/randomFallback.js';

function catalogRow(id, opts = {}) {
	const { mediaType = 'image', userId = id, viewerLiked = false } = opts;
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: new Date(Date.now() - id * 60 * 60 * 1000).toISOString(),
		user_id: userId,
		meta,
		like_count: 0,
		comment_count: 0,
		nsfw: false,
		viewer_liked: viewerLiked
	};
}

describe('supplementBetaPageFromRandomFallback', () => {
	test('fills short page from random DB slice', async () => {
		const randomPool = Array.from({ length: 30 }, (_, i) => catalogRow(900 + i, { userId: i + 1 }));
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRandomSlice: async () => randomPool
			}
		};
		const existing = [catalogRow(1), catalogRow(2)];
		const out = await supplementBetaPageFromRandomFallback(queries, 7, {
			rows: existing,
			safeLimit: 6,
			pageSeed: 'test:random',
			pageIndex: 3,
			servedSeen: new Set(['1']),
			enableNsfw: true,
			showOwnPosts: true
		});
		expect(out.length).toBe(6);
		const fallback = out.filter((r) => r.feed_beta_why?.developer?.pool === 'db_random_fallback');
		expect(fallback.length).toBe(4);
	});

	test('respects creator cap on random backfill', async () => {
		const randomPool = Array.from({ length: 10 }, (_, i) =>
			catalogRow(800 + i, { userId: 99 })
		);
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRandomSlice: async () => randomPool
			}
		};
		const out = await supplementBetaPageFromRandomFallback(queries, 7, {
			rows: [],
			safeLimit: 5,
			pageSeed: 'test:cap',
			pageIndex: 2,
			servedSeen: new Set(),
			enableNsfw: true,
			showOwnPosts: true
		});
		const from99 = out.filter((r) => String(r.user_id) === '99').length;
		expect(from99).toBeLessThanOrEqual(2);
	});
});

describe('pullFeedBetaRows random fallback integration', () => {
	test('uses random backfill when strict pools exhaust on page 2', async () => {
		const catalog = Array.from({ length: 12 }, (_, i) =>
			catalogRow(i + 1, { viewerLiked: true })
		);
		const randomPool = Array.from({ length: 24 }, (_, i) =>
			catalogRow(500 + i, { userId: (i % 10) + 1 })
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
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };
		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 10,
			offset: 10,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});
		expect(pull.rows.length).toBe(10);
		expect(
			pull.rows.some((r) => {
				const pool = r.feed_beta_why?.developer?.pool;
				return pool === 'db_random_fallback' || pool === 'page_fill';
			})
		).toBe(true);
	});
});
