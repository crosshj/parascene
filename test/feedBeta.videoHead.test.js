import { describe, expect, test } from '@jest/globals';
import { pullFeedBetaSiteVideoHead, pullFeedBetaSlotPackVideoHead } from '../api_routes/feedBeta/catalog.js';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';
import {
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from '../src/shared/chatFeedMobilePartition.js';

function videoRow(id, opts = {}) {
	const ageHours = opts.ageHours ?? 2;
	return {
		created_image_id: id,
		id,
		created_at: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
		user_id: 2,
		nsfw: false,
		like_count: opts.likeCount ?? 20,
		comment_count: opts.commentCount ?? 0,
		meta: { media_type: 'video', video: { file_path: `/api/videos/created/v${id}.mp4` } },
		url: `/api/images/created/thumb_${id}.png`
	};
}

function imageRow(id, opts = {}) {
	const ageHours = opts.ageHours ?? 4;
	return {
		created_image_id: id,
		id,
		created_at: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
		user_id: 3,
		nsfw: false,
		like_count: opts.likeCount ?? 5,
		comment_count: opts.commentCount ?? 0,
		meta: { media_type: 'image' },
		url: `/api/images/created/img_${id}.png`
	};
}

describe('feedBeta catalog video head helpers', () => {
	test('pullFeedBetaSiteVideoHead returns playable video rows from site feed page', async () => {
		const rows = Array.from({ length: 12 }, (_, i) => videoRow(i + 1));
		const queries = {
			selectFeedItems: {
				getSitePublishedVideoFeedPage: async () => ({ rows, hasMore: false })
			}
		};
		const out = await pullFeedBetaSiteVideoHead(queries, 99, { limit: 12, enableNsfw: true });
		expect(out.length).toBe(12);
		expect(out[0].media_type).toBe('video');
		expect(out[0].video_url).toContain('/api/videos/created/');
	});

	test('pullFeedBetaSlotPackVideoHead uses legacy slot-pack head (no seen filter)', async () => {
		const siteVideos = Array.from({ length: 12 }, (_, i) => videoRow(i + 1));
		const queries = {
			selectFeedItems: {
				getLatestFeedSlotPackHead: async () => ({ videos: siteVideos, images: [] })
			}
		};
		const out = await pullFeedBetaSlotPackVideoHead(queries, 99, { limit: 12, enableNsfw: true });
		expect(out.length).toBe(12);
		expect(out[0].video_url).toContain('/api/videos/created/');
	});
});

describe('feedBeta mobile slot-pack page one', () => {
	test('uses editorial slot draw and preserves enough videos for spotlight strips', async () => {
		const catalog = [];
		for (let i = 1; i <= 12; i += 1) {
			catalog.push(videoRow(100 + i, { likeCount: 40 - i }));
		}
		for (let i = 1; i <= 9; i += 1) {
			catalog.push(imageRow(200 + i));
		}
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => catalog,
				getBackCatalogSlice: async () => []
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };
		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 28,
			offset: 0,
			slotPack: true,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});
		expect(pull.mobileChatSlotPackPageOne).toBe(true);
		const videoCount = pull.rows.filter(
			(r) => r.media_type === 'video' && typeof r.video_url === 'string' && r.video_url.length > 0
		).length;
		expect(videoCount).toBeGreaterThanOrEqual(
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
		);
		expect(pull.rows[0].feed_beta_why?.developer?.mobile_slot_index).toBe(1);
	});

	test('slot-pack page one does not resort rows newest-first', async () => {
		const catalog = [
			videoRow(1, { ageHours: 48, likeCount: 50 }),
			videoRow(2, { ageHours: 1, likeCount: 5 }),
			imageRow(3, { ageHours: 24 }),
			imageRow(4, { ageHours: 1 })
		];
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => catalog,
				getBackCatalogSlice: async () => []
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };
		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 4,
			offset: 0,
			slotPack: true,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});
		expect(pull.rows.length).toBeGreaterThan(0);
		expect(pull.rows[0].feed_beta_why?.developer?.mobile_slot_index).toBe(1);
		expect(pull.rows[0].media_type).toBe('video');
	});
});
