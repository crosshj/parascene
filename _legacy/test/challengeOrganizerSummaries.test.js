import { describe, expect, test } from '@jest/globals';
import { summarizeLatestChallengeConfigs } from '../src/chat/challenges/model/organizerSummaries.js';

describe('summarizeLatestChallengeConfigs', () => {
	test('keeps last non-empty title across partial later patches', () => {
		const configs = [
			{
				msg: { id: 1 },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-08-16-weekly-1782787a',
					title: 'Week of 2026-08-02'
				}
			},
			{
				msg: { id: 2 },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-08-16-weekly-1782787a',
					hero_image_url: '/creations/20572'
				}
			},
			{
				msg: { id: 3 },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-08-16-weekly-1782787a',
					hero_image_url: ''
				}
			}
		];
		const rows = summarizeLatestChallengeConfigs(configs);
		expect(rows).toHaveLength(1);
		expect(rows[0].challenge_id).toBe('2026-08-16-weekly-1782787a');
		expect(rows[0].title).toBe('Week of 2026-08-02');
		expect(rows[0].configMessageId).toBe(3);
		expect(rows[0].payload.hero_image_url).toBe('');
	});

	test('later non-empty title replaces earlier title', () => {
		const configs = [
			{
				msg: { id: 10 },
				payload: {
					kind: 'challenge_config',
					challenge_id: 'c1',
					title: 'Old'
				}
			},
			{
				msg: { id: 11 },
				payload: {
					kind: 'challenge_config',
					challenge_id: 'c1',
					title: 'New'
				}
			}
		];
		const rows = summarizeLatestChallengeConfigs(configs);
		expect(rows[0].title).toBe('New');
	});
});
