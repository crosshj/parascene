import { describe, expect, test } from '@jest/globals';
import { createFeedTiming, wrapTimedPromise, feedTimingSegmentsToObject } from '../api_routes/feed/feedTiming.js';

describe('createFeedTiming', () => {
	test('records segments and total_ms', async () => {
		const timing = createFeedTiming();
		await timing.timeAsync('a', async () => {
			await new Promise((r) => setTimeout(r, 5));
		});
		timing.time('b', () => 1);
		const out = timing.finish({ page_index: 1 });
		expect(out.page_index).toBe(1);
		expect(out.total_ms).toBeGreaterThanOrEqual(0);
		expect(out.segments['1_a']).toBeGreaterThanOrEqual(0);
		expect(out.segments['2_b']).toBeGreaterThanOrEqual(0);
		expect(feedTimingSegmentsToObject([{ name: 'x', ms: 12 }])).toEqual({ '1_x': 12 });
	});

	test('wrapTimedPromise is no-op without timing', async () => {
		const value = await wrapTimedPromise(null, 'x', Promise.resolve(42));
		expect(value).toBe(42);
	});
});
