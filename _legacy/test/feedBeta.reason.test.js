import { describe, expect, test } from '@jest/globals';
import { drawThreadPageFromCatalog } from '../api_routes/feedBeta/pools.js';
import { mergeBetaPage } from '../api_routes/feedBeta/mergeBetaPage.js';
import { buildFeedBetaWhy, stampFeedBetaRowReason } from '../api_routes/feedBeta/reason.js';
import { transformFeedCreationRow } from '../api_routes/feed/transformFeedCreationRow.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';

describe('feedBeta reason at assembly', () => {
	test('pool draw stamps feed_beta_why on each row', () => {
		const catalog = [
			{
				created_image_id: 1,
				id: 1,
				created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
				user_id: 50,
				meta: { media_type: 'image' },
				like_count: 40,
				comment_count: 5
			}
		];
		const ctx = {
			nowMs: Date.now(),
			followingIds: new Set(),
			newcomerAuthorIds: new Set(['50']),
			newcomerHandles: new Set(['newbie']),
			params: FEED_BETA_DEFAULT_PARAMS
		};
		const out = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 1,
			seen: new Set(),
			shuffleSeed: 'reason:test',
			pageIndex: 1,
			pageSeed: 'user:1:p1:open',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 99,
			showOwnPosts: true
		});
		expect(out.length).toBe(1);
		expect(out[0].feed_beta_why).toBeTruthy();
		expect(typeof out[0].feed_beta_why.summary).toBe('string');
		expect(out[0].feed_beta_why.label).toBeTruthy();
		expect(out[0].feed_beta_why.developer.pool).toBeTruthy();
		expect(out[0].feed_beta_why.developer.page_index).toBe(1);
	});

	test('merge adds layout to existing reason', () => {
		const row = stampFeedBetaRowReason(
			{
				created_image_id: 9,
				id: 9,
				created_at: '2025-01-01T00:00:00.000Z',
				meta: { media_type: 'video', video: { file_path: '/v.mp4' } }
			},
			{ pool: 'hot_24h', thread: 'video', page_index: 1, page_seed: 'x' },
			{ score: 12, inHot24: true, engagement: 2 }
		);
		const { rows } = mergeBetaPage({
			videoRows: [row],
			otherRows: [],
			limit: 4,
			slotPackPageOne: false,
			pageIndex: 2
		});
		expect(rows[0].feed_beta_why.developer.merge_layout).toBe('round_robin');
		expect(rows[0].created_image_id).toBe(9);
		expect(rows[0].feed_beta_why.developer.position_in_page).toBe(1);
	});

	test('transformFeedCreationRow passes feed_beta_why to API item', () => {
		const why = buildFeedBetaWhy(
			{ pool: 'catalog_unseen', thread: 'other', page_index: 2, page_seed: 'p2' },
			{ score: 5, isNewPublish: false }
		);
		const item = transformFeedCreationRow({
			id: 1,
			created_image_id: 1,
			title: 't',
			url: '/api/images/created/x.png',
			feed_beta_why: why
		});
		expect(item.feed_beta_why).toEqual(why);
	});
});
