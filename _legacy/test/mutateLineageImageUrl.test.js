import { describe, expect, test } from '@jest/globals';
import {
	applySourceShareUrlToMutateArgsWhenMatching,
	isGenericUploadImageUrl,
	shouldReplaceMutateInputWithSourceShareUrl,
} from '../api_routes/utils/mutateLineageImageUrl.js';

const BASE = 'https://app.example.com';

describe('isGenericUploadImageUrl', () => {
	test('detects generic upload paths', () => {
		expect(isGenericUploadImageUrl('/api/images/generic/user/abc.png')).toBe(true);
		expect(isGenericUploadImageUrl(`${BASE}/api/images/generic/user/abc.png`)).toBe(true);
		expect(isGenericUploadImageUrl('/api/images/created/123.png')).toBe(false);
	});
});

describe('shouldReplaceMutateInputWithSourceShareUrl', () => {
	const filename = 'user_1_frame.png';
	const sourceUrl = `${BASE}/api/images/created/${filename}`;

	test('replaces when submitted URL matches source creation image', () => {
		expect(
			shouldReplaceMutateInputWithSourceShareUrl({
				submittedUrl: sourceUrl,
				sourceFilename: filename,
				baseOrigin: BASE,
			})
		).toBe(true);
	});

	test('does not replace generic frame uploads', () => {
		expect(
			shouldReplaceMutateInputWithSourceShareUrl({
				submittedUrl: `${BASE}/api/images/generic/user/frame-99.png`,
				sourceFilename: filename,
				baseOrigin: BASE,
			})
		).toBe(false);
	});

	test('does not replace when submitted URL differs from source image', () => {
		expect(
			shouldReplaceMutateInputWithSourceShareUrl({
				submittedUrl: `${BASE}/api/images/created/other.png`,
				sourceFilename: filename,
				baseOrigin: BASE,
			})
		).toBe(false);
	});
});

describe('applySourceShareUrlToMutateArgsWhenMatching', () => {
	test('leaves generic frame URL in args', () => {
		const frameUrl = `${BASE}/api/images/generic/user/frame.png`;
		const safeArgs = { image_url: frameUrl, input_images: [frameUrl] };
		const metaArgs = { ...safeArgs };
		const shareUrl = `${BASE}/api/share/v1/token/image`;

		applySourceShareUrlToMutateArgsWhenMatching({
			safeArgs,
			metaArgs,
			shareUrl,
			imageUrlKeys: ['image_url'],
			imageUrlArrayKeys: ['input_images'],
			sourceFilename: 'video_poster.png',
			baseOrigin: BASE,
		});

		expect(safeArgs.image_url).toBe(frameUrl);
		expect(safeArgs.input_images[0]).toBe(frameUrl);
	});

	test('replaces matching source URL with share URL', () => {
		const sourceUrl = `${BASE}/api/images/created/video_poster.png`;
		const safeArgs = { image_url: sourceUrl };
		const metaArgs = { ...safeArgs };
		const shareUrl = `${BASE}/api/share/v1/token/image`;

		applySourceShareUrlToMutateArgsWhenMatching({
			safeArgs,
			metaArgs,
			shareUrl,
			imageUrlKeys: ['image_url'],
			imageUrlArrayKeys: [],
			sourceFilename: 'video_poster.png',
			baseOrigin: BASE,
		});

		expect(safeArgs.image_url).toBe(shareUrl);
		expect(metaArgs.image_url).toBe(shareUrl);
	});
});
