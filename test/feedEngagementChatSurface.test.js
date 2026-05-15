import { describe, expect, test } from '@jest/globals';
import {
	injectEngagementIntoSlotPackHead,
	mergeEngagementIntoPage,
	SLOT_PACK_FIRST_ENGAGEMENT_INSERT_INDEX
} from '../api_routes/feed/engagementAndNewbie.js';

describe('mergeEngagementIntoPage feed_surface=chat', () => {
	test('maps after_fifth to after_second on chat surface', () => {
		const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
		const engagement = [{ type: 'engagement', id: 'eng', slot: 'after_fifth' }];
		const out = mergeEngagementIntoPage(base, engagement, { limit: 20, feedSurface: 'chat' });
		expect(out.findIndex((r) => r.id === 'eng')).toBe(2);
	});

	test('leaves after_fifth on default surface', () => {
		const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
		const engagement = [{ type: 'engagement', id: 'eng', slot: 'after_fifth' }];
		const out = mergeEngagementIntoPage(base, engagement, { limit: 20 });
		expect(out.findIndex((r) => r.id === 'eng')).toBe(5);
	});
});

describe('injectEngagementIntoSlotPackHead', () => {
	test('inserts at first between-strip middle index', () => {
		const base = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
		const out = injectEngagementIntoSlotPackHead(base, [
			{ type: 'engagement', id: 'eng', slot: 'after_second' }
		]);
		expect(out.findIndex((r) => r.id === 'eng')).toBe(SLOT_PACK_FIRST_ENGAGEMENT_INSERT_INDEX);
	});
});
