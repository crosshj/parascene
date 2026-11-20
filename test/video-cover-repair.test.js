import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { ensureVideoCoverImage, imageBufferHasVisiblePixels } from '../server/services/create/videoPoster.js';

const video = {
	id: 2,
	user_id: 7,
	status: 'completed',
	filename: 'blank.png',
	file_path: '/api/images/created/blank.png',
	media_type: 'video',
	meta: { media_type: 'video', video: { file_path: '/api/videos/created/video/clip.mp4' } },
};

test('a transparent still is not a cover and an opaque still is', async () => {
	const blank = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
	const picture = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer();
	assert.equal(await imageBufferHasVisiblePixels(blank), false);
	assert.equal(await imageBufferHasVisiblePixels(picture), true);
});

test('a video with no visible cover is repaired from its first frame', async () => {
	const blank = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
	const frame = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
	let saved = null;
	const result = await ensureVideoCoverImage({
		image: video,
		queries: { updateCreatedImageJobCompleted: { run: async (_id, _owner, payload) => { saved = payload; return { changes: 1 }; } } },
		storage: {
			getImageBuffer: async () => blank,
			getVideoBuffer: async (key) => {
				assert.equal(key, 'video/clip.mp4');
				return Buffer.from('video');
			},
			uploadImage: async (_buffer, filename) => `/api/images/created/${filename}`,
		},
		extractVideoFrame: async () => frame,
	});
	assert.equal(result.needed, true);
	assert.equal(result.error, undefined);
	assert.equal(result.image.meta.video_placeholder_manual, true);
	assert.match(result.image.file_path, /^\/api\/images\/created\/7_2_/);
	assert.equal(saved.meta.video_placeholder_manual, true);
	assert.equal(result.image.width, 8);
	assert.equal(result.image.height, 6);
});

test('a video that already has a visible cover is left alone', async () => {
	const picture = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
	let extracted = false;
	const result = await ensureVideoCoverImage({
		image: video,
		queries: {},
		storage: {
			getImageBuffer: async () => picture,
			getVideoBuffer: async () => { extracted = true; return Buffer.from('video'); },
		},
		extractVideoFrame: async () => { extracted = true; return picture; },
	});
	assert.equal(result.needed, false);
	assert.equal(extracted, false);
	assert.equal(result.image, video);
});
