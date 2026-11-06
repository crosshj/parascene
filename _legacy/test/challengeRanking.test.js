import { describe, expect, test } from '@jest/globals';
import {
	WEIGHTED_RATING_MIN_VOTES,
	normalizeExcludedUserNames,
	collectChallengeVoteStats,
	statsRowVoteNumbers,
	weightedRatingForStatsRow,
	rankStatsTopCreations,
	rankTopVoters,
	rankTopSubmitters,
	defaultWinnersFromRanked
} from '../src/chat/challenges/model/ranking.js';

// Reaction weights: thumbsUp=1, thumbsDown=2, heart=3, joy=4, grin=5, openMouth=6…
const submission = (id, senderId, challengeId, creationId, reactions = {}) => ({
	id,
	sender_id: senderId,
	created_at: `2026-07-0${(id % 9) + 1}T00:00:00.000Z`,
	reactions,
	body: JSON.stringify({
		kind: 'challenge_submission',
		challenge_id: challengeId,
		created_image_id: creationId
	})
});

describe('normalizeExcludedUserNames', () => {
	test('splits csv, strips @, lowercases, dedupes', () => {
		expect(normalizeExcludedUserNames('@OceanMan, alice ,, alice, @Bob')).toEqual([
			'oceanman',
			'alice',
			'bob'
		]);
		expect(normalizeExcludedUserNames(['@X', 'x', 'Y'])).toEqual(['x', 'y']);
		expect(normalizeExcludedUserNames('')).toEqual([]);
	});
});

describe('collectChallengeVoteStats', () => {
	test('aggregates entries, per-user votes/submissions, thread-wide global average', () => {
		const messages = [
			// target challenge: two 3-point votes (heart)
			submission(1, 10, 'c1', 101, { heart: [201, 202] }),
			// same challenge, second entry from same sender: one 5-point vote
			submission(2, 10, 'c1', 102, { grin: [201] }),
			// other challenge in thread: one 1-point vote — counts toward globalAverage only
			submission(3, 11, 'c2', 103, { thumbsUp: [203] }),
			// non-submission noise ignored entirely
			{ id: 4, sender_id: 12, body: 'hello', reactions: { heart: [1, 2, 3] } }
		];
		const stats = collectChallengeVoteStats(messages, 'c1');
		expect(stats.entries).toHaveLength(2);
		expect(stats.entries[0]).toMatchObject({
			messageId: 1,
			senderId: 10,
			creationId: 101,
			voteValue: 6,
			voteCount: 2
		});
		expect(stats.entries[1]).toMatchObject({ messageId: 2, voteValue: 5, voteCount: 1 });
		expect(stats.submissionsPerSenderId.get(10)).toBe(2);
		expect(stats.votesPerUserId.get(201)).toBe(2);
		expect(stats.votesPerUserId.get(203)).toBeUndefined();
		// global: (3+3+5+1) / 4 across the whole thread
		expect(stats.globalAverage).toBeCloseTo(3);
	});
});

describe('weightedRatingForStatsRow', () => {
	test('matches the Bayesian formula used by the stats modal', () => {
		const row = { voteValue: 40, voteCount: 10 }; // avg 4
		const g = 3;
		const expected =
			(10 * 4 + WEIGHTED_RATING_MIN_VOTES * g) / (10 + WEIGHTED_RATING_MIN_VOTES);
		expect(weightedRatingForStatsRow(row, g)).toBeCloseTo(expected);
	});

	test('zero votes falls back to the global average', () => {
		expect(weightedRatingForStatsRow({ voteValue: 0, voteCount: 0 }, 2.5)).toBeCloseTo(2.5);
	});
});

describe('rankStatsTopCreations', () => {
	const rows = [
		{ messageId: 1, creationId: 11, voteValue: 40, voteCount: 10, creatorUserName: 'alice' }, // avg 4
		{ messageId: 2, creationId: 12, voteValue: 10, voteCount: 2, creatorUserName: 'bob' }, // avg 5
		{ messageId: 3, creationId: 13, voteValue: 20, voteCount: 5, creatorUserName: 'carol' } // avg 4
	];

	test('weighted mode favors vote volume over raw average', () => {
		const ranked = rankStatsTopCreations(rows, { sortMode: 'weighted', globalAverage: 3 });
		// alice: (10*4+15*3)/25 = 3.4; bob: (2*5+45)/17 ≈ 3.235; carol: (5*4+45)/20 = 3.25
		expect(ranked.map((r) => r.messageId)).toEqual([1, 3, 2]);
		expect(ranked[0].weightedRating).toBeGreaterThan(ranked[1].weightedRating);
	});

	test('average mode ranks by plain average, tie broken by vote count', () => {
		const ranked = rankStatsTopCreations(rows, { sortMode: 'average', globalAverage: 3 });
		// bob avg 5 first; alice/carol tie at 4 → alice has more votes
		expect(ranked.map((r) => r.messageId)).toEqual([2, 1, 3]);
	});

	test('average tie on votes and count falls back to message id asc', () => {
		const tied = [
			{ messageId: 9, voteValue: 8, voteCount: 2 },
			{ messageId: 4, voteValue: 8, voteCount: 2 }
		];
		const ranked = rankStatsTopCreations(tied, { sortMode: 'average' });
		expect(ranked.map((r) => r.messageId)).toEqual([4, 9]);
	});

	test('excluded creators are removed', () => {
		const ranked = rankStatsTopCreations(rows, {
			sortMode: 'weighted',
			globalAverage: 3,
			excludedUserNames: '@Alice'
		});
		expect(ranked.map((r) => r.creatorUserName)).toEqual(['carol', 'bob']);
	});
});

describe('rankTopVoters / rankTopSubmitters', () => {
	test('count desc then user id asc, exclusions applied', () => {
		const voters = [
			{ userId: 5, voteCount: 3, userName: 'eve' },
			{ userId: 2, voteCount: 7, userName: 'bob' },
			{ userId: 9, voteCount: 3, userName: 'nia' }
		];
		expect(rankTopVoters(voters).map((r) => r.userId)).toEqual([2, 5, 9]);
		expect(
			rankTopVoters(voters, { excludedUserNames: 'bob' }).map((r) => r.userId)
		).toEqual([5, 9]);

		const submitters = [
			{ userId: 3, submissionCount: 1, userName: 'a' },
			{ userId: 1, submissionCount: 4, userName: 'b' }
		];
		expect(rankTopSubmitters(submitters).map((r) => r.userId)).toEqual([1, 3]);
	});
});

describe('defaultWinnersFromRanked', () => {
	test('one place per creator even when a creator holds two top entries', () => {
		const ranked = [
			{ messageId: 1, creationId: 11, creatorUserId: 10 },
			{ messageId: 2, creationId: 12, creatorUserId: 10 },
			{ messageId: 3, creationId: 13, creatorUserId: 20 },
			{ messageId: 4, creationId: 14, creatorUserId: 30 }
		];
		const winners = defaultWinnersFromRanked(ranked, 3);
		expect(winners).toEqual([
			{ place: 1, messageId: 1, creationId: 11, userId: 10 },
			{ place: 2, messageId: 3, creationId: 13, userId: 20 },
			{ place: 3, messageId: 4, creationId: 14, userId: 30 }
		]);
	});

	test('returns fewer winners when the pool is small', () => {
		expect(defaultWinnersFromRanked([{ messageId: 1, creationId: 2, creatorUserId: 3 }], 3)).toHaveLength(1);
	});
});

describe('statsRowVoteNumbers', () => {
	test('clamps negatives and handles zero counts', () => {
		expect(statsRowVoteNumbers({ voteValue: -4, voteCount: 0 })).toEqual({
			voteValue: 0,
			voteCount: 0,
			averageVote: 0
		});
	});
});
