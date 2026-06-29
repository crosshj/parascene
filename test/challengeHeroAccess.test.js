import {
	parseCreationIdFromChallengeHeroRef,
	pickLatestChallengeConfigForChallengeId,
	pickChallengeConfigAcceptingSubmissions,
	latestChallengeConfigByChallengeId
} from '../api_routes/utils/challengeSubmitShared.js';

describe('parseCreationIdFromChallengeHeroRef', () => {
	test('parses bare creation paths', () => {
		expect(parseCreationIdFromChallengeHeroRef('/creations/12234')).toBe(12234);
		expect(parseCreationIdFromChallengeHeroRef('/creations/12234/')).toBe(12234);
	});

	test('parses API paths and full URLs', () => {
		expect(parseCreationIdFromChallengeHeroRef('/api/create/images/99')).toBe(99);
		expect(parseCreationIdFromChallengeHeroRef('https://www.parascene.com/creations/42')).toBe(42);
	});

	test('returns NaN for non-creation refs', () => {
		expect(parseCreationIdFromChallengeHeroRef('https://example.com/image.png')).toBeNaN();
		expect(parseCreationIdFromChallengeHeroRef('')).toBeNaN();
	});
});

describe('pickLatestChallengeConfigForChallengeId', () => {
	test('returns latest config for challenge id (newest-first input)', () => {
		const messages = [
			{
				created_at: '2026-02-01T00:00:00Z',
				body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'a', hero_image_url: '/creations/2' })
			},
			{
				created_at: '2026-01-01T00:00:00Z',
				body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'a', hero_image_url: '/creations/1' })
			},
			{
				created_at: '2026-03-01T00:00:00Z',
				body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'b', hero_image_url: '/creations/3' })
			}
		];
		const cfg = pickLatestChallengeConfigForChallengeId(messages, 'a');
		expect(cfg?.hero_image_url).toBe('/creations/2');
	});

	test('latestChallengeConfigByChallengeId keeps newest per challenge', () => {
		const messages = [
			{
				created_at: '2026-02-01T00:00:00Z',
				body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'x', hero_image_url: '/creations/2' })
			},
			{
				created_at: '2026-01-01T00:00:00Z',
				body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'x', hero_image_url: '/creations/1' })
			}
		];
		const map = latestChallengeConfigByChallengeId(messages);
		expect(map.get('x')?.payload?.hero_image_url).toBe('/creations/2');
	});
});

describe('pickChallengeConfigAcceptingSubmissions', () => {
	test('prefers active challenge over newer ended-cycle config updates', () => {
		const messages = [
			{
				created_at: '2026-06-27T20:21:59Z',
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: '2026-06-automotive-locomotion',
					submission_start_at: '2026-06-06T04:00:00.000Z',
					submission_end_at: '2026-06-27T19:00:00.000Z',
					voting_start_at: '2026-06-06T04:00:00.000Z',
					voting_end_at: '2026-06-27T19:00:00.000Z',
					results_published_at: '2026-06-27T20:06:56.757Z'
				})
			},
			{
				created_at: '2026-06-27T14:46:25Z',
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: '2026-07-monsters-vs-aliens',
					title: 'Monsters VS Aliens',
					submission_start_at: '2026-06-29T04:00:00.000Z',
					submission_end_at: '2026-08-01T03:59:00.000Z',
					voting_start_at: '2026-06-29T04:00:00.000Z',
					voting_end_at: '2026-08-01T03:59:00.000Z'
				})
			}
		];
		const cfg = pickChallengeConfigAcceptingSubmissions(messages, Date.parse('2026-06-29T12:00:00Z'));
		expect(cfg?.challenge_id).toBe('2026-07-monsters-vs-aliens');
	});

	test('returns null when no challenge accepts submissions', () => {
		const messages = [
			{
				created_at: '2026-06-27T20:21:59Z',
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: '2026-06-automotive-locomotion',
					submission_start_at: '2026-06-06T04:00:00.000Z',
					submission_end_at: '2026-06-27T19:00:00.000Z',
					voting_start_at: '2026-06-06T04:00:00.000Z',
					voting_end_at: '2026-06-27T19:00:00.000Z',
					results_published_at: '2026-06-27T20:06:56.757Z'
				})
			}
		];
		const cfg = pickChallengeConfigAcceptingSubmissions(messages, Date.parse('2026-06-29T12:00:00Z'));
		expect(cfg).toBeNull();
	});
});
