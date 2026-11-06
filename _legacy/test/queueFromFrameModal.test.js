import { describe, expect, test } from '@jest/globals';
import { clampFrameTime, formatVideoTime } from '../public/shared/queueFromFrameModal.js';

describe('formatVideoTime', () => {
	test('formats seconds as m:ss', () => {
		expect(formatVideoTime(0)).toBe('0:00');
		expect(formatVideoTime(9)).toBe('0:09');
		expect(formatVideoTime(65)).toBe('1:05');
	});
});

describe('clampFrameTime', () => {
	test('clamps to valid range below duration', () => {
		expect(clampFrameTime(5, 10)).toBe(5);
		expect(clampFrameTime(20, 10)).toBeCloseTo(9.999, 3);
		expect(clampFrameTime(-1, 10)).toBe(0);
	});

	test('returns 0 when duration invalid', () => {
		expect(clampFrameTime(3, 0)).toBe(0);
		expect(clampFrameTime(3, NaN)).toBe(0);
	});
});
