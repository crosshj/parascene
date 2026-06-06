import { describe, expect, test } from '@jest/globals';
import {
	feedNavLabel,
	isFeedBetaOptedInFromProfile
} from '../public/shared/feedBetaNav.js';

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

	test('isFeedBetaOptedInFromProfile is true only when feedBetaEnabled is set', () => {
		expect(isFeedBetaOptedInFromProfile(null)).toBe(false);
		expect(isFeedBetaOptedInFromProfile({ feedBetaEnabled: false })).toBe(false);
		expect(isFeedBetaOptedInFromProfile({ feedBetaEnabled: true })).toBe(true);
		expect(isFeedBetaOptedInFromProfile({ meta: { feedBetaEnabled: true } })).toBe(true);
	});
});
