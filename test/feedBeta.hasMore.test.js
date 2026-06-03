import { describe, expect, test } from '@jest/globals';
import { computeBetaHasMore, isFeedBetaAssumedHasMorePage } from '../api_routes/feedBeta/hasMore.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../src/shared/chatFeedMobilePartition.js';

function row(id) {
	return {
		created_image_id: id,
		id,
		user_id: 1,
		viewer_liked: true
	};
}

function catalogRow(id, opts = {}) {
	return {
		created_image_id: id,
		id,
		user_id: 1,
		viewer_liked: opts.viewerLiked === true
	};
}

describe('computeBetaHasMore', () => {
	const params = FEED_BETA_DEFAULT_PARAMS;

	test('isFeedBetaAssumedHasMorePage covers pages 1 through 5', () => {
		expect(isFeedBetaAssumedHasMorePage(1, params)).toBe(true);
		expect(isFeedBetaAssumedHasMorePage(5, params)).toBe(true);
		expect(isFeedBetaAssumedHasMorePage(6, params)).toBe(false);
	});

	test('pages 1–5 are true whenever rows were served', () => {
		for (let page = 1; page <= 5; page += 1) {
			expect(
				computeBetaHasMore({
					pageIndex: page,
					rows: [{ created_image_id: 1, id: 1 }],
					safeLimit: 28,
					catalog: [],
					servedSeen: new Set(),
					params
				})
			).toBe(true);
		}
	});

	test('page 5 is false when the feed is empty', () => {
		expect(
			computeBetaHasMore({
				pageIndex: 5,
				rows: [],
				safeLimit: 28,
				catalog: [],
				servedSeen: new Set(),
				params
			})
		).toBe(false);
	});

	test('page 2 is true even for partial page or thin catalog', () => {
		const thin = Array.from({ length: 8 }, (_, i) => catalogRow(i + 1, { viewerLiked: true }));
		expect(
			computeBetaHasMore({
				pageIndex: 2,
				rows: thin.slice(0, 8),
				safeLimit: 20,
				catalog: thin,
				servedSeen: new Set(),
				params
			})
		).toBe(true);
		expect(
			computeBetaHasMore({
				pageIndex: 2,
				rows: thin.slice(0, 12),
				safeLimit: 20,
				catalog: thin,
				servedSeen: new Set(),
				params
			})
		).toBe(true);
	});

	test('returns true on slot-pack page one with structured head', () => {
		const catalog = Array.from({ length: 500 }, (_, i) => catalogRow(i + 1, { viewerLiked: true }));
		const rows = Array.from({ length: MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN }, (_, i) => row(i + 1));
		expect(
			computeBetaHasMore({
				pageIndex: 1,
				rows,
				safeLimit: 28,
				catalog,
				servedSeen: new Set(),
				params,
				isSlotPackPageOne: true
			})
		).toBe(true);
	});

	test('relaxed page 6+ stays true when rows were served', () => {
		expect(
			computeBetaHasMore({
				pageIndex: 6,
				rows: [{ created_image_id: 1, id: 1 }],
				safeLimit: 28,
				catalog: [],
				servedSeen: new Set(),
				params
			})
		).toBe(true);
	});

	test('page 6 returns false for partial page when not relaxed hasMore path', () => {
		const strictParams = { ...params, relaxFiltersFromPage: 10, hasMoreThroughPage: 3 };
		const catalog = Array.from({ length: 50 }, (_, i) => catalogRow(i + 1));
		expect(
			computeBetaHasMore({
				pageIndex: 6,
				rows: catalog.slice(0, 12),
				safeLimit: 20,
				catalog,
				servedSeen: new Set(),
				params: strictParams
			})
		).toBe(false);
	});
});
