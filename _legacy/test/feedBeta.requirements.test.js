import { describe, expect, test } from '@jest/globals';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { loadFeedBetaProdCatalogFixture } from './helpers/feedBetaProdCatalog.js';
import {
	countAuthorOnPage,
	findRowByCreationId,
	INJECT_ID,
	injectBurstFromAuthor,
	injectCatalogRow,
	mergeProdCatalogWithInjections,
	prodCatalogSteadyState,
	setAuthorProfile
} from './helpers/feedBetaCatalogInjections.js';
import { getFeedBetaSeenSet } from '../api_routes/feedBeta/seen.js';
import {
	createGoldenPathQueries,
	createGoldenPathUser,
	feedBetaRowPool,
	poolSampledRows,
	poolsOnPage,
	pullGoldenPathPage,
	userAfterServed,
	FEED_BETA_CURSOR_SENTINEL_AT
} from './helpers/feedBetaGoldenPath.js';

const prodCatalog = () => loadFeedBetaProdCatalogFixture().rows;
const prodBackground = () => prodCatalogSteadyState(prodCatalog());

/**
 * Requirement tests: prod catalog + injected “events” between pulls.
 * Each test proves one product behavior Alex should see.
 */
describe('feedBeta requirements (prod catalog + injections)', () => {
	test('REQ hasMore: never false on page 40+ while unseen sitewide catalog remains', async () => {
		const catalog = prodCatalog();
		const siteTotal = catalog.length;
		const queries = createGoldenPathQueries(catalog);
		let user = createGoldenPathUser();

		for (let pageIndex = 1; pageIndex <= 50; pageIndex += 1) {
			const page = await pullGoldenPathPage({
				queries,
				user,
				limit: 20,
				slotPack: null,
				afterAt: pageIndex > 1 ? FEED_BETA_CURSOR_SENTINEL_AT : null,
				afterIdNum: pageIndex > 1 ? pageIndex - 1 : null
			});

			expect(page.rows.length).toBeGreaterThan(0);
			if (getFeedBetaSeenSet(user).size < siteTotal) {
				expect(page.hasMore).toBe(true);
			}

			user = userAfterServed(user, page.feedBetaServedIds);
		}
	});

	test('REQ new publish: brand-new post from established author appears next visit (new pool)', async () => {
		const authorProfiles = new Map();
		const established = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString();
		setAuthorProfile(authorProfiles, INJECT_ID.NEW_PUBLISH_AUTHOR, established);

		let catalog = mergeProdCatalogWithInjections(prodBackground(), [
			injectCatalogRow({
				createdImageId: INJECT_ID.NEW_PUBLISH_ANCHOR,
				userId: INJECT_ID.NEW_PUBLISH_AUTHOR,
				ageHours: 100,
				likeCount: 1,
				authorCreatedAt: established
			})
		]);

		const queries1 = createGoldenPathQueries(catalog, { authorProfiles });
		let user = createGoldenPathUser();
		const visit1 = await pullGoldenPathPage({
			queries: queries1,
			user,
			limit: 20,
			slotPack: null
		});
		user = userAfterServed(user, visit1.feedBetaServedIds);

		catalog = mergeProdCatalogWithInjections(catalog, [
			injectCatalogRow({
				createdImageId: INJECT_ID.NEW_PUBLISH_POST,
				userId: INJECT_ID.NEW_PUBLISH_AUTHOR,
				ageHours: 0.2,
				likeCount: 0,
				authorCreatedAt: established
			})
		]);
		const visit2 = await pullGoldenPathPage({
			queries: createGoldenPathQueries(catalog, { authorProfiles }),
			user,
			limit: 20,
			slotPack: null
		});

		const row = findRowByCreationId(visit2.rows, INJECT_ID.NEW_PUBLISH_POST);
		expect(row).toBeDefined();
		expect(feedBetaRowPool(row)).toBe('new');
		expect(row.feed_beta_why?.developer?.flags?.is_new_publish).toBe(true);
	});

	test('REQ engagement: likes/comments lift a fresh post into hot pools ahead of quiet fresh posts', async () => {
		const nowMs = Date.now();
		const injections = [
			injectCatalogRow({
				createdImageId: INJECT_ID.ENGAGE_QUIET,
				userId: 9_100_510,
				ageHours: 4,
				likeCount: 0,
				commentCount: 0,
				nowMs
			}),
			injectCatalogRow({
				createdImageId: INJECT_ID.ENGAGE_WARM,
				userId: 9_100_511,
				ageHours: 4,
				likeCount: 8,
				commentCount: 2,
				nowMs
			}),
			injectCatalogRow({
				createdImageId: INJECT_ID.ENGAGE_HOT,
				userId: 9_100_512,
				ageHours: 4,
				likeCount: 90,
				commentCount: 25,
				nowMs
			})
		];
		const catalog = mergeProdCatalogWithInjections(prodBackground(), injections);
		const page = await pullGoldenPathPage({
			queries: createGoldenPathQueries(catalog),
			user: createGoldenPathUser(),
			limit: 20,
			slotPack: null
		});

		const hotRow = findRowByCreationId(page.rows, INJECT_ID.ENGAGE_HOT);
		const warmRow = findRowByCreationId(page.rows, INJECT_ID.ENGAGE_WARM);
		const quietRow = findRowByCreationId(page.rows, INJECT_ID.ENGAGE_QUIET);

		expect(hotRow).toBeDefined();
		expect(feedBetaRowPool(hotRow)).toBe('hot_24h');

		expect(warmRow).toBeDefined();
		expect(['hot_24h', 'hot_7d']).toContain(feedBetaRowPool(warmRow));

		if (quietRow) {
			expect(['new', 'catalog_unseen']).toContain(feedBetaRowPool(quietRow));
		}

		const sampled = poolSampledRows(page.rows);
		const idx = (id) =>
			sampled.findIndex((r) => Number(r.created_image_id) === id);
		const hotIdx = idx(INJECT_ID.ENGAGE_HOT);
		const warmIdx = idx(INJECT_ID.ENGAGE_WARM);
		const quietIdx = idx(INJECT_ID.ENGAGE_QUIET);
		expect(hotIdx).toBeGreaterThanOrEqual(0);
		expect(hotRow.feed_beta_why?.developer?.engagement).toBeGreaterThan(
			warmRow.feed_beta_why?.developer?.engagement ?? 0
		);
		if (quietRow) {
			expect(quietRow.feed_beta_why?.developer?.engagement ?? 0).toBeLessThan(
				warmRow.feed_beta_why?.developer?.engagement ?? 0
			);
		}
	});

	test('REQ hot: recent post with strong engagement is prioritized via hot_24h pool', async () => {
		const nowMs = Date.now();
		const injections = [
			injectCatalogRow({
				createdImageId: INJECT_ID.HOT_VIRAL,
				userId: 9_100_010,
				ageHours: 2,
				likeCount: 150,
				commentCount: 40,
				nowMs
			}),
			injectCatalogRow({
				createdImageId: INJECT_ID.RECENT_QUIET,
				userId: 9_100_011,
				ageHours: 2,
				likeCount: 0,
				commentCount: 0,
				nowMs
			})
		];
		const catalog = mergeProdCatalogWithInjections(prodBackground(), injections);
		const queries = createGoldenPathQueries(catalog);
		const user = createGoldenPathUser();

		const page = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null,
			refresh: false
		});

		const hotRow = findRowByCreationId(page.rows, INJECT_ID.HOT_VIRAL);
		expect(hotRow).toBeDefined();
		expect(feedBetaRowPool(hotRow)).toBe('hot_24h');

		const sampled = poolSampledRows(page.rows);
		const hotIdx = sampled.findIndex(
			(r) => Number(r.created_image_id) === INJECT_ID.HOT_VIRAL
		);
		const quietIdx = sampled.findIndex(
			(r) => Number(r.created_image_id) === INJECT_ID.RECENT_QUIET
		);
		expect(hotIdx).toBeGreaterThanOrEqual(0);
		expect(hotIdx).toBeLessThan(6);
		if (quietIdx >= 0) {
			expect(hotIdx).toBeLessThan(quietIdx);
		}
	});

	test('REQ follow: new post from followed creator appears on next visit (new pool)', async () => {
		const authorProfiles = new Map();
		const established = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
		setAuthorProfile(authorProfiles, INJECT_ID.FOLLOWED_AUTHOR, established);

		let catalog = mergeProdCatalogWithInjections(prodBackground(), [
			injectCatalogRow({
				createdImageId: INJECT_ID.FOLLOWED_AUTHOR + 1,
				userId: INJECT_ID.FOLLOWED_AUTHOR,
				ageHours: 48,
				likeCount: 2,
				authorCreatedAt: established
			})
		]);

		const queries1 = createGoldenPathQueries(catalog, {
			followingUserIds: [INJECT_ID.FOLLOWED_AUTHOR],
			authorProfiles
		});
		let user = createGoldenPathUser();

		const visit1 = await pullGoldenPathPage({
			queries: queries1,
			user,
			limit: 20,
			slotPack: null
		});
		user = userAfterServed(user, visit1.feedBetaServedIds);

		catalog = mergeProdCatalogWithInjections(catalog, [
			injectCatalogRow({
				createdImageId: INJECT_ID.FOLLOWED_NEW,
				userId: INJECT_ID.FOLLOWED_AUTHOR,
				ageHours: 0.3,
				likeCount: 0,
				authorCreatedAt: established
			})
		]);
		const queries2 = createGoldenPathQueries(catalog, {
			followingUserIds: [INJECT_ID.FOLLOWED_AUTHOR],
			authorProfiles
		});

		const visit2 = await pullGoldenPathPage({
			queries: queries2,
			user,
			limit: 20,
			slotPack: null
		});

		const newPost = findRowByCreationId(visit2.rows, INJECT_ID.FOLLOWED_NEW);
		expect(newPost).toBeDefined();
		expect(Number(newPost.user_id)).toBe(INJECT_ID.FOLLOWED_AUTHOR);
		expect(feedBetaRowPool(newPost)).toBe('new');
		expect(visit1.feedBetaServedIds).not.toContain(String(INJECT_ID.FOLLOWED_NEW));
	});

	test('REQ newcomer: new post from new account surfaces via newcomer pool', async () => {
		const authorProfiles = new Map();
		const newcomerAccountAt = new Date(
			Date.now() - 3 * 24 * 60 * 60 * 1000
		).toISOString();
		setAuthorProfile(authorProfiles, INJECT_ID.NEWCOMER_AUTHOR, newcomerAccountAt);

		const catalog = mergeProdCatalogWithInjections(prodBackground(), [
			injectCatalogRow({
				createdImageId: INJECT_ID.NEWCOMER_NEW,
				userId: INJECT_ID.NEWCOMER_AUTHOR,
				ageHours: 0.4,
				likeCount: 0,
				authorCreatedAt: newcomerAccountAt
			})
		]);

		const queries = createGoldenPathQueries(catalog, { authorProfiles });
		const user = createGoldenPathUser();

		const page = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null
		});

		const row = findRowByCreationId(page.rows, INJECT_ID.NEWCOMER_NEW);
		expect(row).toBeDefined();
		const pool = feedBetaRowPool(row);
		expect(pool === 'newcomer' || pool === 'new').toBe(true);
		expect(row.feed_beta_why?.developer?.flags?.is_newcomer_author).toBe(true);
	});

	test('REQ balance: page 2+ still surfaces new publishes and unseen engaged/catalog mix', async () => {
		const injections = [];
		for (let i = 0; i < 6; i += 1) {
			injections.push(
				injectCatalogRow({
					createdImageId: INJECT_ID.BALANCE_FRESH_BASE + i,
					userId: 9_100_620 + i,
					ageHours: 1 + i * 0.4,
					likeCount: 0,
					commentCount: 0
				})
			);
		}
		injections.push(
			injectCatalogRow({
				createdImageId: INJECT_ID.BALANCE_ENGAGED,
				userId: 9_100_630,
				ageHours: 24 * 6,
				likeCount: 30,
				commentCount: 8
			})
		);
		const catalog = mergeProdCatalogWithInjections(prodBackground(), injections);
		const queries = createGoldenPathQueries(catalog);
		let user = createGoldenPathUser();

		const page1 = await pullGoldenPathPage({
			queries,
			user,
			limit: 8,
			slotPack: null
		});
		user = userAfterServed(user, page1.feedBetaServedIds);

		const page2 = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null,
			afterAt: FEED_BETA_CURSOR_SENTINEL_AT,
			afterIdNum: 1
		});

		const pools2 = poolsOnPage(page2.rows);
		expect(
			pools2.has('new') ||
				pools2.has('catalog_unseen') ||
				pools2.has('catalog_relaxed')
		).toBe(true);
		expect(
			pools2.has('hot_7d') ||
				pools2.has('hot_24h') ||
				pools2.has('catalog_unseen') ||
				pools2.has('db_random_fallback')
		).toBe(true);

		const freshInjectIds = Array.from({ length: 5 }, (_, i) => INJECT_ID.BALANCE_FRESH_BASE + i);
		const hasBalanceInjectOnPage2 = page2.rows.some((row) =>
			freshInjectIds.includes(Number(row.created_image_id)) ||
			Number(row.created_image_id) === INJECT_ID.BALANCE_ENGAGED
		);
		expect(hasBalanceInjectOnPage2).toBe(true);
	});

	test('REQ balance: mid-scroll page shows just-published posts and unseen engaged older items', async () => {
		let catalog = prodBackground();
		const queries0 = createGoldenPathQueries(catalog);
		let user = createGoldenPathUser();

		for (let pageIndex = 1; pageIndex <= 2; pageIndex += 1) {
			const page = await pullGoldenPathPage({
				queries: queries0,
				user,
				limit: 20,
				slotPack: null,
				afterAt: pageIndex > 1 ? FEED_BETA_CURSOR_SENTINEL_AT : null,
				afterIdNum: pageIndex > 1 ? pageIndex - 1 : null
			});
			user = userAfterServed(user, page.feedBetaServedIds);
		}

		catalog = mergeProdCatalogWithInjections(catalog, [
			injectCatalogRow({
				createdImageId: INJECT_ID.BALANCE_SCROLL_FRESH,
				userId: 9_100_640,
				ageHours: 0.35,
				likeCount: 0,
				commentCount: 0
			}),
			injectCatalogRow({
				createdImageId: INJECT_ID.BALANCE_SCROLL_ENGAGED,
				userId: 9_100_641,
				ageHours: 24 * 5,
				likeCount: 42,
				commentCount: 11
			})
		]);
		const queries = createGoldenPathQueries(catalog);
		const page3 = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null,
			afterAt: FEED_BETA_CURSOR_SENTINEL_AT,
			afterIdNum: 2
		});

		const fresh = findRowByCreationId(page3.rows, INJECT_ID.BALANCE_SCROLL_FRESH);
		const engaged = findRowByCreationId(page3.rows, INJECT_ID.BALANCE_SCROLL_ENGAGED);
		expect(fresh).toBeDefined();
		expect(feedBetaRowPool(fresh)).toBe('new');
		expect(engaged).toBeDefined();
		expect(['hot_7d', 'hot_24h', 'catalog_unseen']).toContain(feedBetaRowPool(engaged));
	});

	test('REQ cap: burst of many posts from one author yields at most two on a page (unknown author)', async () => {
		const burst = injectBurstFromAuthor(INJECT_ID.BURST_AUTHOR, 12);
		const catalog = mergeProdCatalogWithInjections(prodBackground(), burst);
		const queries = createGoldenPathQueries(catalog);
		const user = createGoldenPathUser();

		const page = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null
		});

		const onPage = countAuthorOnPage(page.rows, INJECT_ID.BURST_AUTHOR);
		expect(onPage).toBeLessThanOrEqual(FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage);
		expect(onPage).toBeGreaterThan(0);
	});

	test('REQ cap: burst from followed author is still capped at two per page', async () => {
		const authorProfiles = new Map();
		const established = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
		setAuthorProfile(authorProfiles, INJECT_ID.BURST_AUTHOR, established);

		const burst = injectBurstFromAuthor(INJECT_ID.BURST_AUTHOR, 12, INJECT_ID.BURST_FIRST + 100);
		const catalog = mergeProdCatalogWithInjections(prodBackground(), burst);
		const queries = createGoldenPathQueries(catalog, {
			followingUserIds: [INJECT_ID.BURST_AUTHOR],
			authorProfiles
		});
		const user = createGoldenPathUser();

		const page = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null
		});

		expect(countAuthorOnPage(page.rows, INJECT_ID.BURST_AUTHOR)).toBeLessThanOrEqual(
			FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage
		);
	});

	test('REQ cap: burst from newcomer author is still capped at two per page', async () => {
		const authorProfiles = new Map();
		const newcomerAccountAt = new Date(
			Date.now() - 5 * 24 * 60 * 60 * 1000
		).toISOString();
		setAuthorProfile(authorProfiles, INJECT_ID.BURST_AUTHOR, newcomerAccountAt);

		const burst = injectBurstFromAuthor(INJECT_ID.BURST_AUTHOR, 12, INJECT_ID.BURST_FIRST + 200);
		for (const row of burst) {
			row.author_created_at = newcomerAccountAt;
		}
		const catalog = mergeProdCatalogWithInjections(prodBackground(), burst);
		const queries = createGoldenPathQueries(catalog, { authorProfiles });
		const user = createGoldenPathUser();

		const page = await pullGoldenPathPage({
			queries,
			user,
			limit: 20,
			slotPack: null
		});

		expect(countAuthorOnPage(page.rows, INJECT_ID.BURST_AUTHOR)).toBeLessThanOrEqual(
			FEED_BETA_DEFAULT_PARAMS.maxCreationsPerAuthorPerPage
		);
	});
});
