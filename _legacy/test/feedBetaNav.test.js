import { describe, expect, test } from '@jest/globals';
import { feedNavLabel, feedBetaActiveFromProfile } from '../public/shared/feedBetaNav.js';

describe('feedBetaNav', () => {
	test('feedNavLabel always returns the normal label', () => {
		expect(feedNavLabel('Feed', true)).toBe('Feed');
		expect(feedNavLabel('Home', false)).toBe('Home');
	});

	test('ranked feed is active unless legacy feed is forced', () => {
		expect(feedBetaActiveFromProfile({ meta: {} })).toBe(true);
		expect(feedBetaActiveFromProfile({ meta: { forceLegacyFeed: true } })).toBe(false);
	});
});
