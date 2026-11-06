import { describe, expect, test } from '@jest/globals';
import {
	upsertChallengeOrganizerRefInMeta,
	removeChallengeOrganizerRefFromMeta,
	creationMetaHasChallengeOrganizerRef,
	creationMetaHasChallengeResultsOrganizerRef,
	challengeOrganizerRefRoleLabel
} from '../src/shared/challengeOrganizerRefMeta.js';
import { creationMetaHasChallengeAnnotation } from '../src/shared/challengeSubmitMeta.js';
import { parseCreationIdFromChallengeHeroRef } from '../api_routes/utils/challengeSubmitShared.js';

describe('challenge organizer ref meta', () => {
	test('stamps and clears hero role', () => {
		let meta = upsertChallengeOrganizerRefInMeta({}, { challenge_id: 'weekly-1', role: 'hero' });
		expect(creationMetaHasChallengeOrganizerRef(meta)).toBe(true);
		expect(creationMetaHasChallengeAnnotation(meta)).toBe(true);
		expect(challengeOrganizerRefRoleLabel('hero')).toBe('Challenge hero');
		meta = removeChallengeOrganizerRefFromMeta(meta, { challenge_id: 'weekly-1', role: 'hero' });
		expect(creationMetaHasChallengeOrganizerRef(meta)).toBe(false);
	});

	test('detects results organizer ref for lasting view access', () => {
		const meta = upsertChallengeOrganizerRefInMeta({}, { challenge_id: 'weekly-1', role: 'results' });
		expect(creationMetaHasChallengeResultsOrganizerRef(meta)).toBe(true);
		expect(challengeOrganizerRefRoleLabel('results')).toBe('Challenge results');
	});

	test('stamps challenge title/details on organizer refs', () => {
		const meta = upsertChallengeOrganizerRefInMeta(
			{},
			{ challenge_id: 'weekly-1', role: 'hero', title: 'Summer', details: 'Beach vibes' }
		);
		expect(meta.challenge_organizer_refs[0].title).toBe('Summer');
		expect(meta.challenge_organizer_refs[0].details).toBe('Beach vibes');
		const cleared = removeChallengeOrganizerRefFromMeta(meta, {
			challenge_id: 'weekly-1',
			role: 'hero'
		});
		expect(creationMetaHasChallengeOrganizerRef(cleared)).toBe(false);
	});

	test('parses creation ids from hero-style refs', () => {
		expect(parseCreationIdFromChallengeHeroRef('/creations/12234')).toBe(12234);
		expect(parseCreationIdFromChallengeHeroRef('https://www.parascene.com/creations/42')).toBe(42);
	});
});
