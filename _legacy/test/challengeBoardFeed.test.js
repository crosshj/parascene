import { describe, expect, test } from '@jest/globals';
import {
	buildChallengeEngagementVirtualRows,
	pickChallengeBoardHeadline,
	scoreChallengeBoardHeadline
} from '../api_routes/feed/engagementAndNewbie.js';
import { listChallengeFeedBoardSummaries } from '../api_routes/feed/challengeFeedSnapshotShared.js';

function configEntry(id, payload) {
	return {
		msg: { id, created_at: `2026-07-0${id}T00:00:00.000Z` },
		payload: {
			kind: 'challenge_config',
			...payload
		}
	};
}

describe('listChallengeFeedBoardSummaries', () => {
	test('includes concurrent active tracks plus upcoming for empty tracks', () => {
		const nowMs = Date.parse('2026-08-02T12:00:00.000Z');
		const entries = [
			configEntry(1, {
				challenge_id: 'weekly-open',
				title: 'Weekly Open',
				track: 'weekly',
				submission_start_at: '2026-07-28T00:00:00.000Z',
				submission_end_at: '2026-08-05T00:00:00.000Z',
				voting_start_at: '2026-07-28T00:00:00.000Z',
				voting_end_at: '2026-08-05T00:00:00.000Z'
			}),
			configEntry(2, {
				challenge_id: 'monthly-open',
				title: 'Monthly Open',
				track: 'monthly',
				submission_start_at: '2026-07-01T00:00:00.000Z',
				submission_end_at: '2026-08-20T00:00:00.000Z',
				voting_start_at: '2026-07-01T00:00:00.000Z',
				voting_end_at: '2026-08-20T00:00:00.000Z'
			}),
			configEntry(3, {
				challenge_id: 'music-upcoming',
				title: 'Music Upcoming',
				track: 'suno',
				listed: true,
				submission_start_at: '2026-08-10T00:00:00.000Z',
				voting_end_at: '2026-08-17T00:00:00.000Z'
			})
		];
		const board = listChallengeFeedBoardSummaries(entries, nowMs);
		expect(board.map((r) => r.challengeId)).toEqual([
			'monthly-open',
			'weekly-open',
			'music-upcoming'
		]);
	});
});

describe('challenge board headline scoring', () => {
	test('prefers ending-soon actionable over unvoted', () => {
		const nowMs = Date.parse('2026-08-02T12:00:00.000Z');
		const ending = scoreChallengeBoardHeadline(
			{
				title: 'Ends Soon',
				track: 'weekly',
				phase: 'voting',
				highlightDeadlineMs: nowMs + 24 * 60 * 60 * 1000,
				hasUnvotedEntries: true
			},
			nowMs
		);
		const unvoted = scoreChallengeBoardHeadline(
			{
				title: 'Plenty Time',
				track: 'monthly',
				phase: 'voting',
				highlightDeadlineMs: nowMs + 14 * 24 * 60 * 60 * 1000,
				hasUnvotedEntries: true
			},
			nowMs
		);
		expect(ending.priority).toBeLessThan(unvoted.priority);
	});

	test('buildChallengeEngagementVirtualRows uses legacy card for a single active challenge', () => {
		const rows = buildChallengeEngagementVirtualRows({
			ok: true,
			active: true,
			challengeId: 'weekly-open',
			title: 'Weekly Open',
			phase: 'voting',
			phaseSubtitle: 'Voting open',
			submissionCount: 4,
			uniqueSubmitters: 3,
			highlightDeadlineMs: Date.now() + 3 * 24 * 60 * 60 * 1000,
			viewerHasEntered: false,
			hasUnvotedEntries: true,
			boardRows: [
				{
					challengeId: 'weekly-open',
					title: 'Weekly Open',
					track: 'weekly',
					phase: 'voting',
					phaseSubtitle: 'Voting open',
					submissionCount: 4,
					highlightDeadlineMs: Date.now() + 3 * 24 * 60 * 60 * 1000,
					viewerHasEntered: false,
					hasUnvotedEntries: true
				}
			]
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].variant).toBe('challenge_stats');
		expect(rows[0].payload.challengeVoteLabel).toBe('Vote');
	});

	test('buildChallengeEngagementVirtualRows emits challenge_board when 2+ are active', () => {
		const rows = buildChallengeEngagementVirtualRows({
			ok: true,
			active: true,
			challengeId: 'weekly-open',
			boardRows: [
				{
					challengeId: 'weekly-open',
					title: 'Weekly Open',
					track: 'weekly',
					phase: 'voting',
					phaseSubtitle: 'Voting open',
					submissionCount: 4,
					uniqueSubmitters: 3,
					totalRewardCredits: 500,
					highlightDeadlineMs: Date.now() + 3 * 24 * 60 * 60 * 1000,
					viewerHasEntered: false,
					hasUnvotedEntries: true
				},
				{
					challengeId: 'monthly-open',
					title: 'Monthly Open',
					track: 'monthly',
					phase: 'submitting',
					phaseSubtitle: 'Submissions open',
					submissionCount: 2,
					uniqueSubmitters: 2,
					highlightDeadlineMs: Date.now() + 20 * 24 * 60 * 60 * 1000,
					viewerHasEntered: false,
					hasUnvotedEntries: false
				}
			]
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].variant).toBe('challenge_board');
		expect(rows[0].payload.tracks).toHaveLength(2);
		expect(rows[0].payload.tracks[0].challengeId).toBe('monthly-open');
		expect(rows[0].payload.tracks[0].title).toBeTruthy();
		expect(rows[0].payload.tracks[0].statusChip).toBeTruthy();
		expect(rows[0].payload.tracks[0].socialProofLine).toMatch(/entries/);
		expect(rows[0].payload.tracks[1].challengeId).toBe('weekly-open');
		expect(rows[0].payload.challengeVoteLabel).toBeUndefined();
		expect(rows[0].payload.ctaLabel).toBe('Open challenges');
		const headline = pickChallengeBoardHeadline(
			[
				{
					challengeId: 'weekly-open',
					title: 'Weekly Open',
					track: 'weekly',
					phase: 'voting',
					highlightDeadlineMs: Date.now() + 24 * 60 * 60 * 1000,
					hasUnvotedEntries: true
				}
			],
			Date.now()
		);
		expect(headline).not.toBeNull();
	});
});
