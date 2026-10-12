import { describe, expect, test } from '@jest/globals';
import { transformFeedCreationRow } from '../api_routes/feed/transformFeedCreationRow.js';

describe('transformFeedCreationRow', () => {
	test('maps DB url and video meta to API fields', () => {
		const row = {
			created_image_id: 10127,
			url: '/api/images/created/thumb_10127.png',
			meta: {
				media_type: 'video',
				video: { file_path: '/api/videos/created/video_10127.mp4' }
			}
		};
		const item = transformFeedCreationRow(row);
		expect(item.image_url).toContain('/api/images/created/');
		expect(item.image_url).toContain('creation_id=10127');
		expect(item.video_url).toContain('/api/videos/created/');
		expect(item.media_type).toBe('video');
	});

	test('marks feed creation rows as published for untitled display', () => {
		const item = transformFeedCreationRow({
			created_image_id: 42,
			title: null
		});
		expect(item.published).toBe(true);
		expect(item.title).toBeNull();
	});

	test('second transform keeps image_url (doom route must not strip posters)', () => {
		const row = {
			created_image_id: 10127,
			url: '/api/images/created/thumb_10127.png',
			meta: {
				media_type: 'video',
				video: { file_path: '/api/videos/created/video_10127.mp4' }
			}
		};
		const once = transformFeedCreationRow(row);
		const twice = transformFeedCreationRow(once);
		expect(twice.image_url).toBeTruthy();
		expect(twice.thumbnail_url).toBeTruthy();
		expect(twice.video_url).toBeTruthy();
		expect(twice.image_url).toBe(once.image_url);
	});
});
