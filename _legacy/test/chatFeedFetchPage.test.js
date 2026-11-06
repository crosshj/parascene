/**
 * Chat `#feed` fetchPage: slot-pack page 1; continuation uses API `feed_cursor`.
 */
import { describe, expect, test } from '@jest/globals';
import { FEED_BETA_CURSOR_SENTINEL_AT } from '../src/shared/feedBetaContinuation.js';
import { createChatFeedFetchPage, normalizeFeedCursorFromApi } from '../src/chat/feed/feedChannelData.js';

describe('normalizeFeedCursorFromApi', () => {
	test('maps feed_cursor shape', () => {
		expect(
			normalizeFeedCursorFromApi({
				after_image_created_at: '2025-01-05',
				after_image_id: 12
			})
		).toEqual({
			after_image_created_at: '2025-01-05',
			after_image_id: '12'
		});
	});
});

describe('createChatFeedFetchPage mobile slot-pack paging', () => {
	test('initial request uses slot_pack only', async () => {
		const urls = [];
		const fetchPage = createChatFeedFetchPage({
			mobileChatSlotPack: true,
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				return {
					ok: true,
					data: {
						items: [{ created_image_id: 1, created_at: '2025-01-02' }],
						hasMore: true,
						feed_cursor: {
							after_image_created_at: '2024-12-24',
							after_image_id: '99'
						}
					}
				};
			}
		});
		await fetchPage({ initial: true, items: [] });
		expect(urls.length).toBe(1);
		const u = new URL(urls[0], 'http://localhost');
		expect(u.searchParams.get('slot_pack')).toBe('mobile_chat_v1');
		expect(u.searchParams.has('offset')).toBe(false);
	});

	test('page 2 uses slot-pack feed_cursor from API, not oldest item on page 1', async () => {
		const urls = [];
		const fetchPage = createChatFeedFetchPage({
			mobileChatSlotPack: true,
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				const isInitial = !url.includes('feed_after_image');
				return {
					ok: true,
					data: isInitial
						? {
								items: [
									{ created_image_id: 10, created_at: '2025-01-10' },
									{ created_image_id: 5, created_at: '2025-01-05' }
								],
								hasMore: true,
								feed_cursor: {
									after_image_created_at: '2024-12-24',
									after_image_id: '99'
								}
							}
						: {
								items: [{ created_image_id: 3, created_at: '2025-01-03' }],
								hasMore: true,
								feed_cursor: {
									after_image_created_at: '2025-01-03',
									after_image_id: '3'
								}
							}
				};
			}
		});
		const page1 = await fetchPage({ initial: true, items: [] });
		await fetchPage({ initial: false, items: page1.pageItems });
		expect(urls.length).toBe(2);
		const u = new URL(urls[1], 'http://localhost');
		expect(u.searchParams.get('feed_after_image_created_at')).toBe('2024-12-24');
		expect(u.searchParams.get('feed_after_image_id')).toBe('99');
	});

	test('page 3 uses feed_cursor advanced by API after page 2', async () => {
		const urls = [];
		const fetchPage = createChatFeedFetchPage({
			mobileChatSlotPack: true,
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				if (!url.includes('feed_after_image')) {
					return {
						ok: true,
						data: {
							items: [{ created_image_id: 10, created_at: '2025-01-10' }],
							hasMore: true,
							feed_cursor: {
								after_image_created_at: '2024-12-24',
								after_image_id: '99'
							}
						}
					};
				}
				if (url.includes('feed_after_image_id=99')) {
					return {
						ok: true,
						data: {
							items: [{ created_image_id: 5, created_at: '2025-01-05' }],
							hasMore: true,
							feed_cursor: {
								after_image_created_at: '2025-01-05',
								after_image_id: '5'
							}
						}
					};
				}
				return { ok: true, data: { items: [], hasMore: false } };
			}
		});
		const page1 = await fetchPage({ initial: true, items: [] });
		const page2 = await fetchPage({ initial: false, items: page1.pageItems });
		await fetchPage({ initial: false, items: [...page1.pageItems, ...page2.pageItems] });
		expect(urls.length).toBe(3);
		const u = new URL(urls[2], 'http://localhost');
		expect(u.searchParams.get('feed_after_image_created_at')).toBe('2025-01-05');
		expect(u.searchParams.get('feed_after_image_id')).toBe('5');
	});
});

describe('createChatFeedFetchPage beta page cursor (desktop)', () => {
	test('load-more uses feed_cursor and feed_beta_ack, not item offset', async () => {
		const urls = [];
		const fetchPage = createChatFeedFetchPage({
			mobileChatSlotPack: false,
			pageSize: 28,
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				const isInitial = !url.includes('feed_after_image');
				return {
					ok: true,
					data: isInitial
						? {
								items: Array.from({ length: 4 }, (_, i) => ({
									created_image_id: i + 1,
									created_at: '2025-01-01'
								})),
								hasMore: true,
								feed_cursor: {
									after_image_created_at: FEED_BETA_CURSOR_SENTINEL_AT,
									after_image_id: '1'
								},
								feed_beta: {
									completed_page: 1,
									page_filled: false,
									served_count: 4
								}
							}
						: {
								items: [{ created_image_id: 99, created_at: '2024-12-01' }],
								hasMore: true,
								feed_cursor: {
									after_image_created_at: FEED_BETA_CURSOR_SENTINEL_AT,
									after_image_id: '2'
								},
								feed_beta: {
									completed_page: 2,
									page_filled: false,
									served_count: 1
								}
							}
				};
			}
		});
		const page1 = await fetchPage({ initial: true, items: [] });
		await fetchPage({ initial: false, items: page1.pageItems });
		expect(urls.length).toBe(2);
		const u = new URL(urls[1], 'http://localhost');
		expect(u.searchParams.get('feed_after_image_created_at')).toBe(FEED_BETA_CURSOR_SENTINEL_AT);
		expect(u.searchParams.get('feed_after_image_id')).toBe('1');
		expect(u.searchParams.get('feed_beta_ack')).toBeTruthy();
		expect(u.searchParams.get('offset')).toBe(null);
	});
});
