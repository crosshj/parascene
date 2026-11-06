import { describe, expect, test } from '@jest/globals';
import {
	creationArchiveBlockedByChallenge,
	challengeArchiveBlockMessage,
	stripChallengeStampsFromCreationMeta,
	groupSourceCreationIdsFromMeta
} from '../src/shared/challengeSubmitMeta.js';
import { validateChallengeSubmission } from '../api_routes/utils/challengeSubmitShared.js';
import {
	dropMissingVoteSlide,
	shouldSkipVoteSlideForCreation
} from '../src/chat/challenges/voteSlideSkip.js';

describe('creationArchiveBlockedByChallenge', () => {
	test('allows a plain unpublished creation', () => {
		expect(creationArchiveBlockedByChallenge({ media_type: 'image' })).toEqual({
			blocked: false,
			kind: null
		});
		expect(challengeArchiveBlockMessage({ media_type: 'image' }, 'grouping')).toBeNull();
	});

	test('blocks challenge submissions', () => {
		const meta = {
			challenge_submissions: [{ thread_id: 100, challenge_id: '2026-08-summer' }]
		};
		expect(creationArchiveBlockedByChallenge(meta)).toEqual({
			blocked: true,
			kind: 'submission'
		});
		expect(challengeArchiveBlockMessage(meta, 'grouping')).toMatch(/before grouping/);
	});

	test('blocks organizer refs', () => {
		const meta = {
			challenge_organizer_refs: [{ challenge_id: 'weekly-1', role: 'hero' }]
		};
		expect(creationArchiveBlockedByChallenge(meta).kind).toBe('organizer');
		expect(challengeArchiveBlockMessage(meta, 'deleting')).toMatch(/before deleting/);
	});
});

describe('stripChallengeStampsFromCreationMeta', () => {
	test('drops challenge stamps when copying source meta onto a group', () => {
		const next = stripChallengeStampsFromCreationMeta({
			media_type: 'image',
			user_prompt: 'keep me',
			challenge_submissions: [{ challenge_id: 'x' }],
			challenge_feed_pins: [{ pin_id: 'p1' }],
			challenge_organizer_refs: [{ role: 'hero' }]
		});
		expect(next.media_type).toBe('image');
		expect(next.user_prompt).toBe('keep me');
		expect(next.challenge_submissions).toBeUndefined();
		expect(next.challenge_feed_pins).toBeUndefined();
		expect(next.challenge_organizer_refs).toBeUndefined();
	});
});

describe('groupSourceCreationIdsFromMeta', () => {
	test('reads ids from group payload', () => {
		expect(
			groupSourceCreationIdsFromMeta({
				group: {
					kind: 'group_creations',
					source_creation_ids: [24495, 24487],
					source_creations: [{ id: 24361 }, { id: 24495 }]
				}
			})
		).toEqual([24495, 24487, 24361]);
	});
});

describe('validateChallengeSubmission group reject', () => {
	test('rejects group_creations before any thread lookup', async () => {
		const result = await validateChallengeSubmission({
			sb: {},
			userId: 1,
			ownerUserId: 1,
			creationId: 10,
			meta: { group: { kind: 'group_creations' } },
			threadId: 100
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe(400);
		expect(result.message).toMatch(/Group creations cannot be submitted/);
	});
});

describe('vote slide skip', () => {
	test('skips failed fetches and imageless payloads', () => {
		expect(shouldSkipVoteSlideForCreation(null)).toBe(true);
		expect(shouldSkipVoteSlideForCreation({ _error: true })).toBe(true);
		expect(shouldSkipVoteSlideForCreation({ media_type: 'image' })).toBe(true);
		expect(shouldSkipVoteSlideForCreation({ media_type: 'image', url: '/api/images/created/x.png' })).toBe(
			false
		);
		expect(shouldSkipVoteSlideForCreation({ media_type: 'audio' })).toBe(false);
	});

	test('drops a missing slide and keeps remaining order', () => {
		const slides = [{ creationId: 1 }, { creationId: 2 }, { creationId: 3 }];
		expect(dropMissingVoteSlide(slides, 0)).toEqual({
			slides: [{ creationId: 2 }, { creationId: 3 }],
			index: 0
		});
		expect(dropMissingVoteSlide(slides, 2)).toEqual({
			slides: [{ creationId: 1 }, { creationId: 2 }],
			index: 1
		});
		expect(dropMissingVoteSlide([{ creationId: 1 }], 0)).toEqual({ slides: [], index: 0 });
	});
});
