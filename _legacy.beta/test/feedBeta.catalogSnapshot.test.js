import { describe, expect, test } from '@jest/globals';
import { sliceBackPoolFromSeed } from '../api_routes/feedBeta/catalogSnapshot.js';
import { parseFeedBetaSeenMembers, feedBetaSeenKey } from '../api_routes/feedBeta/seenRedis.js';

describe('feedBeta catalogSnapshot', () => {
	test('sliceBackPoolFromSeed is deterministic for same seed', () => {
		const pool = Array.from({ length: 50 }, (_, i) => ({ created_image_id: i + 1 }));
		const a = sliceBackPoolFromSeed(pool, 'user:1:p2', 10);
		const b = sliceBackPoolFromSeed(pool, 'user:1:p2', 10);
		expect(a.map((r) => r.created_image_id)).toEqual(b.map((r) => r.created_image_id));
	});

	test('sliceBackPoolFromSeed differs across seeds', () => {
		const pool = Array.from({ length: 50 }, (_, i) => ({ created_image_id: i + 1 }));
		const a = sliceBackPoolFromSeed(pool, 'seed-a', 10);
		const b = sliceBackPoolFromSeed(pool, 'seed-b', 10);
		expect(a.map((r) => r.created_image_id).join(',')).not.toBe(
			b.map((r) => r.created_image_id).join(',')
		);
	});
});

describe('feedBeta seenRedis helpers', () => {
	test('feedBetaSeenKey is namespaced per user', () => {
		expect(feedBetaSeenKey(42)).toBe('feed-beta:seen:42');
	});

	test('parseFeedBetaSeenMembers normalizes ids', () => {
		const set = parseFeedBetaSeenMembers(['1', 2, '', '3']);
		expect(set.has('1')).toBe(true);
		expect(set.has('2')).toBe(true);
		expect(set.has('3')).toBe(true);
		expect(set.size).toBe(3);
	});
});
