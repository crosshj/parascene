import { describe, expect, test } from '@jest/globals';
import { isSameOriginMediaUrl } from '../src/shared/mediaAudioLeveling.js';

describe('isSameOriginMediaUrl', () => {
	const page = 'https://app.example.com/chat';

	test('empty url is treated as same-origin', () => {
		expect(isSameOriginMediaUrl('', page)).toBe(true);
	});

	test('relative path matches page origin', () => {
		expect(isSameOriginMediaUrl('/api/videos/created/1', page)).toBe(true);
	});

	test('absolute same-origin url matches', () => {
		expect(isSameOriginMediaUrl('https://app.example.com/media/x.mp4', page)).toBe(true);
	});

	test('cross-origin url does not match', () => {
		expect(isSameOriginMediaUrl('https://cdn.example.com/x.mp4', page)).toBe(false);
	});
});
