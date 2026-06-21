import { describe, expect, test } from '@jest/globals';
import {
	applyHeroAspectLayoutToElement,
	aspectRatioFromCreation,
	buildAspectRatioMismatchMessage,
	closestAspectRatioPreset,
	dimensionsForAspectRatioLongEdge,
	dimensionsMatchAspectRatio,
	videoHeroDimensionsFromCreation,
	TEMP_ALLOW_REPEAT_VIDEO_POSTER,
	canSetVideoPosterFromFirstFrame,
	shouldAutoSetVideoPosterOnPublish,
	hasProperVideoPlaceholderDimensions,
	heroLayoutMode,
	isText2VideoCreation,
	needsManualVideoPlaceholder,
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

	test('prefers stored dimensions when poster was saved from video frame', () => {
		const ratio = aspectRatioFromCreation({
			width: 720,
			height: 1280,
			meta: {
				video_placeholder_manual: true,
				args: { aspect_ratio: '9:16' },
			},
		});
		expect(ratio).toEqual({ w: 720, h: 1280, source: 'dimensions' });
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

describe('closestAspectRatioPreset', () => {
	test('detects portrait 9:16', () => {
		expect(closestAspectRatioPreset(1080, 1920)).toBe('9:16');
	});

	test('detects square', () => {
		expect(closestAspectRatioPreset(1024, 1024)).toBe('1:1');
	});

	test('detects landscape 16:9', () => {
		expect(closestAspectRatioPreset(1920, 1080)).toBe('16:9');
	});
});

describe('dimensionsMatchAspectRatio', () => {
	test('matches preset within tolerance', () => {
		expect(dimensionsMatchAspectRatio(576, 1024, '9:16')).toBe(true);
		expect(dimensionsMatchAspectRatio(1024, 1024, '9:16')).toBe(false);
	});
});

describe('buildAspectRatioMismatchMessage', () => {
	test('warns when upload aspect differs from target', () => {
		const msg = buildAspectRatioMismatchMessage({
			targetAspect: '9:16',
			uploadAspect: '1:1',
			context: 'video output',
		});
		expect(msg).toContain('prepared for 1:1');
		expect(msg).toContain('video output');
		expect(msg).toContain('9:16');
	});

	test('warns when detected differs from target', () => {
		const msg = buildAspectRatioMismatchMessage({
			targetAspect: '9:16',
			detectedAspect: '1:1',
		});
		expect(msg).toContain('looks like 1:1');
	});

	test('empty when aligned', () => {
		expect(
			buildAspectRatioMismatchMessage({
				targetAspect: '9:16',
				detectedAspect: '9:16',
				uploadAspect: '9:16',
			})
		).toBe('');
	});
});

describe('videoHeroDimensionsFromCreation', () => {
	test('uses aspect_ratio args over stored square dimensions', () => {
		expect(
			videoHeroDimensionsFromCreation({
				width: 1024,
				height: 1024,
				meta: { args: { aspect_ratio: '9:16' } },
			})
		).toEqual({ width: 576, height: 1024 });
	});
});

describe('dimensionsForAspectRatioLongEdge', () => {
	test('defaults to square when ratio missing', () => {
		expect(dimensionsForAspectRatioLongEdge(null)).toEqual({ width: 1024, height: 1024 });
	});

	test('sizes portrait 9:16 with long edge on height', () => {
		expect(dimensionsForAspectRatioLongEdge('9:16', 1024)).toEqual({ width: 576, height: 1024 });
	});

	test('sizes landscape 16:9 with long edge on width', () => {
		expect(dimensionsForAspectRatioLongEdge('16:9', 1024)).toEqual({ width: 1024, height: 576 });
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

	test('video creations use extended layout from aspect ratio metadata', () => {
		const videoCreation = {
			width: 1920,
			height: 1080,
			media_type: 'video',
			video_url: '/api/videos/created/abc.mp4',
			meta: { args: { aspect_ratio: '16:9' } },
		};
		expect(shouldUseExtendedHeroLayout(videoCreation)).toBe(true);
		expect(resolveExtendedHeroLayout(videoCreation)?.mode).toBe('landscape');
		const added = [];
		const wrapper = {
			classList: { remove: () => {}, add: (c) => added.push(c) },
			style: { removeProperty: () => {}, setProperty: () => {} },
		};
		applyHeroAspectLayoutToElement(wrapper, videoCreation);
		expect(added).toContain('hero-layout-landscape');
		expect(added).not.toContain('hero-layout-legacy');
	});
});

describe('video poster from first frame eligibility', () => {
	const t2vBase = {
		status: 'completed',
		media_type: 'video',
		video_url: '/api/videos/created/abc.mp4',
		meta: {
			method: 'text2video',
			media_type: 'video',
			args: { aspect_ratio: '9:16', prompt: 'test' },
		},
	};

	test('offers poster action for t2v with auto placeholder dimensions', () => {
		expect(canSetVideoPosterFromFirstFrame({ ...t2vBase, width: 576, height: 1024 })).toBe(true);
	});

	test('offers poster action for legacy square poster', () => {
		expect(canSetVideoPosterFromFirstFrame({ ...t2vBase, width: 1024, height: 1024 })).toBe(true);
	});

	test('does not offer for image-to-video creations', () => {
		expect(
			canSetVideoPosterFromFirstFrame({
				...t2vBase,
				meta: {
					...t2vBase.meta,
					method: 'image2video',
					args: { aspect_ratio: '9:16', input_images: ['https://example.com/a.png'] },
				},
			})
		).toBe(false);
	});

	test('offers for Parascene Blue image2video without source image', () => {
		expect(
			canSetVideoPosterFromFirstFrame({
				...t2vBase,
				meta: {
					method: 'image2video',
					media_type: 'video',
					args: { aspect_ratio: '9:16', model: 'ltx_i2v', prompt: 'test' },
				},
			})
		).toBe(true);
	});

	test('manual poster suppresses repeat capture unless TEMP_ALLOW_REPEAT_VIDEO_POSTER', () => {
		const row = {
			...t2vBase,
			meta: { ...t2vBase.meta, video_placeholder_manual: true },
		};
		expect(canSetVideoPosterFromFirstFrame(row)).toBe(TEMP_ALLOW_REPEAT_VIDEO_POSTER);
	});

	test('shouldAutoSetVideoPosterOnPublish skips manual posters', () => {
		expect(shouldAutoSetVideoPosterOnPublish({ ...t2vBase, width: 576, height: 1024 })).toBe(true);
		expect(
			shouldAutoSetVideoPosterOnPublish({
				...t2vBase,
				meta: { ...t2vBase.meta, video_placeholder_manual: true },
			})
		).toBe(false);
	});

	test('legacy dimension check still flags mismatched posters', () => {
		expect(needsManualVideoPlaceholder({ ...t2vBase, width: 1024, height: 1024 })).toBe(true);
		expect(needsManualVideoPlaceholder({ ...t2vBase, width: 576, height: 1024 })).toBe(false);
	});

	test('isText2VideoCreation excludes rows with a source image', () => {
		expect(isText2VideoCreation(t2vBase)).toBe(true);
		expect(
			isText2VideoCreation({
				...t2vBase,
				meta: { method: 'image2video', args: { input_images: ['x'] } },
			})
		).toBe(false);
		expect(
			isText2VideoCreation({
				...t2vBase,
				source_image_url: '/api/images/created/foo.png',
				meta: { method: 'image2video', args: {} },
			})
		).toBe(false);
	});
});
