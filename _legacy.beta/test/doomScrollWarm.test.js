import { describe, expect, test, afterEach } from '@jest/globals';
import { shouldSkipAggressiveVideoWarm } from '../src/chat/feed/doomScrollWarm.js';

describe('shouldSkipAggressiveVideoWarm', () => {
	/** @type {Navigator | undefined} */
	let origNavigator;

	afterEach(() => {
		if (origNavigator !== undefined) {
			global.navigator = origNavigator;
		}
	});

	test('returns true when save-data is on', () => {
		origNavigator = global.navigator;
		global.navigator = {
			connection: { saveData: true, effectiveType: '4g' }
		};
		expect(shouldSkipAggressiveVideoWarm()).toBe(true);
	});

	test('returns true on slow-2g', () => {
		origNavigator = global.navigator;
		global.navigator = {
			connection: { saveData: false, effectiveType: 'slow-2g' }
		};
		expect(shouldSkipAggressiveVideoWarm()).toBe(true);
	});
});
