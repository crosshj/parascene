import { describe, expect, test } from '@jest/globals';
import { drawThreadPageFromCatalog } from '../api_routes/feedBeta/pools.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';
import { feedRowIsVideoThread } from '../api_routes/feedBeta/rowMedia.js';
import {
	buildProdCatalogScoreContext,
	chronologicalFeedPage,
	loadFeedBetaProdCatalogFixture
} from './helpers/feedBetaProdCatalog.js';

/**
 * One starter test against prod-shaped published catalog CSV.
 * Compares feed-beta pool draw vs pure newest-first ordering.
 */
describe('feedBeta prod catalog fixture', () => {
	test('page 1 pool draw differs from chronological feed (hot + videos)', () => {
		const { rows: catalog } = loadFeedBetaProdCatalogFixture();
		expect(catalog.length).toBeGreaterThan(1000);

		const videos = catalog.filter((r) => feedRowIsVideoThread(r));
		expect(videos.length).toBeGreaterThan(0);

		const nowMs = Date.now();
		const scoreContext = {
			...buildProdCatalogScoreContext(catalog, nowMs),
			params: FEED_BETA_DEFAULT_PARAMS
		};

		const legacyTop = chronologicalFeedPage(catalog, 20);
		const legacyIds = new Set(legacyTop.map((r) => String(r.created_image_id)));

		const agedOutsideRecencyWindow = catalog.filter((row) => {
			const ageDays = (nowMs - Date.parse(String(row.created_at))) / (24 * 60 * 60 * 1000);
			return ageDays >= 7 && !legacyIds.has(String(row.created_image_id));
		});
		expect(agedOutsideRecencyWindow.length).toBeGreaterThan(100);

		const betaOther = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 20,
			pageIndex: 1,
			seen: new Set(),
			shuffleSeed: 'prod-fixture:other:p1',
			scoreContext,
			enableNsfw: true,
			viewerUserId: 0,
			showOwnPosts: true,
			ignoreSeen: true
		});
		const betaVideo = drawThreadPageFromCatalog(catalog, {
			thread: 'video',
			take: 12,
			pageIndex: 1,
			seen: new Set(),
			shuffleSeed: 'prod-fixture:video:p1',
			scoreContext,
			enableNsfw: true,
			viewerUserId: 0,
			showOwnPosts: true,
			ignoreSeen: true
		});

		expect(betaOther.length).toBe(20);
		expect(betaVideo.length).toBeGreaterThan(0);
		expect(betaVideo.every((r) => feedRowIsVideoThread(r))).toBe(true);

		const betaOtherIds = betaOther.map((r) => String(r.created_image_id));
		const agedOutsideRecencyIds = new Set(
			agedOutsideRecencyWindow.map((r) => String(r.created_image_id))
		);
		expect(betaOtherIds.some((id) => agedOutsideRecencyIds.has(id))).toBe(true);

		expect(betaOtherIds.some((id) => !legacyIds.has(id))).toBe(true);
	});
});
