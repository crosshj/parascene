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

	test('plain page round-robins threads', () => {
		const videos = [1, 2].map((id) => row(id, 'video'));
		const others = [10, 11].map((id) => row(id, 'image'));
		const { rows } = mergeBetaPage({
			videoRows: videos,
			otherRows: others,
			limit: 4,
			slotPackPageOne: false
		});
		expect(rows.length).toBe(4);
		expect(rows[0].meta.media_type).toBe('video');
		expect(rows[1].meta.media_type).toBe('image');
		expect(rows[2].meta.media_type).toBe('video');
		expect(rows[3].meta.media_type).toBe('image');
	});
});
