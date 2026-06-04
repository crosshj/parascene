import { describe, expect, test } from '@jest/globals';
import { mergeBetaPage } from '../api_routes/feedBeta/mergeBetaPage.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../src/shared/chatFeedMobilePartition.js';

function row(id, mediaType = 'image', videoUrl = '') {
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: videoUrl || '/v.mp4' } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: `2025-01-${String(id).padStart(2, '0')}T00:00:00.000Z`,
		meta,
		media_type: mediaType,
		video_url: mediaType === 'video' ? videoUrl || '/v.mp4' : null
	};
}

describe('mergeBetaPage', () => {
	test('slot-pack page one interleaves video and other head', () => {
		const videos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => row(id, 'video'));
		const others = [101, 102, 103, 104, 105, 106, 107, 108, 109].map((id) => row(id, 'image'));
		const { rows } = mergeBetaPage({
			videoRows: videos,
			otherRows: others,
			limit: 40,
			slotPackPageOne: true
		});
		expect(rows.length).toBeGreaterThanOrEqual(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);
		expect(rows[0].meta.media_type).toBe('video');
	});

	test('page one orders by created_at newest-first (not round-robin)', () => {
		const stamp = (id, pool, createdAt, mediaType) => ({
			...row(id, mediaType),
			created_at: createdAt,
			user_id: id,
			feed_beta_why: { developer: { pool } }
		});
		const now = Date.now();
		const videos = [
			stamp(1, 'hot_7d', new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(), 'video'),
			stamp(2, 'hot_24h', new Date(now - 15 * 60 * 1000).toISOString(), 'video')
		];
		const others = [stamp(10, 'new', new Date(now - 2 * 60 * 60 * 1000).toISOString(), 'image')];
		const { rows } = mergeBetaPage({
			videoRows: videos,
			otherRows: others,
			limit: 3,
			slotPackPageOne: false,
			pageIndex: 1
		});
		expect(rows[0].created_image_id).toBe(2);
		expect(rows[1].created_image_id).toBe(10);
		expect(rows[2].created_image_id).toBe(1);
		expect(rows[0].feed_beta_why.developer.merge_layout).toBe('page_one_chronological');
	});

	test('page two round-robins threads', () => {
		const videos = [1, 2].map((id) => row(id, 'video'));
		const others = [10, 11].map((id) => row(id, 'image'));
		const { rows } = mergeBetaPage({
			videoRows: videos,
			otherRows: others,
			limit: 4,
			slotPackPageOne: false,
			pageIndex: 2
		});
		expect(rows.length).toBe(4);
		expect(rows[0].meta.media_type).toBe('video');
		expect(rows[1].meta.media_type).toBe('image');
		expect(rows[2].meta.media_type).toBe('video');
		expect(rows[3].meta.media_type).toBe('image');
	});
});
