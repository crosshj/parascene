import { describe, expect, test } from '@jest/globals';
import { drawThreadPageFromCatalog } from '../api_routes/feedBeta/pools.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { feedBetaRowPool } from './helpers/feedBetaGoldenPath.js';
import { injectCatalogRow } from './helpers/feedBetaCatalogInjections.js';

const FOLLOWED_AUTHOR_ID = 9_100_951;

/**
 * Rows only from a followed author (old, low engagement) so hot/new/newcomer pools are empty
 * and follow_sprinkle is the distinguishing draw.
 */
function followedOnlyCatalog(count = 10) {
	const rows = [];
	for (let i = 0; i < count; i += 1) {
		rows.push(
			injectCatalogRow({
				createdImageId: 9_100_960 + i,
				userId: FOLLOWED_AUTHOR_ID,
				ageHours: 200 + i,
				likeCount: 0,
				commentCount: 0
			})
		);
	}
	return rows;
}

describe('follow_sprinkle pool', () => {
	test('draws follow_sprinkle when followed authors fill the catalog', () => {
		const catalog = followedOnlyCatalog(12);
		const scoreContext = {
			nowMs: Date.now(),
			followingIds: new Set([String(FOLLOWED_AUTHOR_ID)]),
			newcomerAuthorIds: new Set(),
			newcomerHandles: new Set(),
			params: FEED_BETA_DEFAULT_PARAMS
		};

		const out = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 20,
			pageIndex: 1,
			seen: new Set(),
			shuffleSeed: 'follow-sprinkle-test',
			scoreContext,
			enableNsfw: true,
			viewerUserId: 9001,
			showOwnPosts: false
		});

		const sprinkle = out.filter((row) => feedBetaRowPool(row) === 'follow_sprinkle');
		expect(sprinkle.length).toBeGreaterThan(0);
		expect(sprinkle.length).toBeLessThanOrEqual(FEED_BETA_DEFAULT_PARAMS.followTake);

		for (const row of sprinkle) {
			expect(Number(row.user_id)).toBe(FOLLOWED_AUTHOR_ID);
			expect(row.feed_beta_why?.developer?.flags?.is_follow).toBe(true);
		}
	});
});
