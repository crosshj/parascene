import { describe, expect, test } from '@jest/globals';
import {
	feedRowIsOtherThread,
	feedRowIsVideoThread,
	normalizeFeedBetaMediaFields
} from '../api_routes/feedBeta/rowMedia.js';

describe('feedBeta rowMedia threads', () => {
	test('classifies video rows with playable url', () => {
		const v = {
			created_image_id: 1,
			meta: { media_type: 'video', video: { file_path: '/api/v.mp4' } }
		};
		expect(feedRowIsVideoThread(v)).toBe(true);
		expect(feedRowIsOtherThread(v)).toBe(false);
	});

	test('classifies image rows as other thread', () => {
		const img = { created_image_id: 2, meta: { media_type: 'image' } };
		expect(feedRowIsVideoThread(img)).toBe(false);
		expect(feedRowIsOtherThread(img)).toBe(true);
	});

	test('normalizeFeedBetaMediaFields sets video_url from meta.video', () => {
		const row = normalizeFeedBetaMediaFields({
			created_image_id: 3,
			meta: { media_type: 'video', video: { file_path: '/api/videos/created/x.mp4' } }
		});
		expect(row.media_type).toBe('video');
		expect(row.video_url).toBe('/api/videos/created/x.mp4');
	});
});
