import { describe, expect, test } from '@jest/globals';
import { shouldUseAspectRatioSelector } from '../public/shared/aspectRatio.js';

describe('shouldUseAspectRatioSelector', () => {
	test('enabled for grok-imagine on server 1 replicate', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicate',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(true);
	});

	test('disabled for other servers', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 2,
				methodKey: 'replicate',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(false);
	});

	test('disabled for other methods', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicateVideo',
				modelValue: 'xai/grok-imagine-image',
			})
		).toBe(false);
	});

	test('disabled for other models', () => {
		expect(
			shouldUseAspectRatioSelector({
				serverId: 1,
				methodKey: 'replicate',
				modelValue: 'prunaai/p-image',
			})
		).toBe(false);
	});
});
