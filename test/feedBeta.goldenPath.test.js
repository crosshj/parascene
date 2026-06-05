import { describe, expect, test, jest } from '@jest/globals';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { getFeedBetaSeenSet } from '../api_routes/feedBeta/seen.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../src/shared/chatFeedMobilePartition.js';
import { loadFeedBetaProdCatalogFixture } from './helpers/feedBetaProdCatalog.js';
import {
	assertMobileSlotPackShape,
	createGoldenPathQueries,
	createGoldenPathUser,
	creationIdsOnPage,
	GOLDEN_VIEWER_ID,
	pickFollowTargetUserId,
	poolSampledRows,
	poolsOnPage,
	pullGoldenPathPage,
	userAfterServed,
	FEED_BETA_CURSOR_SENTINEL_AT
} from './helpers/feedBetaGoldenPath.js';

/**
 * Golden path: Alex (beta user) over several “sessions” on mobile chat #feed.
 *
 * Persona
 * - Opted into Feed [beta], follows a prolific creator, has liked a few posts over time.
 * - Opens feed on phone (slot_pack page 1), scrolls, comes back later, pull-to-refreshes, goes deep.
 *
 * Acts (simulated with fixture catalog + feedBetaSeen / viewer_liked)
 * 1. First visit — fresh feed: ranked pools (hot/new/newcomer/catalog/follow), spotlight videos, then sorted by date for display.
 * 2. Same day return — pool draws skip prior API-served IDs (feedBetaSeen); discovery continues.
 * 3. Pull to refresh — page 1 reshuffles (new page-1 seed).
 * 4. Scroll page 2 — continuation, no duplicates from page 1.
 * 5. Liked posts — excluded from pool draws like seen.
 * 6. Deep scroll page 5 — relaxed catalog pool; hasMore still true.
 */
describe('feedBeta golden path (prod catalog)', () => {
	const catalog = loadFeedBetaProdCatalogFixture().rows;
	const followUserId = pickFollowTargetUserId(catalog);
	const queries = createGoldenPathQueries(catalog, {
		followingUserIds: followUserId != null ? [followUserId] : []
	});

	test('Alex gets discovery value across visits (pools, seen, refresh, scroll, video, follow, deep)', async () => {
		expect(catalog.length).toBeGreaterThan(1000);
		expect(followUserId).not.toBeNull();

		let user = createGoldenPathUser(GOLDEN_VIEWER_ID);

		// —— Session 1: first open (mobile slot-pack page 1) ——
		const session1 = await pullGoldenPathPage({
			queries,
			user,
			limit: 21,
			slotPack: 'mobile_chat_v1',
			refresh: false
		});

		expect(session1.hasMore).toBe(true);
		assertMobileSlotPackShape(session1.rows);

		const session1Pools = poolsOnPage(session1.rows);
		expect(session1Pools.has('hot_24h') || session1Pools.has('hot_7d')).toBe(true);
		expect(session1Pools.has('new') || session1Pools.has('newcomer')).toBe(true);

		for (let i = 1; i < session1.rows.length; i += 1) {
			expect(
				String(session1.rows[i - 1].created_at || '').localeCompare(
					String(session1.rows[i].created_at || '')
				)
			).toBeGreaterThanOrEqual(0);
		}

		const followedOnPage1 = session1.rows.some((r) => Number(r.user_id) === followUserId);
		expect(followedOnPage1).toBe(true);

		const session1Sampled = poolSampledRows(session1.rows);
		expect(session1Sampled.length).toBeGreaterThan(0);
		expect(session1Sampled.every((r) => r.feed_beta_why?.developer?.pool)).toBe(true);

		const session1Ids = new Set(creationIdsOnPage(session1.rows));
		user = userAfterServed(user, session1.feedBetaServedIds);

		// —— Session 2: return later same day (seen excludes prior served from pools) ——
		const session2 = await pullGoldenPathPage({
			queries,
			user,
			limit: 21,
			slotPack: 'mobile_chat_v1',
			refresh: false
		});

		const session2SampledIds = creationIdsOnPage(poolSampledRows(session2.rows));
		const repeatFromPools = session2SampledIds.filter((id) => session1Ids.has(id));
		expect(repeatFromPools.length).toBe(0);
		expect(session2.rows.length).toBeGreaterThanOrEqual(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);

		const session2Ids = new Set(creationIdsOnPage(session2.rows));
		user = userAfterServed(user, session2.feedBetaServedIds);

		// —— Session 3: pull to refresh (page 1 seed changes) ——
		jest.useFakeTimers();
		const t0 = Date.now();
		jest.setSystemTime(t0);
		const beforeRefreshIds = creationIdsOnPage(session2.rows);

		jest.setSystemTime(t0 + 120_000);
		const session3 = await pullGoldenPathPage({
			queries,
			user,
			limit: 21,
			slotPack: 'mobile_chat_v1',
			refresh: true
		});
		jest.useRealTimers();

		const afterRefreshIds = creationIdsOnPage(session3.rows);
		const sameOrder =
			afterRefreshIds.length === beforeRefreshIds.length &&
			afterRefreshIds.every((id, i) => id === beforeRefreshIds[i]);
		expect(sameOrder).toBe(false);

		user = userAfterServed(user, session3.feedBetaServedIds);
		const seenAfterThree = new Set(user.meta.feedBetaSeen);

		// —— Session 4: scroll to page 2 (beta page cursor) ——
		const session4 = await pullGoldenPathPage({
			queries,
			user,
			limit: 21,
			slotPack: 'mobile_chat_v1',
			afterAt: FEED_BETA_CURSOR_SENTINEL_AT,
			afterIdNum: 1
		});

		expect(session4.hasMore).toBe(true);
		const page2Ids = creationIdsOnPage(session4.rows);
		const overlapPage2 = page2Ids.filter((id) => session1Ids.has(id) || session2Ids.has(id));
		expect(overlapPage2.length).toBe(0);

		const page2Pools = poolsOnPage(session4.rows);
		expect(
			page2Pools.has('catalog_unseen') ||
				page2Pools.has('fill_remainder') ||
				page2Pools.has('db_random_fallback')
		).toBe(true);

		user = userAfterServed(user, session4.feedBetaServedIds);

		// —— Session 5: liked posts treated like seen for pool draws ——
		const likedFromSession4 = page2Ids.slice(0, 8);
		const queriesWithLikes = createGoldenPathQueries(catalog, {
			followingUserIds: followUserId != null ? [followUserId] : [],
			likedCreationIds: new Set(likedFromSession4)
		});
		const session5 = await pullGoldenPathPage({
			queries: queriesWithLikes,
			user,
			limit: 21,
			slotPack: 'mobile_chat_v1',
			refresh: false
		});
		const session5SampledIds = creationIdsOnPage(poolSampledRows(session5.rows));
		for (const id of likedFromSession4) {
			expect(session5SampledIds).not.toContain(id);
		}

		// —— Session 6: deep scroll page 5 (relaxed seen/liked filters) ——
		const session6 = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null,
			afterAt: FEED_BETA_CURSOR_SENTINEL_AT,
			afterIdNum: FEED_BETA_DEFAULT_PARAMS.relaxFiltersFromPage - 1
		});

		expect(session6.hasMore).toBe(true);
		const page5Ids = creationIdsOnPage(session6.rows);
		const resurfacedFromEarlyVisits = page5Ids.filter((id) => session1Ids.has(id));
		expect(resurfacedFromEarlyVisits.length).toBeGreaterThan(0);

		// Seen list grew across sessions (API would persist feedBetaSeen before response).
		expect(seenAfterThree.size).toBeGreaterThan(40);
		expect(user.meta.feedBetaSeen.length).toBeGreaterThan(seenAfterThree.size);
	});

	test('doom scroll: hasMore stays true while Alex has not seen the full sitewide catalog', async () => {
		const { rows: catalog } = loadFeedBetaProdCatalogFixture();
		const siteTotal = catalog.length;
		const queries = createGoldenPathQueries(catalog);
		let user = createGoldenPathUser();

		for (let pageIndex = 1; pageIndex <= 120; pageIndex += 1) {
			const page = await pullGoldenPathPage({
				queries,
				user,
				limit: 20,
				slotPack: null,
				afterAt: pageIndex > 1 ? FEED_BETA_CURSOR_SENTINEL_AT : null,
				afterIdNum: pageIndex > 1 ? pageIndex - 1 : null
			});

			expect(page.rows.length).toBeGreaterThan(0);

			const seenBeforePage = getFeedBetaSeenSet(user).size;
			if (seenBeforePage < siteTotal) {
				expect(page.hasMore).toBe(true);
			}

			user = userAfterServed(user, page.feedBetaServedIds);
		}

		expect(getFeedBetaSeenSet(user).size).toBeLessThan(siteTotal);
		expect(getFeedBetaSeenSet(user).size).toBeGreaterThan(100);
	});
});
