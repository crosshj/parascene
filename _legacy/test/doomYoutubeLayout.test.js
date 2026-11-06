import { describe, expect, test } from '@jest/globals';
import { doomYoutubeFrameInsets } from '../src/chat/feed/doomYoutubeLayout.js';

describe('doomYoutubeFrameInsets', () => {
	test('keeps full-width vertical band between chrome', () => {
		expect(doomYoutubeFrameInsets(844, { topInset: 70, bottomInset: 96 })).toEqual({
			top: 70,
			bottom: 96
		});
	});

	test('without insets fills the wrap', () => {
		expect(doomYoutubeFrameInsets(844)).toEqual({ top: 0, bottom: 0 });
	});

	test('returns null when the wrap is empty or chrome consumes it', () => {
		expect(doomYoutubeFrameInsets(0)).toBeNull();
		expect(doomYoutubeFrameInsets(100, { topInset: 60, bottomInset: 60 })).toBeNull();
	});
});
