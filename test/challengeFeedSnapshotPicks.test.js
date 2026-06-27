import { describe, expect, test } from '@jest/globals';
import { pickChallengeHeroImageUrl } from '../src/chat/challenges/challengeAdmin.js';
import {
	pickChallengeFeedNextSummary,
	pickChallengeFeedPreviousSummary,
	pickFeedFocusChallengeSummary
} from '../api_routes/feed/challengeFeedSnapshotShared.js';

function configEntry(id, payload) {
	return {
		msg: { id },
		payload: {
			kind: 'challenge_config',
			...payload
		}
	};
}

describe('pickChallengeHeroImageUrl', () => {
	test('reads alternate hero field names', () => {
		expect(pickChallengeHeroImageUrl({ hero_image: '/creations/9' })).toBe('/creations/9');
		expect(pickChallengeHeroImageUrl({ hero_ref: '/creations/10' })).toBe('/creations/10');
	});
});

describe('pickFeedFocusChallengeSummary', () => {
	test('prefers upcoming pre_submit over a recently edited older challenge', () => {
		const nowMs = Date.parse('2026-06-27T12:00:00.000Z');
		const entries = [
			configEntry(99, {
				challenge_id: '2026-05-is-it-cake',
				title: 'Is It Cake?',
				results_creation_url: '/creations/12787',
				results_published_at: '2026-06-02T00:00:00.000Z'
			}),
			configEntry(30, {
				challenge_id: 'monsters-vs-aliens',
				title: 'Monsters VS Aliens',
				submission_start_at: '2026-06-29T12:00:00.000Z',
				voting_end_at: '2026-07-31T23:59:00.000Z'
			}),
			configEntry(25, {
				challenge_id: '2026-06-automotive-locomotion',
				title: 'Automotive Locomotion',
				submission_start_at: '2026-06-06T00:00:00.000Z',
				voting_end_at: '2026-06-28T00:00:00.000Z'
			})
		];

		const focus = pickFeedFocusChallengeSummary(entries, nowMs);
		expect(focus?.challenge_id).toBe('monsters-vs-aliens');
	});
});

describe('pickChallengeFeedPreviousSummary', () => {
	test('prefers the latest round by voting_end over an older published challenge', () => {
		const nowMs = Date.parse('2026-06-27T12:00:00.000Z');
		const entries = [
			configEntry(30, {
				challenge_id: 'monsters-vs-aliens',
				title: 'Monsters VS Aliens',
				submission_start_at: '2026-06-29T12:00:00.000Z',
				voting_end_at: '2026-07-10T12:00:00.000Z'
			}),
			configEntry(25, {
				challenge_id: '2026-06-automotive-locomotion',
				title: 'Automotive Locomotion',
				submission_start_at: '2026-06-06T00:00:00.000Z',
				submission_end_at: '2026-06-27T23:59:00.000Z',
				voting_end_at: '2026-06-28T00:00:00.000Z'
			}),
			configEntry(99, {
				challenge_id: '2026-05-is-it-cake',
				title: 'Is It Cake?',
				submission_start_at: '2026-05-01T12:00:00.000Z',
				voting_end_at: '2026-06-01T23:59:00.000Z',
				results_published_at: '2026-06-02T00:00:00.000Z'
			})
		];

		const prev = pickChallengeFeedPreviousSummary(entries, nowMs, 'monsters-vs-aliens');
		expect(prev?.challenge_id).toBe('2026-06-automotive-locomotion');
		expect(prev?.effectivePayload?.title).toBe('Automotive Locomotion');
	});

	test('includes a still-open previous round when it is the latest non-upcoming challenge', () => {
		const nowMs = Date.parse('2026-06-27T12:00:00.000Z');
		const entries = [
			configEntry(30, {
				challenge_id: 'monsters-vs-aliens',
				title: 'Monsters VS Aliens',
				submission_start_at: '2026-06-29T12:00:00.000Z',
				voting_end_at: '2026-07-10T12:00:00.000Z'
			}),
			configEntry(25, {
				challenge_id: '2026-06-automotive-locomotion',
				title: 'Automotive Locomotion',
				submission_start_at: '2026-06-06T00:00:00.000Z',
				submission_end_at: '2026-06-28T00:00:00.000Z',
				voting_start_at: '2026-06-06T00:00:00.000Z',
				voting_end_at: '2026-06-28T00:00:00.000Z'
			}),
			configEntry(10, {
				challenge_id: '2026-05-is-it-cake',
				title: 'Is It Cake?',
				submission_start_at: '2026-05-01T12:00:00.000Z',
				voting_end_at: '2026-06-01T23:59:00.000Z',
				results_published_at: '2026-06-02T00:00:00.000Z'
			})
		];

		const prev = pickChallengeFeedPreviousSummary(entries, nowMs, 'monsters-vs-aliens');
		expect(prev?.challenge_id).toBe('2026-06-automotive-locomotion');
	});
});

describe('pickChallengeFeedNextSummary', () => {
	test('merges hero ref from earlier config patches', () => {
		const nowMs = Date.parse('2026-06-27T12:00:00.000Z');
		const entries = [
			configEntry(10, {
				challenge_id: 'monsters-vs-aliens',
				title: 'Monsters VS Aliens',
				hero_image_url: '/creations/555'
			}),
			configEntry(20, {
				challenge_id: 'monsters-vs-aliens',
				title: 'Monsters VS Aliens',
				submission_start_at: '2026-06-29T12:00:00.000Z',
				voting_end_at: '2026-07-10T12:00:00.000Z'
			}),
			configEntry(25, {
				challenge_id: '2026-06-automotive-locomotion',
				title: 'Automotive Locomotion',
				voting_end_at: '2026-06-28T00:00:00.000Z'
			})
		];

		const next = pickChallengeFeedNextSummary(entries, nowMs, '2026-06-automotive-locomotion');
		expect(next?.challenge_id).toBe('monsters-vs-aliens');
		expect(pickChallengeHeroImageUrl(next?.effectivePayload)).toBe('/creations/555');
	});
});
