import { describe, expect, test } from '@jest/globals';
import { feedBetaPoolTakesForPage } from '../api_routes/feedBeta/pools.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';

describe('feedBetaPoolTakesForPage', () => {
	test('page 1 uses default pool slot counts', () => {
		expect(feedBetaPoolTakesForPage(1, FEED_BETA_DEFAULT_PARAMS)).toEqual({
			hot24Take: 5,
			hot7Take: 4,
			newTake: 4,
			newcomerTake: 4,
			catalogTake: 7,
			recentCommentTake: 2,
			ownActivityTake: 1,
			followTake: 2
		});
	});

	test('page 2+ shifts slots toward new and catalog exploration', () => {
		expect(feedBetaPoolTakesForPage(2, FEED_BETA_DEFAULT_PARAMS)).toEqual({
			hot24Take: 4,
			hot7Take: 3,
			newTake: 6,
			newcomerTake: 4,
			catalogTake: 6,
			recentCommentTake: 1,
			ownActivityTake: 0,
			followTake: 2
		});
	});
});
