import { describe, expect, test } from '@jest/globals';
import {
	applyHeroAspectLayoutToElement,
	aspectRatioFromCreation,
	heroLayoutMode,
	parseAspectRatioString,
	isPortrait916Aspect,
	portraitHeroSizing,
	resolveExtendedHeroLayout,
	shouldUseExtendedHeroLayout,
} from '../public/shared/aspectRatio.js';

describe('aspectRatioFromCreation', () => {
	test('prefers meta.args.aspect_ratio over stored dimensions', () => {
		const ratio = aspectRatioFromCreation({
			width: 1024,
			height: 1024,
			meta: { args: { aspect_ratio: '16:9' } },
		});
		expect(ratio).toEqual({ w: 16, h: 9, source: 'args' });
		expect(heroLayoutMode(ratio.w, ratio.h)).toBe('landscape');
	});

	test('falls back to width and height', () => {
		const ratio = aspectRatioFromCreation({ width: 768, height: 1376, meta: {} });
		expect(ratio).toEqual({ w: 768, h: 1376, source: 'dimensions' });
		expect(heroLayoutMode(ratio.w, ratio.h)).toBe('portrait');
	});

	test('parses preset ratios', () => {
		expect(parseAspectRatioString('4:5')).toEqual([4, 5]);
		expect(heroLayoutMode(4, 5)).toBe('portrait');
	});
});

describe('extended hero layout scope', () => {
	test('1:1 uses legacy layout (no extended class)', () => {
		const creation = { width: 1024, height: 1024, meta: { args: { aspect_ratio: '1:1' } } };
		expect(shouldUseExtendedHeroLayout(creation)).toBe(false);
		expect(resolveExtendedHeroLayout(creation)).toBeNull();
	});

	test('applyHeroAspectLayoutToElement marks legacy wrapper', () => {
		const added = [];
		const wrapper = {
			classList: { remove: () => {}, add: (c) => added.push(c) },
			style: { removeProperty: () => {}, setProperty: () => {} },
		};
		applyHeroAspectLayoutToElement(wrapper, {
			width: 1024,
			height: 1024,
			meta: { args: { aspect_ratio: '1:1' } },
		});
		expect(added).toContain('hero-layout-legacy');
		expect(added).not.toContain('hero-layout-landscape');
		expect(added).not.toContain('hero-layout-portrait');
	});

	test('supported non-square ratios use extended layout', () => {
		expect(resolveExtendedHeroLayout({ meta: { args: { aspect_ratio: '4:5' } } })).toEqual({
			w: 4,
			h: 5,
			mode: 'portrait',
		});
		expect(resolveExtendedHeroLayout({ meta: { args: { aspect_ratio: '16:9' } } })?.mode).toBe('landscape');
	});

	test('portraitHeroSizing splits 4:5 vs 9:16', () => {
		expect(portraitHeroSizing(4, 5)).toBe('width');
		expect(portraitHeroSizing(9, 16)).toBe('width');
		expect(isPortrait916Aspect(768, 1376)).toBe(true);
	});

	test('applyHeroAspectLayoutToElement uses portrait layout for 9:16', () => {
		const added = [];
		const wrapper = {
			classList: { remove: () => {}, add: (c) => added.push(c) },
			style: { removeProperty: () => {}, setProperty: () => {} },
		};
		applyHeroAspectLayoutToElement(wrapper, { meta: { args: { aspect_ratio: '9:16' } } });
		expect(added).toContain('hero-layout-portrait');
		expect(added).toContain('hero-portrait-by-width');
		expect(added).not.toContain('hero-aspect-9-16');
	});

	test('non-square dimensions without args use extended layout', () => {
		expect(shouldUseExtendedHeroLayout({ width: 768, height: 1376, meta: {} })).toBe(true);
		expect(shouldUseExtendedHeroLayout({ width: 1024, height: 1024, meta: {} })).toBe(false);
	});
});
