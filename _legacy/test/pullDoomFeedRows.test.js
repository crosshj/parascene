import { describe, expect, test } from '@jest/globals';
import { pullDoomFeedRows } from '../api_routes/feed/pullDoomFeedRows.js';

describe('pullDoomFeedRows', () => {
	test('head mode still uses site-wide video page', async () => {
		let seenArgs = null;
		const queries = {
			selectFeedItems: {
				getSitePublishedVideoFeedPage: async (_viewerId, opts) => {
					seenArgs = opts;
					return {
						rows: [{ created_image_id: 99, created_at: '2025-01-01', meta: { media_type: 'video' } }],
						hasMore: true,
						cursor: { after_created_image_id: '99' }
					};
				}
			}
		};
		const out = await pullDoomFeedRows({
			queries,
			viewerId: 1,
			user: { id: 1, meta: {} },
			limit: 10,
			mode: 'head'
		});
		expect(seenArgs).toMatchObject({ mode: 'head', limit: 10 });
		expect(out.rows.length).toBe(1);
	});

	test('from_anchor falls back to site timeline when anchor is not in chat feed videos', async () => {
		let siteMode = null;
		const queries = {
			selectFeedItems: {
				getLatestFeedSlotPackHead: async () => ({
					videos: [],
					images: []
				}),
				getPage: async () => ({ rows: [], hasMore: false }),
				getSitePublishedVideoFeedPage: async (_viewerId, opts) => {
					siteMode = opts.mode;
					return {
						rows: [{ created_image_id: 55, created_at: '2025-01-01', meta: { media_type: 'video' } }],
						hasMore: false,
						cursor: null
					};
				}
			}
		};
		const out = await pullDoomFeedRows({
			queries,
			viewerId: 1,
			user: { id: 1, meta: {} },
			limit: 10,
			mode: 'from_anchor',
			startCreationId: 9999
		});
		expect(siteMode).toBe('from_anchor');
		expect(out.rows[0]?.created_image_id).toBe(55);
	});
});
