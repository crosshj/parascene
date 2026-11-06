import { describe, expect, test } from '@jest/globals';
import { pullFeedBetaCandidateCatalog } from '../api_routes/feedBeta/catalog.js';
import { injectCatalogRow } from './helpers/feedBetaCatalogInjections.js';

const FOLLOWED_AUTHOR_ID = 9_100_901;
const FOLLOWED_CREATION_ID = 9_100_902;
const NON_FOLLOW_CREATION_ID = 9_100_903;

/**
 * Legacy Explore paginated excludes viewer + followed authors (see db/supabase selectExploreFeedItems).
 */
function createExploreStyleMock({ followedAuthorId, rows }) {
	return {
		paginated: async (viewerId) => {
			const viewerStr = String(viewerId);
			const followStr = String(followedAuthorId);
			const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
				const uid = String(row.user_id ?? '');
				return uid && uid !== viewerStr && uid !== followStr;
			});
			return { rows: filtered };
		}
	};
}

function createSitewideMock(rows) {
	return {
		getRecent: async () => rows,
		getTopEngaged: async () => rows,
		getBackCatalogSlice: async () => rows,
		getPublishedCount: async () => rows.length
	};
}

describe('feedBeta sitewide catalog', () => {
	test('pullFeedBetaCandidateCatalog never calls selectExploreFeedItems', async () => {
		const followedRow = injectCatalogRow({
			createdImageId: FOLLOWED_CREATION_ID,
			userId: FOLLOWED_AUTHOR_ID,
			ageHours: 48,
			likeCount: 3
		});

		let exploreCalled = false;
		const queries = {
			selectFeedBetaSitewideCatalog: createSitewideMock([followedRow]),
			selectExploreFeedItems: {
				paginated: async () => {
					exploreCalled = true;
					return { rows: [] };
				},
				all: async () => {
					exploreCalled = true;
					return [];
				}
			}
		};

		const catalog = await pullFeedBetaCandidateCatalog(queries, 9001, 'test-seed');
		expect(exploreCalled).toBe(false);
		expect(
			catalog.some((row) => Number(row.created_image_id) === FOLLOWED_CREATION_ID)
		).toBe(true);
	});

	test('sitewide catalog includes followed authors; explore mock would drop them', async () => {
		const viewerId = 9001;
		const rows = [
			injectCatalogRow({
				createdImageId: FOLLOWED_CREATION_ID,
				userId: FOLLOWED_AUTHOR_ID,
				ageHours: 24,
				likeCount: 5
			}),
			injectCatalogRow({
				createdImageId: NON_FOLLOW_CREATION_ID,
				userId: 9_100_904,
				ageHours: 24,
				likeCount: 1
			})
		];

		const sitewide = await pullFeedBetaCandidateCatalog(
			{ selectFeedBetaSitewideCatalog: createSitewideMock(rows) },
			viewerId,
			'sitewide-test'
		);

		const explore = createExploreStyleMock({
			followedAuthorId: FOLLOWED_AUTHOR_ID,
			rows
		});
		const exploreResult = await explore.paginated(viewerId);
		const exploreRows = Array.isArray(exploreResult?.rows)
			? exploreResult.rows
			: exploreResult;

		expect(
			sitewide.some((row) => Number(row.created_image_id) === FOLLOWED_CREATION_ID)
		).toBe(true);
		expect(
			exploreRows.some((row) => Number(row.created_image_id) === FOLLOWED_CREATION_ID)
		).toBe(false);
		expect(
			exploreRows.some((row) => Number(row.created_image_id) === NON_FOLLOW_CREATION_ID)
		).toBe(true);
	});
});
