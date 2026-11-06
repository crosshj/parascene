import { describe, expect, test } from '@jest/globals';
import {
	FEED_BETA_CURSOR_SENTINEL_AT,
	buildBetaPageFeedCursor,
	isFeedBetaPageCursor,
	pageIndexAfterBetaCursor
} from '../api_routes/feedBeta/cursor.js';

describe('feedBeta cursor', () => {
	test('detects page-token cursor', () => {
		expect(isFeedBetaPageCursor(FEED_BETA_CURSOR_SENTINEL_AT, 1)).toBe(true);
		expect(isFeedBetaPageCursor('2025-01-01T00:00:00.000Z', 1)).toBe(false);
		expect(isFeedBetaPageCursor(FEED_BETA_CURSOR_SENTINEL_AT, 0)).toBe(false);
	});

	test('maps completed page to next page index', () => {
		expect(pageIndexAfterBetaCursor(1)).toBe(2);
		expect(pageIndexAfterBetaCursor(3)).toBe(4);
	});

	test('buildBetaPageFeedCursor uses sentinel at and page id', () => {
		expect(buildBetaPageFeedCursor(2)).toEqual({
			created_at: FEED_BETA_CURSOR_SENTINEL_AT,
			created_image_id: 2
		});
	});
});
