import { describe, expect, test } from '@jest/globals';
import {
	FEED_BETA_CURSOR_SENTINEL_AT,
	buildBetaPageFeedCursor
} from '../api_routes/feedBeta/cursor.js';
import {
	buildFeedBetaContinuation,
	parseFeedBetaAckFromQuery
} from '../api_routes/feedBeta/continuation.js';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';
import {
	decodeFeedBetaAck,
	encodeFeedBetaAck,
	isFeedBetaPageTokenCursor
} from '../src/shared/feedBetaContinuation.js';

describe('feed_beta continuation', () => {
	test('buildFeedBetaContinuation exposes page and has_more_reason', () => {
		const cont = buildFeedBetaContinuation({
			pageIndex: 2,
			rows: [{ created_image_id: 1, user_id: 1, created_at: '2025-01-01' }],
			safeLimit: 28,
			catalog: [],
			servedSeen: new Set(['1']),
			params: { maxPageIndex: 40, hasMoreThroughPage: 5, relaxFiltersFromPage: 5 },
			hasMore: true
		});
		expect(cont.completed_page).toBe(2);
		expect(cont.next_page).toBe(3);
		expect(cont.page_filled).toBe(false);
		expect(typeof cont.has_more_reason).toBe('string');
		expect(cont.has_more).toBe(true);
	});

	test('parseFeedBetaAckFromQuery round-trips with client encoder', () => {
		const ack = encodeFeedBetaAck({
			completed_page: 1,
			page_filled: false,
			served_count: 4
		});
		expect(ack).toBeTruthy();
		const parsed = parseFeedBetaAckFromQuery({ feed_beta_ack: ack });
		expect(parsed).toEqual({
			completed_page: 1,
			page_filled: false,
			served_count: 4
		});
		expect(decodeFeedBetaAck(ack)).toMatchObject({
			completed_page: 1,
			page_filled: false
		});
	});

	test('isFeedBetaPageTokenCursor detects beta page cursor', () => {
		const c = buildBetaPageFeedCursor(3);
		expect(
			isFeedBetaPageTokenCursor({
				after_image_created_at: c.created_at,
				after_image_id: String(c.created_image_id)
			})
		).toBe(true);
		expect(c.created_at).toBe(FEED_BETA_CURSOR_SENTINEL_AT);
	});

	test('feed_beta_ack advances page when offset would stay on page 1', async () => {
		const catalog = Array.from({ length: 80 }, (_, i) => ({
			created_image_id: i + 1,
			id: i + 1,
			created_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
			user_id: (i % 20) + 1,
			meta: { media_type: 'image' },
			like_count: 1,
			comment_count: 0,
			nsfw: false,
			viewer_liked: false
		}));
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => [],
				getBackCatalogSlice: async () => [],
				getRandomSlice: async () => catalog,
				getPublishedCount: async () => 500
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };

		const page1 = await pullFeedBetaRows({
			queries,
			user,
			limit: 28,
			offset: 4,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true
		});
		expect(page1.feedBetaContinuation.completed_page).toBe(1);

		const ack = encodeFeedBetaAck(page1.feedBetaContinuation);
		const page2 = await pullFeedBetaRows({
			queries,
			user: {
				...user,
				meta: { ...user.meta, feedBetaSeen: page1.feedBetaServedIds }
			},
			limit: 28,
			offset: 4,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			feedBetaAck: parseFeedBetaAckFromQuery({ feed_beta_ack: ack })
		});
		expect(page2.feedBetaContinuation.completed_page).toBe(2);
	});
});
