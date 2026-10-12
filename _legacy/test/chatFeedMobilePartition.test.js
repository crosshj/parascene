import { describe, expect, test } from '@jest/globals';
import { isFeedRowVideoCreation } from '../src/shared/chatFeedMobilePartition.js';

describe('isFeedRowVideoCreation', () => {
	test('native video with file url qualifies', () => {
		expect(
			isFeedRowVideoCreation({ media_type: 'video', video_url: 'https://x/v.mp4' })
		).toBe(true);
	});

	test('native video with only meta.video.file_path qualifies (raw DB / doom site rows)', () => {
		expect(
			isFeedRowVideoCreation({
				media_type: 'video',
				meta: {
					media_type: 'video',
					video: { file_path: '/api/videos/created/video/19_24130_x.mp4' }
				}
			})
		).toBe(true);
	});

	test('native video without a file url does not qualify', () => {
		expect(
			isFeedRowVideoCreation({
				media_type: 'video',
				meta: { media_type: 'video' }
			})
		).toBe(false);
	});

	test('YouTube Shorts qualify without a file url', () => {
		expect(
			isFeedRowVideoCreation({
				media_type: 'video',
				meta: { import: { provider: 'youtube', kind: 'shorts' } }
			})
		).toBe(true);
	});

	test('YouTube watch imports do not qualify', () => {
		expect(
			isFeedRowVideoCreation({
				media_type: 'video',
				meta: { import: { provider: 'youtube', kind: 'watch' } }
			})
		).toBe(false);
	});
});
