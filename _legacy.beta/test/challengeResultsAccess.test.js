import { describe, expect, test } from '@jest/globals';
import { challengeResultsCreationMatchesInRecentConfigs } from '../api_routes/utils/challengeSubmitShared.js';
import { canViewUnpublishedChallengeResultsCreation } from '../api_routes/utils/challengeResultsAccess.js';
import { creationMetaHasChallengeResultsOrganizerRef } from '../src/shared/challengeOrganizerRefMeta.js';
import { requireCreatedImageAccess as requireLikeAccess } from '../api_routes/likes.js';
import { requireCreatedImageAccess as requireCommentAccess } from '../api_routes/comments.js';
import { FEED_EDITORIAL_PINS_POLICY_KEY } from '../api_routes/feed/editorialPinPolicy.js';

describe('challengeResultsCreationMatchesInRecentConfigs', () => {
	test('matches results_creation_url for challenge id', () => {
		const messages = [
			{
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: 'summer-1',
					results_creation_url: '/creations/5001'
				})
			},
			{
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: 'summer-1',
					results_creation_url: '/creations/4999'
				})
			}
		];
		expect(challengeResultsCreationMatchesInRecentConfigs(messages, 'summer-1', 5001)).toBe(true);
		expect(challengeResultsCreationMatchesInRecentConfigs(messages, 'summer-1', 4999)).toBe(true);
		expect(challengeResultsCreationMatchesInRecentConfigs(messages, 'summer-1', 1)).toBe(false);
		expect(challengeResultsCreationMatchesInRecentConfigs(messages, 'other', 5001)).toBe(false);
	});

	test('ignores hero_image_url', () => {
		const messages = [
			{
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: 'summer-1',
					hero_image_url: '/creations/5001'
				})
			}
		];
		expect(challengeResultsCreationMatchesInRecentConfigs(messages, 'summer-1', 5001)).toBe(false);
	});
});

describe('canViewUnpublishedChallengeResultsCreation via organizer meta', () => {
	test('allows unpublished creation stamped as results', async () => {
		const ok = await canViewUnpublishedChallengeResultsCreation({
			image: {
				id: 5001,
				published: 0,
				unavailable_at: null,
				meta: {
					challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'results' }]
				}
			},
			userId: 99
		});
		expect(ok).toBe(true);
		expect(
			creationMetaHasChallengeResultsOrganizerRef({
				challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'results' }]
			})
		).toBe(true);
		expect(
			creationMetaHasChallengeResultsOrganizerRef({
				challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'hero' }]
			})
		).toBe(false);
	});

	test('denies when meta has no results role', async () => {
		const ok = await canViewUnpublishedChallengeResultsCreation({
			image: {
				id: 5001,
				published: 0,
				unavailable_at: null,
				meta: {
					challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'hero' }]
				}
			},
			userId: 99
		});
		// Without SB / challenges thread, hero-only meta must not grant results access.
		expect(ok).toBe(false);
	});
});

describe('requireCreatedImageAccess with challenge results after pin expiry', () => {
	const expiredPin = {
		id: 'challenge-open-weekly-1',
		created_image_id: 5001,
		enabled: true,
		until: '2020-01-01T00:00:00.000Z',
		surfaces: ['all']
	};

	const resultsImage = {
		id: 5001,
		user_id: 42,
		published: 0,
		unavailable_at: null,
		meta: {
			challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'results' }]
		}
	};

	function queriesWithExpiredPinAndResults() {
		return {
			selectPolicyByKey: {
				get: async (key) => {
					if (key !== FEED_EDITORIAL_PINS_POLICY_KEY) return null;
					return {
						value: JSON.stringify({
							defaults: {},
							pins: [expiredPin]
						})
					};
				}
			},
			selectCreatedImageById: {
				get: async () => null
			},
			selectCreatedImageByIdAnyUser: {
				get: async (imageId) => (Number(imageId) === 5001 ? resultsImage : null)
			}
		};
	}

	test('likes allow unpublished results creation after pin expires', async () => {
		const image = await requireLikeAccess({
			queries: queriesWithExpiredPinAndResults(),
			imageId: 5001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeTruthy();
		expect(image.id).toBe(5001);
	});

	test('comments allow unpublished results creation after pin expires', async () => {
		const image = await requireCommentAccess({
			queries: queriesWithExpiredPinAndResults(),
			imageId: 5001,
			userId: 99,
			userRole: 'consumer'
		});
		expect(image).toBeTruthy();
		expect(image.id).toBe(5001);
	});
});
