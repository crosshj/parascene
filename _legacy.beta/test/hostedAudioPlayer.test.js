import { describe, expect, test } from '@jest/globals';
import { formatHostedAudioClock } from '../public/shared/hostedAudioPlayer.js';

describe('formatHostedAudioClock', () => {
	test('formats seconds as m:ss', () => {
		expect(formatHostedAudioClock(0)).toBe('0:00');
		expect(formatHostedAudioClock(14)).toBe('0:14');
		expect(formatHostedAudioClock(90)).toBe('1:30');
		expect(formatHostedAudioClock(NaN)).toBe('0:00');
	});
});
