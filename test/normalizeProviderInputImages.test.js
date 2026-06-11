import { describe, expect, test, jest } from '@jest/globals';
import sharp from 'sharp';
import {
	listProviderInputImageRefs,
	normalizeProviderArgsForAspectRatio,
} from '../api_routes/utils/normalizeProviderInputImages.js';

describe('listProviderInputImageRefs', () => {
	test('collects input_images and image_url', () => {
		const refs = listProviderInputImageRefs({
			aspect_ratio: '9:16',
			input_images: ['https://example.com/a.png'],
			image_url: 'https://example.com/b.png',
		});
		expect(refs).toHaveLength(2);
		expect(refs.some((r) => r.key === 'input_images')).toBe(true);
		expect(refs.some((r) => r.key === 'image_url')).toBe(true);
	});
});

describe('normalizeProviderArgsForAspectRatio', () => {
	test('re-encodes square input to requested 9:16', async () => {
		const square = await sharp({
			create: { width: 1024, height: 1024, channels: 3, background: '#336699' },
		})
			.png()
			.toBuffer();

		const uploads = [];
		const storage = {
			uploadGenericImage: jest.fn(async (buf, key) => {
				uploads.push({ key, buf });
				return key;
			}),
		};

		const out = await normalizeProviderArgsForAspectRatio({
			args: {
				aspect_ratio: '9:16',
				input_images: ['https://example.com/square.png'],
			},
			storage,
			userId: 42,
			fetchBuffer: async () => square,
		});

		expect(storage.uploadGenericImage).toHaveBeenCalledTimes(1);
		expect(out.input_images[0]).not.toBe('https://example.com/square.png');
		expect(String(out.input_images[0])).toContain('/api/images/generic/edited/');

		const meta = await sharp(uploads[0].buf).metadata();
		expect(meta.width).toBe(576);
		expect(meta.height).toBe(1024);
	});

	test('skips when input already matches ratio and target dimensions', async () => {
		const portrait = await sharp({
			create: { width: 576, height: 1024, channels: 3, background: '#336699' },
		})
			.png()
			.toBuffer();

		const storage = {
			uploadGenericImage: jest.fn(),
		};

		const out = await normalizeProviderArgsForAspectRatio({
			args: {
				aspect_ratio: '9:16',
				input_images: ['https://example.com/portrait.png'],
			},
			storage,
			userId: 1,
			fetchBuffer: async () => portrait,
		});

		expect(storage.uploadGenericImage).not.toHaveBeenCalled();
		expect(out.input_images[0]).toBe('https://example.com/portrait.png');
	});
});
