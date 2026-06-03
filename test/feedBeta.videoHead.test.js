import { describe, expect, test } from '@jest/globals';
import { pullFeedBetaSiteVideoHead, pullFeedBetaSlotPackVideoHead } from '../api_routes/feedBeta/catalog.js';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';
import { MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP } from '../src/shared/chatFeedMobilePartition.js';
import { MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT } from '../src/shared/chatFeedMobilePartition.js';

function videoRow(id) {
	return {
		created_image_id: id,
		id,
		created_at: `2025-06-${String(id).padStart(2, '0')}T12:00:00.000Z`,
		user_id: 2,
		nsfw: false,
		meta: { media_type: 'video', video: { file_path: `/api/videos/created/v${id}.mp4` } },
		url: `/api/images/created/thumb_${id}.png`
	};
}

describe('feedBeta mobile video head', () => {
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

	test('slot-pack page one uses site video head before pool sampling', async () => {
		const siteVideos = Array.from({ length: 12 }, (_, i) => videoRow(100 + i));
		const queries = {
			selectFeedItems: {
				getLatestFeedSlotPackHead: async () => ({ videos: siteVideos, images: [] }),
				getSitePublishedVideoFeedPage: async () => ({ rows: siteVideos, hasMore: false })
			},
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => [],
				getTopEngaged: async () => [],
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
		const headLen =
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT *
			(MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP + 3);
		const head = pull.rows.slice(0, Math.min(headLen, pull.rows.length));
		const videoCount = head.filter(
			(r) => r.media_type === 'video' && typeof r.video_url === 'string' && r.video_url.length > 0
		).length;
		expect(videoCount).toBeGreaterThanOrEqual(
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
		);
	});

	test('slot-pack page one still fills spotlight videos when all are in feedBetaSeen', async () => {
		const siteVideos = Array.from({ length: 12 }, (_, i) => videoRow(200 + i));
		const seenIds = siteVideos.map((row) => String(row.id));
		const queries = {
			selectFeedItems: {
				getLatestFeedSlotPackHead: async () => ({ videos: siteVideos, images: [] })
			},
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => [],
				getTopEngaged: async () => [],
				getBackCatalogSlice: async () => []
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: seenIds } };
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
		const headLen =
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT *
			(MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP + 3);
		const head = pull.rows.slice(0, Math.min(headLen, pull.rows.length));
		const videoCount = head.filter(
			(r) => r.media_type === 'video' && typeof r.video_url === 'string' && r.video_url.length > 0
		).length;
		expect(videoCount).toBe(
			MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
		);
	});
});
