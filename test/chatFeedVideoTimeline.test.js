import { describe, expect, test } from '@jest/globals';
import {
	doomPageFromFeedVideoSequence,
	extractFeedVideosInDisplayOrder
} from '../api_routes/feed/chatFeedVideoTimeline.js';

function videoItem(id, createdAt) {
	return {
		created_image_id: id,
		id,
		created_at: createdAt,
		media_type: 'video',
		video_url: `/api/v/${id}.mp4`
	};
}

describe('extractFeedVideosInDisplayOrder', () => {
	test('keeps feed order and skips non-videos', () => {
		const items = [
			videoItem(10, '2025-02-03'),
			{ created_image_id: 9, media_type: 'image', image_url: '/x.jpg' },
			videoItem(8, '2025-02-02'),
			{ type: 'engagement', id: 'e1' }
		];
		expect(extractFeedVideosInDisplayOrder(items).map((r) => r.created_image_id)).toEqual([
			10, 8
		]);
	});
});

describe('doomPageFromFeedVideoSequence', () => {
	const seq = [
		videoItem(100, '2025-02-10'),
		videoItem(10205, '2025-02-09'),
		videoItem(9743, '2025-02-08')
	];

	test('from_anchor: next slide is the next video in feed order, not global timestamp reorder', () => {
		const page = doomPageFromFeedVideoSequence(seq, { startCreationId: 100, limit: 10 });
		expect(page.rows.map((r) => r.created_image_id)).toEqual([100, 10205, 9743]);
		expect(page.rows[1].created_image_id).toBe(10205);
	});

	test('older_than: continues after cursor in feed order', () => {
		const page = doomPageFromFeedVideoSequence(seq, {
			afterCreatedImageId: 10205,
			limit: 10
		});
		expect(page.rows.map((r) => r.created_image_id)).toEqual([9743]);
	});
});
