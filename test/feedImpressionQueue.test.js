import { describe, expect, test } from '@jest/globals';
import {
	coalesceImpressionQueue,
	mergeImpressionIntoQueue,
	shouldSkipImpressionEnqueue
} from '../public/shared/feedImpressionQueue.js';
import { parseFeedImpressionsBatchBody } from '../api_routes/feedBeta/userCreationSeen.js';

describe('feedImpressionQueue', () => {
	test('mergeImpressionIntoQueue upgrades dwell to click', () => {
		const queue = mergeImpressionIntoQueue(
			[{ creation_id: 1, trigger: 'dwell', attribution: { pool: 'new' } }],
			{ creation_id: 1, trigger: 'click', attribution: { pool: 'new' } }
		);
		expect(queue).toHaveLength(1);
		expect(queue[0].trigger).toBe('click');
	});

	test('shouldSkipImpressionEnqueue skips dwell when already queued or sent', () => {
		const sent = new Set(['1']);
		const queue = [{ creation_id: 2, trigger: 'dwell' }];
		expect(shouldSkipImpressionEnqueue(sent, [], 1, 'dwell')).toBe(true);
		expect(shouldSkipImpressionEnqueue(sent, queue, 2, 'dwell')).toBe(true);
		expect(shouldSkipImpressionEnqueue(sent, queue, 1, 'click')).toBe(false);
	});

	test('coalesceImpressionQueue dedupes by creation_id', () => {
		const out = coalesceImpressionQueue([
			{ creation_id: 3, trigger: 'dwell' },
			{ creation_id: 3, trigger: 'click' }
		]);
		expect(out).toHaveLength(1);
		expect(out[0].trigger).toBe('click');
	});
});

describe('parseFeedImpressionsBatchBody', () => {
	test('parses items array capped at 50', () => {
		const items = Array.from({ length: 60 }, (_, i) => ({
			creation_id: i + 1,
			trigger: 'dwell'
		}));
		const parsed = parseFeedImpressionsBatchBody({ items });
		expect(parsed.length).toBe(50);
		expect(parsed[0].creationId).toBe(1);
	});
});
