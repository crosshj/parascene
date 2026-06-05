import { describe, expect, test } from '@jest/globals';
import { drawMobileEditorialSlotPackPage, MOBILE_CHAT_EDITORIAL_SLOT_PLAN } from '../api_routes/feedBeta/mobileSlotPack.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { feedBetaPoolLabel } from '../api_routes/feedBeta/reason.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../src/shared/chatFeedMobilePartition.js';

function catalogRow(id, opts = {}) {
	const {
		mediaType = 'image',
		userId = 50 + id,
		likeCount = 0,
		commentCount = 0,
		ageHours = 12
	} = opts;
	const createdAt = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: createdAt,
		user_id: userId,
		title: `Creation ${id}`,
		meta,
		like_count: likeCount,
		comment_count: commentCount,
		viewer_liked: false,
		nsfw: false
	};
}

describe('feedBeta mobile editorial slot pack', () => {
	test('slot plan length matches structured mobile page', () => {
		expect(MOBILE_CHAT_EDITORIAL_SLOT_PLAN.length).toBe(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);
	});

	test('drawMobileEditorialSlotPackPage returns editorial order with pool labels', () => {
		const catalog = [
			catalogRow(1, { mediaType: 'video', likeCount: 50, ageHours: 2 }),
			catalogRow(2, { mediaType: 'video', likeCount: 40, ageHours: 3 }),
			catalogRow(3, { mediaType: 'video', commentCount: 8, ageHours: 6 }),
			catalogRow(4, { mediaType: 'video', likeCount: 10, ageHours: 30 }),
			catalogRow(5, { mediaType: 'image', likeCount: 30, ageHours: 4 }),
			catalogRow(6, { mediaType: 'image', ageHours: 1 }),
			catalogRow(7, { mediaType: 'image', ageHours: 200 })
		];
		const ctx = {
			nowMs: Date.now(),
			followingIds: new Set(),
			newcomerAuthorIds: new Set(),
			newcomerHandles: new Set(),
			params: FEED_BETA_DEFAULT_PARAMS
		};
		const out = drawMobileEditorialSlotPackPage(catalog, {
			catalog,
			scoreContext: ctx,
			pageIndex: 1,
			pageSeed: 'slot:test',
			seen: new Set(),
			enableNsfw: true,
			viewerUserId: 99,
			showOwnPosts: true
		});
		expect(out.length).toBeGreaterThan(0);
		expect(out[0].feed_beta_why?.label).toBeTruthy();
		expect(out[0].feed_beta_why?.developer?.mobile_slot_index).toBe(1);
	});

	test('feedBetaPoolLabel maps known pools', () => {
		expect(feedBetaPoolLabel('hot_24h')).toBe('Rising today');
		expect(feedBetaPoolLabel('recent_comment')).toBe('People are talking');
		expect(feedBetaPoolLabel('own_activity')).toBe('People reacted to your creation');
	});
});
