import { describe, expect, test } from '@jest/globals';
import {
	applyChallengeViewerOverlay,
	viewerHasChallengeScoreReaction
} from '../api_routes/feed/challengeFeedSnapshotShared.js';

describe('challengeFeedSnapshotShared', () => {
	test('viewerHasChallengeScoreReaction detects score keys', () => {
		expect(
			viewerHasChallengeScoreReaction({ thumbsUp: [42, 7] }, 42)
		).toBe(true);
		expect(viewerHasChallengeScoreReaction({ thumbsUp: [7] }, 42)).toBe(false);
	});

	test('applyChallengeViewerOverlay adds viewer fields from cached submissions', () => {
		const shared = {
			version: 1,
			ok: true,
			active: true,
			challengeId: 'c1',
			title: 'Test',
			cfg: {
				kind: 'challenge_config',
				title: 'Test',
				submission_start_at: new Date(Date.now() - 3600000).toISOString(),
				submission_end_at: new Date(Date.now() + 86400000).toISOString(),
				voting_end_at: new Date(Date.now() + 172800000).toISOString()
			},
			submissionCount: 2,
			uniqueSubmitters: 2,
			topPrize: '100 credits',
			submissionStartAt: '',
			latestSubmissionMs: Date.now(),
			recentSubmissionCount24h: 2,
			heroImageUrl: '/hero.png',
			totalRewardCredits: 100,
			nextChallenge: null,
			previousChallenge: null,
			submissions: [
				{ sender_id: 9, created_at: new Date().toISOString(), reactions: {} },
				{ sender_id: 10, created_at: new Date().toISOString(), reactions: {} }
			]
		};

		const out = applyChallengeViewerOverlay(shared, 9);
		expect(out.ok).toBe(true);
		expect(out.viewerHasEntered).toBe(true);
		expect(out.hasUnvotedEntries).toBe(true);
		expect(out.phaseSubtitle).toBeTruthy();
	});
});
