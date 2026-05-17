import { describe, expect, test } from '@jest/globals';
import {
	doomSiteVideosFromAnchor,
	feedRowIsStrictlyOlderThan,
	putAnchorCreationFirst
} from '../api_routes/feed/doomSiteVideoTimeline.js';
import { normalizeDoomAnchorMountItems } from '../src/chat/feed/doomFeedData.js';

describe('feedRowIsStrictlyOlderThan', () => {
	test('same created_at uses created_image_id', () => {
		expect(feedRowIsStrictlyOlderThan(
			{ created_at: '2025-01-10', created_image_id: 5 },
			'2025-01-10',
			10
		)).toBe(true);
		expect(feedRowIsStrictlyOlderThan(
			{ created_at: '2025-01-10', created_image_id: 10 },
			'2025-01-10',
			10
		)).toBe(false);
		expect(feedRowIsStrictlyOlderThan(
			{ created_at: '2025-01-10', created_image_id: 15 },
			'2025-01-10',
			10
		)).toBe(false);
	});
});

describe('doomSiteVideosFromAnchor', () => {
	const rows = [
		{ created_at: '2025-01-12', created_image_id: 30 },
		{ created_at: '2025-01-11', created_image_id: 20 },
		{ created_at: '2025-01-10', created_image_id: 10 },
		{ created_at: '2025-01-10', created_image_id: 8 },
		{ created_at: '2025-01-09', created_image_id: 5 }
	];

	test('includes anchor and strictly older only', () => {
		const out = doomSiteVideosFromAnchor(rows, 10);
		expect(out.map((r) => r.created_image_id)).toEqual([10, 8, 5]);
	});

	test('anchor is first in result when input had newer rows', () => {
		const mixed = [
			{ created_at: '2025-01-11', created_image_id: 20 },
			{ created_at: '2025-01-10', created_image_id: 10 },
			{ created_at: '2025-01-09', created_image_id: 5 }
		];
		const out = doomSiteVideosFromAnchor(mixed, 10);
		expect(out[0].created_image_id).toBe(10);
		expect(out.map((r) => r.created_image_id)).toEqual([10, 5]);
	});
});

describe('putAnchorCreationFirst / normalizeDoomAnchorMountItems', () => {
	test('moves anchor to index 0 and drops newer-leading rows', () => {
		const items = [
			{ created_image_id: 99, created_at: '2025-02-01' },
			{ created_image_id: 50, created_at: '2025-01-10' },
			{ created_image_id: 40, created_at: '2025-01-09' }
		];
		expect(putAnchorCreationFirst(items, 50).map((r) => r.created_image_id)).toEqual([50, 40]);
		expect(normalizeDoomAnchorMountItems(items, 50).map((r) => r.created_image_id)).toEqual([
			50, 40
		]);
	});
});
