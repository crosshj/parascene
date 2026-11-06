import { describe, expect, test } from '@jest/globals';
import {
	parseCreditsAmount,
	normalizePrizesBlock,
	resolveChallengePrizes,
	defaultPrizeStructureForTrack,
	findLatestSameTrackConfigByStart,
	resolveCreatePrizePrefills,
	challengePrizesParticipationEnabled,
	challengeConfigHasPrizesBlock,
	formatCreditsLabel,
	totalPrizeCredits,
	readPrizesFromFormData,
	DEFAULT_PARTICIPATION_AMOUNTS
} from '../src/chat/challenges/model/prizes.js';

describe('parseCreditsAmount', () => {
	test('parses bare numbers and reward copy', () => {
		expect(parseCreditsAmount(400)).toBe(400);
		expect(parseCreditsAmount('400')).toBe(400);
		expect(parseCreditsAmount('1,200 credits')).toBe(1200);
		expect(parseCreditsAmount(' 700 credits ')).toBe(700);
		expect(parseCreditsAmount('')).toBe(null);
		expect(parseCreditsAmount('no digits')).toBe(null);
	});
});

describe('normalizePrizesBlock / resolveChallengePrizes', () => {
	test('normalizes nested prizes and defaults participation', () => {
		const prizes = normalizePrizesBlock({
			main: { first: 100, second: '50', third: null },
			top_submitters: { enabled: false, amounts: [10, 5] },
			top_voters: { amounts: [9, 8, 7] }
		});
		expect(prizes.main).toEqual({ first: 100, second: 50, third: 0 });
		expect(prizes.top_submitters.enabled).toBe(false);
		expect(prizes.top_submitters.amounts[0]).toBe(10);
		expect(prizes.top_voters.enabled).toBe(true);
		expect(prizes.top_voters.amounts).toEqual([9, 8, 7]);
	});

	test('missing prizes block falls back to track presets (post-migration model)', () => {
		const prizes = resolveChallengePrizes(
			{ track: 'weekly', reward_first: '999 credits' },
			{ track: 'weekly' }
		);
		expect(prizes.main).toEqual({ first: 400, second: 200, third: 100 });
		expect(prizes.top_submitters.enabled).toBe(true);
		expect(prizes.top_submitters.amounts).toEqual([...DEFAULT_PARTICIPATION_AMOUNTS]);
	});

	test('prizes block is the source of truth', () => {
		const prizes = resolveChallengePrizes({
			track: 'monthly',
			prizes: {
				main: { first: 1200, second: 700, third: 500 },
				top_submitters: { enabled: true, amounts: [50, 30, 20] },
				top_voters: { enabled: false, amounts: [1, 2, 3] }
			}
		});
		expect(prizes.main.first).toBe(1200);
		expect(prizes.top_voters.enabled).toBe(false);
	});
});

describe('defaultPrizeStructureForTrack', () => {
	test('weekly preset has main + participation defaults', () => {
		const prizes = defaultPrizeStructureForTrack('weekly');
		expect(prizes.main).toEqual({ first: 400, second: 200, third: 100 });
		expect(prizes.top_submitters.enabled).toBe(true);
		expect(prizes.top_voters.amounts).toEqual([50, 30, 20]);
	});
});

describe('findLatestSameTrackConfigByStart / resolveCreatePrizePrefills', () => {
	test('picks same-track config with latest submission_start_at', () => {
		const summaries = [
			{
				challenge_id: 'old',
				merged: {
					track: 'weekly',
					submission_start_at: '2026-07-01T12:00:00.000Z',
					reward_first: '100 credits',
					prizes: {
						main: { first: 100, second: 50, third: 25 },
						top_submitters: { enabled: false, amounts: [1, 1, 1] },
						top_voters: { enabled: false, amounts: [1, 1, 1] }
					}
				}
			},
			{
				challenge_id: 'newer',
				merged: {
					track: 'weekly',
					submission_start_at: '2026-07-20T12:00:00.000Z',
					reward_first: '450 credits',
					reward_second: '250 credits',
					reward_third: '150 credits',
					prizes: {
						main: { first: 450, second: 250, third: 150 },
						top_submitters: { enabled: true, amounts: [40, 20, 10] },
						top_voters: { enabled: true, amounts: [30, 20, 10] }
					}
				}
			},
			{
				challenge_id: 'other-track',
				merged: {
					track: 'monthly',
					submission_start_at: '2026-08-01T12:00:00.000Z',
					prizes: {
						main: { first: 999, second: 1, third: 1 },
						top_submitters: { enabled: true, amounts: [9, 9, 9] },
						top_voters: { enabled: true, amounts: [9, 9, 9] }
					}
				}
			}
		];
		const latest = findLatestSameTrackConfigByStart(summaries, 'weekly');
		expect(latest?.challenge_id || latest?.reward_first).toBeTruthy();
		expect(latest.reward_first).toBe('450 credits');

		const prefills = resolveCreatePrizePrefills('weekly', summaries);
		expect(prefills.prizeStructure.main.first).toBe(450);
		expect(prefills.prizeStructure.top_submitters.amounts).toEqual([40, 20, 10]);
	});

	test('falls back to track presets when no same-track history', () => {
		const prefills = resolveCreatePrizePrefills('suno', []);
		expect(prefills.rewardFields.reward_custom).toBe('');
		expect(prefills.prizeStructure.main.first).toBe(400);
		expect(prefills.prizeStructure.top_voters.enabled).toBe(true);
	});

	test('inherits custom free text from previous same-track challenge', () => {
		const summaries = [
			{
				challenge_id: 'prev',
				merged: {
					track: 'weekly',
					submission_start_at: '2026-07-20T12:00:00.000Z',
					reward_custom: 'Sponsor sticker pack',
					prizes: {
						main: { first: 400, second: 200, third: 100 },
						top_submitters: { enabled: true, amounts: [50, 30, 20] },
						top_voters: { enabled: true, amounts: [50, 30, 20] }
					}
				}
			}
		];
		const prefills = resolveCreatePrizePrefills('weekly', summaries);
		expect(prefills.rewardFields.reward_custom).toBe('Sponsor sticker pack');
	});

	test('skips soft-deleted configs', () => {
		const summaries = [
			{
				challenge_id: 'gone',
				merged: {
					track: 'weekly',
					submission_start_at: '2026-07-25T12:00:00.000Z',
					deleted_at: '2026-07-26T12:00:00.000Z',
					reward_first: '999 credits',
					prizes: {
						main: { first: 999, second: 1, third: 1 },
						top_submitters: { enabled: true, amounts: [9, 9, 9] },
						top_voters: { enabled: true, amounts: [9, 9, 9] }
					}
				}
			}
		];
		expect(findLatestSameTrackConfigByStart(summaries, 'weekly')).toBe(null);
		const prefills = resolveCreatePrizePrefills('weekly', summaries);
		expect(prefills.prizeStructure.main.first).toBe(400);
	});
});

describe('challengePrizesParticipationEnabled / readPrizesFromFormData', () => {
	test('participation enabled when either category is on', () => {
		expect(
			challengePrizesParticipationEnabled({
				main: { first: 1, second: 0, third: 0 },
				top_submitters: { enabled: false, amounts: [0, 0, 0] },
				top_voters: { enabled: true, amounts: [1, 1, 1] }
			})
		).toBe(true);
		expect(
			challengePrizesParticipationEnabled({
				main: { first: 1, second: 0, third: 0 },
				top_submitters: { enabled: false, amounts: [0, 0, 0] },
				top_voters: { enabled: false, amounts: [1, 1, 1] }
			})
		).toBe(false);
	});

	test('formatCreditsLabel / totalPrizeCredits / hasPrizesBlock', () => {
		expect(formatCreditsLabel(400)).toBe('400 credits');
		expect(formatCreditsLabel(-5)).toBe('0 credits');
		expect(challengeConfigHasPrizesBlock({ prizes: { main: {} } })).toBe(true);
		expect(challengeConfigHasPrizesBlock({ reward_first: '400 credits' })).toBe(false);
		// participation amounts are hidden until results, so they never count
		// toward the advertised total
		expect(
			totalPrizeCredits({
				main: { first: 400, second: 200, third: 100 },
				top_submitters: { enabled: true, amounts: [50, 30, 20] },
				top_voters: { enabled: true, amounts: [50, 30, 20] }
			})
		).toBe(700);
		expect(
			totalPrizeCredits({
				main: { first: 0, second: 0, third: 0 },
				top_submitters: { enabled: true, amounts: [50, 30, 20] },
				top_voters: { enabled: false, amounts: [0, 0, 0] }
			})
		).toBe(null);
	});

	test('reads FormData field names', () => {
		const fd = new FormData();
		fd.set('prize_main_first', '1200');
		fd.set('prize_main_second', '700');
		fd.set('prize_main_third', '500');
		fd.set('prize_top_submitters_enabled', '1');
		fd.set('prize_top_submitters_0', '50');
		fd.set('prize_top_submitters_1', '30');
		fd.set('prize_top_submitters_2', '20');
		fd.set('prize_top_voters_0', '40');
		fd.set('prize_top_voters_1', '20');
		fd.set('prize_top_voters_2', '10');
		const prizes = readPrizesFromFormData(fd);
		expect(prizes.main).toEqual({ first: 1200, second: 700, third: 500 });
		expect(prizes.top_submitters.enabled).toBe(true);
		expect(prizes.top_voters.enabled).toBe(false);
		expect(prizes.top_voters.amounts).toEqual([40, 20, 10]);
	});
});
