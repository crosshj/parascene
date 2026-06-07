import { deriveChallengePhase } from '../src/chat/challenges/model/phases.js';
import {
	ACTIVE_PARTICIPANT_PHASES,
	pickLatestConfig,
	pickParticipantFocusConfig
} from '../src/chat/challenges/model/participantSlice.js';

const nowMs = Date.parse('2026-06-06T12:00:00.000Z');

describe('pickParticipantFocusConfig', () => {
	test('prefers an active challenge over a more recently edited ended one', () => {
		const configs = [
			{
				msg: { id: 10, created_at: '2026-05-01T00:00:00.000Z' },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-05-is-it-cake',
					title: 'Is It Cake?',
					submission_start_at: '2026-05-01T00:00:00.000Z',
					submission_end_at: '2026-06-01T23:59:00.000Z',
					voting_start_at: '2026-05-01T00:00:00.000Z',
					voting_end_at: '2026-06-01T23:59:00.000Z',
					results_published_at: '2026-06-02T00:00:00.000Z',
					results_creation_url: '/creations/12787'
				}
			},
			{
				msg: { id: 99, created_at: '2026-06-06T10:00:00.000Z' },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-05-is-it-cake',
					title: 'Is It Cake?',
					results_creation_url: '/creations/12787',
					results_published_at: '2026-06-02T00:00:00.000Z'
				}
			},
			{
				msg: { id: 20, created_at: '2026-06-01T00:00:00.000Z' },
				payload: {
					kind: 'challenge_config',
					challenge_id: '2026-06-automotive-locomotion',
					title: 'Automotive Locomotion',
					submission_start_at: '2026-06-06T00:00:00.000Z',
					submission_end_at: '2026-06-28T00:00:00.000Z',
					voting_start_at: '2026-06-06T00:00:00.000Z',
					voting_end_at: '2026-06-28T00:00:00.000Z'
				}
			}
		];

		const latestByMessage = pickLatestConfig(configs);
		expect(latestByMessage.latestConfig?.challenge_id).toBe('2026-05-is-it-cake');

		const focus = pickParticipantFocusConfig(configs, nowMs);
		expect(focus.latestConfig?.challenge_id).toBe('2026-06-automotive-locomotion');
		expect(focus.latestConfig?.title).toBe('Automotive Locomotion');
		const phase = deriveChallengePhase(focus.latestConfig, nowMs);
		expect(ACTIVE_PARTICIPANT_PHASES.has(phase)).toBe(true);
	});
});
