import {
	parseCreationIdFromChallengeHeroRef,
	pickLatestChallengeConfigForChallengeId,
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
