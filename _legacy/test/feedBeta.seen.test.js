import { describe, expect, test } from '@jest/globals';
import { drawThreadPageFromCatalog } from '../api_routes/feedBeta/pools.js';
import { feedBetaPoolUserLine } from '../api_routes/feedBeta/reason.js';
import {
	countFeedBetaUnseenInCatalog,
	isFeedBetaRelaxedPage,
	isFeedBetaRowExcludedFromPools,
	isFeedBetaViewerLiked
} from '../api_routes/feedBeta/seen.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';

function row(id, opts = {}) {
	const { viewerLiked = false, userId = id } = opts;
	return {
		created_image_id: id,
		id,
		created_at: new Date(Date.now() - (id + 10) * 60 * 60 * 1000).toISOString(),
		user_id: userId,
		meta: { media_type: 'image' },
		like_count: id % 5,
		comment_count: 0,
		viewer_liked: viewerLiked
	};
}

describe('feedBeta seen helpers', () => {
	test('viewer_liked counts as excluded from pools', () => {
		const served = new Set();
		expect(isFeedBetaViewerLiked(row(1, { viewerLiked: true }))).toBe(true);
		expect(isFeedBetaRowExcludedFromPools(row(1, { viewerLiked: true }), served)).toBe(true);
		expect(isFeedBetaRowExcludedFromPools(row(2, { viewerLiked: false }), served)).toBe(false);
	});

	test('served id or liked excludes row', () => {
		const served = new Set(['3']);
		expect(isFeedBetaRowExcludedFromPools(row(3), served)).toBe(true);
		expect(isFeedBetaRowExcludedFromPools(row(4, { viewerLiked: true }), served)).toBe(true);
	});

	test('countFeedBetaUnseenInCatalog skips served and liked', () => {
		const catalog = [
			row(1),
			row(2, { viewerLiked: true }),
			row(3),
			row(4, { viewerLiked: true })
		];
		expect(countFeedBetaUnseenInCatalog(catalog, new Set(['1']))).toBe(1);
	});

	test('relaxed mode does not exclude served or liked', () => {
		const served = new Set(['3']);
		expect(isFeedBetaRowExcludedFromPools(row(3), served, { relaxed: true })).toBe(false);
		expect(
			isFeedBetaRowExcludedFromPools(row(4, { viewerLiked: true }), served, { relaxed: true })
		).toBe(false);
	});

	test('isFeedBetaRelaxedPage from page 5', () => {
		expect(isFeedBetaRelaxedPage(4, FEED_BETA_DEFAULT_PARAMS)).toBe(false);
		expect(isFeedBetaRelaxedPage(5, FEED_BETA_DEFAULT_PARAMS)).toBe(true);
	});

	test('catalog_unseen copy mentions likes not viewport', () => {
		expect(feedBetaPoolUserLine('catalog_unseen')).toMatch(/liked/i);
		expect(feedBetaPoolUserLine('catalog_unseen')).not.toMatch(/shown it/i);
	});
});

describe('drawThreadPageFromCatalog liked exclusion', () => {
	const ctx = {
		nowMs: Date.now(),
		followingIds: new Set(),
		newcomerAuthorIds: new Set(),
		newcomerHandles: new Set(),
		params: FEED_BETA_DEFAULT_PARAMS
	};

	test('does not draw rows the viewer already liked', () => {
		const catalog = [];
		for (let i = 1; i <= 20; i += 1) {
			catalog.push(row(i, { viewerLiked: i <= 10 }));
		}
		const out = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 8,
			seen: new Set(),
			pageIndex: 2,
			shuffleSeed: 'liked:exclude',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 99,
			showOwnPosts: true
		});
		expect(out.length).toBe(8);
		for (const item of out) {
			expect(item.viewer_liked).not.toBe(true);
			expect(Number(item.created_image_id)).toBeGreaterThan(10);
		}
	});

	test('relaxed page draws liked rows again', () => {
		const catalog = [];
		for (let i = 1; i <= 20; i += 1) {
			catalog.push(row(i, { viewerLiked: i <= 10 }));
		}
		const out = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 8,
			seen: new Set(['99']),
			pageIndex: 5,
			shuffleSeed: 'liked:relaxed',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 99,
			showOwnPosts: true
		});
		expect(out.length).toBe(8);
		const likedCount = out.filter((item) => item.viewer_liked === true).length;
		expect(likedCount).toBeGreaterThan(0);
		expect(out.some((item) => item.feed_beta_why?.developer?.relax_filters === true)).toBe(true);
	});
});
