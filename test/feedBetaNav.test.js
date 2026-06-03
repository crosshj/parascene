import { describe, expect, test } from '@jest/globals';
import { feedNavLabel } from '../public/shared/feedBetaNav.js';

describe('feedBetaNav', () => {
	test('feedNavLabel appends [beta] when enabled', () => {
		expect(feedNavLabel('Feed', true)).toBe('Feed [beta]');
		expect(feedNavLabel('Home', true)).toBe('Home [beta]');
	});

	test('feedNavLabel leaves label unchanged when disabled', () => {
		expect(feedNavLabel('Feed', false)).toBe('Feed');
	});

	test('feedNavLabel does not double-append', () => {
		expect(feedNavLabel('Feed [beta]', true)).toBe('Feed [beta]');
	});
});
