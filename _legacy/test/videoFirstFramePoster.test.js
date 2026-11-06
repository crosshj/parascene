import { describe, expect, test } from '@jest/globals';
import {
	feedItemNeedsVideoFramePoster,
	feedItemPlayableVideoUrl
} from '../src/shared/videoFirstFramePoster.js';

describe('feedItemNeedsVideoFramePoster', () => {
	test('text-to-video without source image needs a first-frame poster', () => {
		expect(
			feedItemNeedsVideoFramePoster({
				created_image_id: 23507,
				media_type: 'video',
				video_url: '/api/videos/created/video/201_23507.mp4',
				meta: {
					media_type: 'video',
					method: 'text2video',
					video: { file_path: '/api/videos/created/video/201_23507.mp4' }
				}
			})
		).toBe(true);
	});

	test('image-to-video with source image keeps the stored poster', () => {
		expect(
			feedItemNeedsVideoFramePoster({
				created_image_id: 24130,
				media_type: 'video',
				video_url: '/api/videos/created/video/19_24130.mp4',
				meta: {
					media_type: 'video',
					method: 'image2video',
					source_image_url: '/api/images/created/src.png',
					video: { file_path: '/api/videos/created/video/19_24130.mp4' }
				}
			})
		).toBe(false);
	});

	test('reference-to-video uses a first-frame poster instead of the character sheet', () => {
		expect(
			feedItemNeedsVideoFramePoster({
				created_image_id: 25001,
				media_type: 'video',
				video_url: '/api/videos/created/video/19_25001.mp4',
				meta: {
					media_type: 'video',
					method: 'reference2video',
					source_image_url: '/api/images/created/sheet.png',
					args: { model: 'minimax_r2v', input_images: ['/api/images/created/sheet.png'] },
					video: { file_path: '/api/videos/created/video/19_25001.mp4' }
				}
			})
		).toBe(true);
	});

	test('saved first-frame poster is not replaced', () => {
		expect(
			feedItemNeedsVideoFramePoster({
				media_type: 'video',
				video_url: '/api/videos/created/v.mp4',
				meta: { media_type: 'video', video_placeholder_manual: true }
			})
		).toBe(false);
	});
});

describe('feedItemPlayableVideoUrl', () => {
	test('reads meta.video.file_path when video_url is missing', () => {
		expect(
			feedItemPlayableVideoUrl({
				meta: { video: { file_path: '/api/videos/created/video/x.mp4' } }
			})
		).toBe('/api/videos/created/video/x.mp4');
	});
});
