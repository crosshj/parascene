import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
	creationDetailSeedFromClick,
	feedItemToCreationDetailSeed,
	withDecodedParentImage,
} from '../client/shared/creationDetailSeed.js';
import { detailHeroStillUrl, isDisplayableImageUrl } from '../client/shared/videoFirstFramePoster.js';
import { videoPosterTargetFromCreation } from '../client/shared/saveVideoFirstFramePoster.js';

const video = '/api/creations/media/clip.mp4?creation_id=9';
const frame = '/api/creations/media/clip.mp4?creation_id=9&variant=video_thumbnail';
const still = '/api/creations/media/placeholder.png?creation_id=9';
const parent = '/api/creations/media/parent.jpg?creation_id=9&variant=thumbnail';

test('a video poster is the first frame, including reference-to-video', () => {
	const seed = feedItemToCreationDetailSeed({
		id: 9,
		media_type: 'video',
		url: still,
		video_url: video,
		thumbnail_url: still,
		source_image_url: '/api/creations/media/sheet.png?creation_id=9',
	});
	assert.equal(seed.image_url, frame);
	assert.equal(isDisplayableImageUrl(video), false);
	assert.equal(isDisplayableImageUrl(frame), true);
});

test('a saved poster stays the hero still', () => {
	const seed = feedItemToCreationDetailSeed({
		id: 9,
		media_type: 'video',
		url: still,
		video_url: video,
		meta: { video_placeholder_manual: true },
	});
	assert.equal(seed.image_url, still);
});

test('an image seed keeps its picture', () => {
	const seed = feedItemToCreationDetailSeed({
		id: 9,
		media_type: 'image',
		url: '/api/creations/media/a.png?creation_id=9',
		thumbnail_url: '/api/creations/media/a.png?creation_id=9&variant=thumbnail',
	});
	assert.equal(seed.image_url, '/api/creations/media/a.png?creation_id=9');
});

test('a decoded parent image is preferred over a fresh frame url', () => {
	const mapped = feedItemToCreationDetailSeed({ id: 9, media_type: 'video', url: still, video_url: video });
	const parentSeed = { ...mapped, image_url: parent, image_decoded: true };
	assert.equal(detailHeroStillUrl(withDecodedParentImage(mapped, parentSeed)), parent);
	assert.equal(detailHeroStillUrl({ ...mapped, image_url: video, image_decoded: true }), frame);
});

test('a group poster is saved on the cover video, not the group row', () => {
	const group = {
		id: 35730,
		status: 'completed',
		media_type: 'video',
		video_url: video,
		meta: { group: { kind: 'group_creations', cover_source_id: 2, source_creations: [
			{ id: 2, status: 'completed', meta: { media_type: 'video', video: { file_path: video } } },
		] } },
	};
	const target = videoPosterTargetFromCreation(group);
	assert.equal(target.id, 2);
	assert.equal(target.video_url, video);
	assert.equal(detailHeroStillUrl({
		...group,
		url: still,
		meta: { ...group.meta, video_placeholder_manual: true },
	}), still);
});

test('a click seed reads a decoded card image and ignores a video file', () => {
	const dom = new JSDOM('<div data-creation-id="9" data-media-type="video"><a href="/creations/9"><img class="home-tile__thumb"></a></div>');
	const previous = { Element: globalThis.Element, HTMLImageElement: globalThis.HTMLImageElement };
	globalThis.Element = dom.window.Element;
	globalThis.HTMLImageElement = dom.window.HTMLImageElement;
	try {
		const img = dom.window.document.querySelector('img');
		img.src = parent;
		Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
		Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 40 });
		Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => 40 });
		const decoded = creationDetailSeedFromClick({ target: img }, 9);
		assert.equal(decoded.image_decoded, true);
		assert.equal(decoded.image_url, parent);

		img.src = video;
		Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 0 });
		const broken = creationDetailSeedFromClick({ target: img }, 9);
		assert.equal(broken.image_decoded, false);
		assert.equal(broken.image_url, '');
	} finally {
		globalThis.Element = previous.Element;
		globalThis.HTMLImageElement = previous.HTMLImageElement;
	}
});
