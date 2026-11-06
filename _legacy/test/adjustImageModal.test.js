import { describe, expect, test } from '@jest/globals';
import {
	adjustmentsAreDefault,
	buildCssFilter,
	clampAdjustValue,
} from '../public/shared/adjustImageModal.js';

describe('clampAdjustValue', () => {
	test('clamps and rounds', () => {
		expect(clampAdjustValue(100)).toBe(100);
		expect(clampAdjustValue(-10)).toBe(0);
		expect(clampAdjustValue(250)).toBe(200);
		expect(clampAdjustValue(112.6)).toBe(113);
		expect(clampAdjustValue('88')).toBe(88);
		expect(clampAdjustValue(NaN)).toBe(100);
	});
});

describe('buildCssFilter', () => {
	test('maps percent values to CSS filter functions', () => {
		expect(buildCssFilter({ brightness: 100, contrast: 100, saturation: 100 })).toBe(
			'brightness(1) contrast(1) saturate(1)'
		);
		expect(buildCssFilter({ brightness: 50, contrast: 150, saturation: 0 })).toBe(
			'brightness(0.5) contrast(1.5) saturate(0)'
		);
	});
});

describe('adjustmentsAreDefault', () => {
	test('detects default and changed values', () => {
		expect(adjustmentsAreDefault({ brightness: 100, contrast: 100, saturation: 100 })).toBe(true);
		expect(adjustmentsAreDefault({ brightness: 101, contrast: 100, saturation: 100 })).toBe(false);
		expect(adjustmentsAreDefault(null)).toBe(true);
	});
});
