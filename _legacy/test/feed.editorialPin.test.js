import { describe, expect, test } from '@jest/globals';
import { assembleFeedItems } from '../api_routes/feed/assembleFeedItems.js';
import {
	mergeEditorialPinIntoPage,
	removeEditorialPinsFromList,
	resolveEditorialPinInsertIndex
} from '../api_routes/feed/editorialPin.js';
import { normalizeEditorialPinConfig } from '../api_routes/feed/editorialPinPolicy.js';

function minimalCreationRow(id) {
	return {
		created_image_id: id,
		id,
		created_at: '2025-02-01T12:00:00.000Z',
		user_id: id + 10,
		title: `Post ${id}`,
		meta: { media_type: 'image' },
		nsfw: false,
		like_count: 0,
		comment_count: 0,
		viewer_liked: false
	};
}

const activePolicyJson = {
	defaults: {
		min_index_flat: 3,
		min_index_slot_pack: 7,
		after_challenge_offset: 2,
		respect_challenge: true
	},
	pins: [
		{
			created_image_id: 12440,
			enabled: true,
			until: '2026-06-10T23:59:59.999Z',
			show_metadata: true,
			surfaces: ['all'],
			inject: { slot: 'min_index' }
		}
	]
};

function mockQueriesWithPolicy(policy = activePolicyJson) {
	return {
		selectPolicyByKey: {
			get: async (key) =>
				key === 'feed.editorial_pins' ? { value: JSON.stringify(policy) } : null
		},
		selectFeedItemsByCreationIds: {
			all: async (ids) =>
				ids.map((id) => ({
					...minimalCreationRow(id),
					created_image_id: id,
					id
				}))
		}
	};
}

describe('editorialPin helpers', () => {
	test('removes duplicate pin id from list before inject', () => {
		const list = [minimalCreationRow(1), minimalCreationRow(12440), minimalCreationRow(2)];
		const out = removeEditorialPinsFromList(list, new Set([12440]));
		expect(out.map((r) => r.id)).toEqual([1, 2]);
	});

	test('flat feed inserts at least at index 3', () => {
		const list = Array.from({ length: 8 }, (_, i) => minimalCreationRow(i + 1));
		const pinConfig = normalizeEditorialPinConfig({
			created_image_id: 12440,
			inject: { slot: 'min_index', min_index_flat: 3 }
		});
		const pin = { ...minimalCreationRow(12440), editorial_pin: true };
		const out = mergeEditorialPinIntoPage(list, pin, pinConfig, { min_index_flat: 3 }, { limit: 20 });
		const idx = out.findIndex((r) => r.created_image_id === 12440);
		expect(idx).toBeGreaterThanOrEqual(3);
		expect(idx).not.toBe(0);
	});

	test('places pin after challenge with offset', () => {
		const list = [
			minimalCreationRow(1),
			minimalCreationRow(2),
			{ type: 'engagement', id: 'eng:1', variant: 'challenge_stats' },
			minimalCreationRow(3),
			minimalCreationRow(4)
		];
		const pinConfig = normalizeEditorialPinConfig({
			created_image_id: 99,
			inject: { slot: 'min_index', min_index_flat: 3, after_challenge_offset: 2, respect_challenge: true }
		});
		const idx = resolveEditorialPinInsertIndex(list, pinConfig, { min_index_flat: 3 }, {});
		expect(idx).toBe(4);
	});

	test('slot-pack minimum index is 7', () => {
		const list = Array.from({ length: 12 }, (_, i) => minimalCreationRow(i + 1));
		const pinConfig = normalizeEditorialPinConfig({
			created_image_id: 99,
			inject: { slot: 'min_index', min_index_slot_pack: 7 }
		});
		const idx = resolveEditorialPinInsertIndex(list, pinConfig, { min_index_slot_pack: 7 }, {
			slotPackPageOne: true
		});
		expect(idx).toBeGreaterThanOrEqual(7);
	});
});

describe('assembleFeedItems editorial pin', () => {
	test('injects pin on page 1 from policy', async () => {
		const realDate = Date;
		global.Date = class extends realDate {
			constructor(...args) {
				if (args.length === 0) {
					super('2026-06-05T12:00:00.000Z');
					return;
				}
				super(...args);
			}
			static now() {
				return new realDate('2026-06-05T12:00:00.000Z').getTime();
			}
		};

		const rows = Array.from({ length: 10 }, (_, i) => minimalCreationRow(i + 1));
		const { items } = await assembleFeedItems({
			queries: mockQueriesWithPolicy(),
			user: { id: 1, meta: {} },
			limit: 20,
			offset: 0,
			creationPull: {
				rows,
				hasMore: true,
				mobileChatSlotPackPageOne: false,
				mobileChatSlotPackContinuation: false
			},
			challengeSnapshot: { ok: false },
			includeChallengeEngagement: false,
			includeEditorialPin: true,
			includeBlogMerge: false
		});

		global.Date = realDate;

		const idx = items.findIndex((r) => r.created_image_id === 12440);
		expect(idx).toBeGreaterThanOrEqual(3);
		expect(items[idx].editorial_pin).toBe(true);
		expect(items[idx].editorial_pin_show_metadata).toBe(true);
	});

	test('skips inject when promo expired in policy', async () => {
		const rows = [minimalCreationRow(1), minimalCreationRow(2)];
		const { items } = await assembleFeedItems({
			queries: mockQueriesWithPolicy({
				pins: [
					{
						created_image_id: 12440,
						enabled: true,
						until: '2026-06-01T00:00:00.000Z'
					}
				]
			}),
			user: { id: 1, meta: {} },
			limit: 20,
			offset: 0,
			creationPull: { rows, hasMore: false },
			challengeSnapshot: { ok: false },
			includeEditorialPin: true,
			includeBlogMerge: false
		});

		expect(items.some((r) => r.created_image_id === 12440)).toBe(false);
	});

	test('skips inject on chat surface when pin is home-only', async () => {
		const rows = Array.from({ length: 6 }, (_, i) => minimalCreationRow(i + 1));
		const { items } = await assembleFeedItems({
			queries: mockQueriesWithPolicy({
				pins: [
					{
						created_image_id: 12440,
						enabled: true,
						until: '2026-12-31T23:59:59.999Z',
						surfaces: ['home']
					}
				]
			}),
			user: { id: 1, meta: {} },
			limit: 20,
			offset: 0,
			creationPull: { rows, hasMore: false },
			challengeSnapshot: { ok: false },
			includeEditorialPin: true,
			includeBlogMerge: false,
			feedSurface: 'chat'
		});

		expect(items.some((r) => r.created_image_id === 12440)).toBe(false);
	});
});
