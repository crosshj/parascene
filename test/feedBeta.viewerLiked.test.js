import { describe, expect, test } from '@jest/globals';
import {
	applyViewerLikedFromSet,
	applyViewerLikedToRows
} from '../api_routes/feedBeta/catalog.js';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';

describe('applyViewerLikedFromSet', () => {
	test('uses id when created_image_id is missing', () => {
		const rows = [{ id: 42, title: 'x' }];
		const out = applyViewerLikedFromSet(rows, new Set(['42']));
		expect(out[0].viewer_liked).toBe(true);
	});
});

describe('applyViewerLikedToRows', () => {
	test('batch-stamps likes for page rows', async () => {
		const queries = {
			selectViewerLikedCreationIds: {
				all: async (_userId, ids) => ids.filter((id) => id === 99)
			}
		};
		const rows = [
			{ created_image_id: 99, title: 'liked' },
			{ created_image_id: 100, title: 'not' }
		];
		const out = await applyViewerLikedToRows(queries, 1, rows);
		expect(out[0].viewer_liked).toBe(true);
		expect(out[1].viewer_liked).toBe(false);
	});
});

describe('pullFeedBetaRows viewer_liked', () => {
	test('slot-pack video_head rows get viewer_liked on the response page', async () => {
		const likedId = 501;
		const videoHead = [
			{
				created_image_id: likedId,
				id: likedId,
				created_at: new Date().toISOString(),
				user_id: 2,
				nsfw: false,
				meta: { media_type: 'video', video: { file_path: '/api/videos/created/v501.mp4' } },
				url: '/api/images/created/t501.png',
				like_count: 3,
				comment_count: 0,
				viewer_liked: false
			}
		];
		const catalog = Array.from({ length: 8 }, (_, i) => ({
			created_image_id: 600 + i,
			id: 600 + i,
			created_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
			user_id: 3,
			nsfw: false,
			meta: { media_type: 'image' },
			url: `/api/images/created/i${600 + i}.png`,
			like_count: 1,
			comment_count: 0,
			viewer_liked: false
		}));
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => catalog,
				getBackCatalogSlice: async () => []
			},
			selectUserFollowing: { all: async () => [] },
			selectFeedItems: {
				getLatestFeedSlotPackHead: async () => ({ videos: videoHead, images: [] })
			},
			selectViewerLikedCreationIdsByUser: {
				all: async () => []
			},
			selectViewerLikedCreationIds: {
				all: async (_userId, ids) => ids.filter((id) => id === likedId)
			}
		};
		const user = { id: 1, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };
		const pull = await pullFeedBetaRows({
			queries,
			user,
			limit: 21,
			offset: 0,
			slotPack: true,
			enableNsfw: true,
			showOwnPosts: true,
			seenSet: new Set(),
			refresh: false
		});
		const likedRow = pull.rows.find((r) => Number(r.created_image_id ?? r.id) === likedId);
		expect(likedRow).toBeTruthy();
		expect(likedRow.viewer_liked).toBe(true);
	});
});
