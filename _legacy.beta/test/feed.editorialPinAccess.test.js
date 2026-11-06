import { describe, expect, test } from '@jest/globals';
import { canViewUnpublishedCreationViaEditorialPin } from '../api_routes/feed/editorialPin.js';
import { FEED_EDITORIAL_PINS_POLICY_KEY } from '../api_routes/feed/editorialPinPolicy.js';
import { requireCreatedImageAccess as requireLikeAccess } from '../api_routes/likes.js';
import { requireCreatedImageAccess as requireCommentAccess } from '../api_routes/comments.js';

function queriesWithPins(pins, { image = null, ownerUserId = null } = {}) {
	const unpublished = image || {
		id: 9001,
		user_id: 42,
		published: 0,
		unavailable_at: null
	};
	return {
		selectPolicyByKey: {
			get: async (key) => {
				if (key !== FEED_EDITORIAL_PINS_POLICY_KEY) return null;
				return {
					value: JSON.stringify({
						defaults: {},
						pins
					})
				};
			}
		},
		selectCreatedImageById: {
			get: async (imageId, userId) => {
				if (ownerUserId != null && Number(userId) === Number(ownerUserId) && Number(imageId) === Number(unpublished.id)) {
					return unpublished;
				}
				return null;
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (imageId) => {
				if (Number(imageId) === Number(unpublished.id)) return unpublished;
				return null;
			}
		}
	};
}

const activePin = {
	id: 'challenge-open-weekly-1',
	created_image_id: 9001,
	enabled: true,
	starts_at: '2026-08-01T00:00:00.000Z',
	until: '2026-08-10T00:00:00.000Z',
	surfaces: ['all']
};

const expiredPin = {
	id: 'challenge-open-weekly-1',
	created_image_id: 9001,
	enabled: true,
	until: '2026-07-01T00:00:00.000Z',
	surfaces: ['all']
};

describe('canViewUnpublishedCreationViaEditorialPin', () => {
	const nowMs = Date.parse('2026-08-02T12:00:00.000Z');

	test('allows unpublished creation while pin is active', async () => {
		const queries = queriesWithPins([activePin]);
		const ok = await canViewUnpublishedCreationViaEditorialPin(queries, {
			ancestorRow: { id: 9001, unavailable_at: null },
			nowMs
		});
		expect(ok).toBe(true);
	});

	test('denies when pin expired or id mismatch', async () => {
		const queries = queriesWithPins([expiredPin]);
		expect(
			await canViewUnpublishedCreationViaEditorialPin(queries, {
				ancestorRow: { id: 9001 },
				nowMs
			})
		).toBe(false);
		expect(
			await canViewUnpublishedCreationViaEditorialPin(queries, {
				ancestorRow: { id: 9002 },
				nowMs
			})
		).toBe(false);
	});

	test('denies unavailable creations', async () => {
		const queries = queriesWithPins([
			{
				created_image_id: 9001,
				enabled: true,
				until: '2026-08-10T00:00:00.000Z',
				surfaces: ['all']
			}
		]);
		expect(
			await canViewUnpublishedCreationViaEditorialPin(queries, {
				ancestorRow: { id: 9001, unavailable_at: '2026-08-01T00:00:00.000Z' },
				nowMs
			})
		).toBe(false);
	});
});

describe('getCreationFeedPinStatus', () => {
	const nowMs = Date.parse('2026-08-02T12:00:00.000Z');

	test('summarizes active open pin for creation', async () => {
		const { getCreationFeedPinStatus } = await import('../api_routes/feed/editorialPin.js');
		const queries = queriesWithPins([
			{
				id: 'challenge-open-weekly-1',
				created_image_id: 9001,
				enabled: true,
				until: '2026-08-09T00:00:00.000Z',
				surfaces: ['all']
			}
		]);
		const status = await getCreationFeedPinStatus(queries, 9001, { nowMs });
		expect(status.active).toBe(true);
		expect(status.until).toBe('2026-08-09T00:00:00.000Z');
		expect(status.challenge_id).toBe('weekly-1');
		expect(status.pins[0].kind).toBe('open');
		expect(status.pins[0].challenge_id).toBe('weekly-1');
	});
});

describe('parseChallengeEditorialPinId', () => {
	test('parses kind and challenge id from pin id', async () => {
		const { parseChallengeEditorialPinId } = await import('../api_routes/feed/editorialPin.js');
		expect(parseChallengeEditorialPinId('challenge-open-summer-2026')).toEqual({
			kind: 'open',
			challengeId: 'summer-2026'
		});
		expect(parseChallengeEditorialPinId('challenge-winners-abc')).toEqual({
			kind: 'winners',
			challengeId: 'abc'
		});
		expect(parseChallengeEditorialPinId('challenge-topic_vote-xyz')).toEqual({
			kind: 'topic_vote',
			challengeId: 'xyz'
		});
		expect(parseChallengeEditorialPinId('promo-other')).toEqual({
			kind: 'other',
			challengeId: ''
		});
	});
});

describe('transformEditorialPinFeedItem challenge pins', () => {
	test('forces image-only metadata off for challenge-* pins', async () => {
		const { transformEditorialPinFeedItem } = await import('../api_routes/feed/editorialPin.js');
		const row = {
			created_image_id: 9001,
			id: 9001,
			created_at: '2026-08-01T00:00:00.000Z',
			user_id: 1,
			title: 'Promo',
			meta: { media_type: 'image' },
			nsfw: false,
			like_count: 0,
			comment_count: 0,
			viewer_liked: false
		};
		const item = transformEditorialPinFeedItem(row, {
			id: 'challenge-open-weekly-1',
			created_image_id: 9001,
			show_metadata: true,
			extra_spacing: true
		});
		expect(item.editorial_pin).toBe(true);
		expect(item.editorial_pin_show_metadata).toBe(false);
	});

	test('respects show_metadata for non-challenge pins', async () => {
		const { transformEditorialPinFeedItem } = await import('../api_routes/feed/editorialPin.js');
		const row = {
			created_image_id: 9001,
			id: 9001,
			created_at: '2026-08-01T00:00:00.000Z',
			user_id: 1,
			title: 'Promo',
			meta: { media_type: 'image' },
			nsfw: false,
			like_count: 0,
			comment_count: 0,
			viewer_liked: false
		};
		const withMeta = transformEditorialPinFeedItem(row, {
			id: 'admin-promo-1',
			created_image_id: 9001,
			show_metadata: true
		});
		expect(withMeta.editorial_pin_show_metadata).toBe(true);
		const withoutMeta = transformEditorialPinFeedItem(row, {
			id: 'admin-promo-1',
			created_image_id: 9001,
			show_metadata: false
		});
		expect(withoutMeta.editorial_pin_show_metadata).toBe(false);
	});
});

describe('requireCreatedImageAccess with editorial pins', () => {
	const liveActivePin = {
		id: 'challenge-open-weekly-1',
		created_image_id: 9001,
		enabled: true,
		starts_at: '2020-01-01T00:00:00.000Z',
		until: '2099-01-01T00:00:00.000Z',
		surfaces: ['all']
	};

	const liveExpiredPin = {
		id: 'challenge-open-weekly-1',
		created_image_id: 9001,
		enabled: true,
		until: '2020-01-01T00:00:00.000Z',
		surfaces: ['all']
	};

	test('likes allow unpublished creation while pin is active', async () => {
		const queries = queriesWithPins([liveActivePin]);
		const image = await requireLikeAccess({
			queries,
			imageId: 9001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeTruthy();
		expect(image.id).toBe(9001);
	});

	test('likes deny unpublished creation when pin expired', async () => {
		const queries = queriesWithPins([liveExpiredPin]);
		const image = await requireLikeAccess({
			queries,
			imageId: 9001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeNull();
	});

	test('comments allow unpublished creation while pin is active', async () => {
		const queries = queriesWithPins([liveActivePin]);
		const image = await requireCommentAccess({
			queries,
			imageId: 9001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeTruthy();
		expect(image.id).toBe(9001);
	});

	test('comments deny unpublished creation when pin expired', async () => {
		const queries = queriesWithPins([liveExpiredPin]);
		const image = await requireCommentAccess({
			queries,
			imageId: 9001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeNull();
	});
});
