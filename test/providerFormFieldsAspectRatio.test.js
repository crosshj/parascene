import { describe, expect, test } from '@jest/globals';
import { modelSupportsAspectRatio, shouldUseAspectRatioSelector } from '../public/shared/aspectRatio.js';
import { PARASCENE_BLUE_SERVER_ID } from '../public/shared/generationDefaults.js';

const REPLICATE_ASPECT_FIELD = {
	aspect_ratio: { type: 'select', hidden: true, default: '1:1', options: ['1:1', '9:16'] },
};

describe('shouldUseAspectRatioSelector', () => {
	test('enabled when method fields include aspect_ratio', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: PARASCENE_BLUE_SERVER_ID,
				methodKey: 'image2video',
				modelValue: 'ltx_i2v',
				fields: {
					aspect_ratio: { type: 'select', options: ['16:9', '9:16'] },
				},
			})
		).toBe(true);
	});

	test('enabled for uploadImage on Parascene server', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'uploadImage',
				modelValue: '',
			})
		).toBe(true);
	});

	test('enabled for grok-imagine on server 1 replicate', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicate',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(true);
	});

	test('disabled for other servers without aspect_ratio field', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 2,
				methodKey: 'replicate',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(false);
	});

	test('disabled for other methods without aspect_ratio field', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicateVideo',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(false);
	});

	test('disabled for other models without aspect_ratio field', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicate',
				modelValue: 'prunaai/p-image',
			})
		).toBe(false);
	});

	test('disabled for replicate models that share aspect_ratio field but do not support it', () => {
		const context = {
			serverId: 1,
			methodKey: 'replicate',
			modelValue: 'prunaai/p-image',
			fields: REPLICATE_ASPECT_FIELD,
		};
		expect(modelSupportsAspectRatio(context)).toBe(false);
		expect(shouldUseAspectRatioSelector(context)).toBe(false);
	});

	test('enabled for grok when replicate method exposes hidden aspect_ratio field', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicate',
				modelValue: 'xai/grok-imagine-image',
				fields: REPLICATE_ASPECT_FIELD,
			})
		).toBe(true);
	});
});
