import { describe, expect, test } from '@jest/globals';
import {
	stripUserFromChallengeScoreReactions,
	isChallengeScoreReactionKey
} from '../src/chat/challenges/model/scoreReactions.js';

describe('stripUserFromChallengeScoreReactions', () => {
	test('removes user from every score key except keepKey', () => {
		const bucket = {
			thumbsUp: [1, 2],
			heart: [2, 3],
			clap: [2]
		};
		const changed = stripUserFromChallengeScoreReactions(bucket, 2, { keepKey: 'heart' });
		expect(changed).toBe(true);
		expect(bucket).toEqual({
			thumbsUp: [1],
			heart: [2, 3]
		});
	});

	test('clears all score keys for user when keepKey omitted', () => {
		const bucket = {
			thumbsUp: [7],
			joy: [7, 8],
			hundred: [9]
		};
		stripUserFromChallengeScoreReactions(bucket, 7);
		expect(bucket).toEqual({
			joy: [8],
			hundred: [9]
		});
	});

	test('no-op when user absent', () => {
		const bucket = { heart: [3, 4] };
		const changed = stripUserFromChallengeScoreReactions(bucket, 99, { keepKey: 'heart' });
		expect(changed).toBe(false);
		expect(bucket).toEqual({ heart: [3, 4] });
	});
});

describe('isChallengeScoreReactionKey', () => {
	test('recognizes reserved score keys', () => {
		expect(isChallengeScoreReactionKey('thumbsUp')).toBe(true);
		expect(isChallengeScoreReactionKey('hundred')).toBe(true);
		expect(isChallengeScoreReactionKey('fire')).toBe(false);
	});
});
