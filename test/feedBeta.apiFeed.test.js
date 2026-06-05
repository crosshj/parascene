import { describe, expect, test } from '@jest/globals';
import { FEED_BETA_CURSOR_SENTINEL_AT } from '../api_routes/feedBeta/cursor.js';
import { loadFeedBetaProdCatalogFixture } from './helpers/feedBetaProdCatalog.js';
import {
	buildGetFeedJsonResponse,
	FEED_API_TOP_LEVEL_KEYS,
	FEED_BETA_API_TOP_LEVEL_KEYS,
	FEED_CREATION_ITEM_KEYS
} from './helpers/feedApiRoute.js';
import {
	createGoldenPathQueries,
	createGoldenPathUser
} from './helpers/feedBetaGoldenPath.js';
import { injectCatalogRow, mergeProdCatalogWithInjections, prodCatalogSteadyState } from './helpers/feedBetaCatalogInjections.js';

function catalogRow(id, opts = {}) {
	const { mediaType = 'image', userId = id } = opts;
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: `2025-02-${String((id % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
		user_id: userId,
		title: `Creation ${id}`,
		summary: '',
		author: 'author',
		meta,
		like_count: 1,
		comment_count: 0,
		nsfw: false,
		viewer_liked: false
	};
}

function createBetaApiQueries(catalog) {
	const seenUpdates = [];
	const base = createGoldenPathQueries(catalog);
	return {
		...base,
		selectUserById: {
			get: async (id) => createGoldenPathUser(id)
		},
		updateUserFeedBetaSeen: {
			run: async (userId, ids) => {
				seenUpdates.push({ userId, ids: [...ids] });
			}
		},
		_seenUpdates: seenUpdates
	};
}

describe('GET /api/feed beta integration', () => {
	test('beta user response matches legacy top-level shape (items, hasMore)', async () => {
		const catalog = Array.from({ length: 40 }, (_, i) =>
			catalogRow(i + 1, { mediaType: i % 4 === 0 ? 'video' : 'image', userId: (i % 10) + 2 })
		);

		const legacyQueries = {
			selectFeedItems: {
				getPage: async (_userId, { limit }) => ({
					rows: catalog.slice(0, limit),
					hasMore: catalog.length > limit
				})
			},
			selectUserById: {
				get: async (id) => ({ id, meta: {} })
			}
		};

		const betaUser = {
			id: 42,
			role: 'consumer',
			meta: { feedBetaEnabled: true }
		};

		const [legacy, beta] = await Promise.all([
			buildGetFeedJsonResponse({
				queries: legacyQueries,
				user: { id: 42, role: 'consumer', meta: {} },
				query: { limit: 20 }
			}),
			buildGetFeedJsonResponse({
				queries: createBetaApiQueries(catalog),
				user: betaUser,
				query: { limit: 20 }
			})
		]);

		expect(legacy.useFeedBeta).toBe(false);
		expect(beta.useFeedBeta).toBe(true);

		for (const key of FEED_API_TOP_LEVEL_KEYS) {
			expect(legacy.body).toHaveProperty(key);
			expect(beta.body).toHaveProperty(key);
		}
		for (const key of FEED_BETA_API_TOP_LEVEL_KEYS) {
			expect(beta.body).toHaveProperty(key);
		}
		expect(Array.isArray(legacy.body.items)).toBe(true);
		expect(Array.isArray(beta.body.items)).toBe(true);
		expect(typeof legacy.body.hasMore).toBe('boolean');
		expect(typeof beta.body.hasMore).toBe('boolean');
	});

	test('beta creation rows include feed_beta_why after assembleFeedItems', async () => {
		const injections = [
			injectCatalogRow({
				createdImageId: 9_100_801,
				userId: 9_100_810,
				ageHours: 3,
				likeCount: 25,
				commentCount: 4
			})
		];
		const catalog = mergeProdCatalogWithInjections(
			prodCatalogSteadyState(loadFeedBetaProdCatalogFixture().rows),
			injections
		);
		const queries = createBetaApiQueries(catalog);
		const user = { id: 9001, role: 'consumer', meta: { feedBetaEnabled: true } };

		const { body, creationPull } = await buildGetFeedJsonResponse({
			queries,
			user,
			query: { limit: 20 }
		});

		expect(body.items.length).toBeGreaterThan(0);
		const creation = body.items.find(
			(item) => item.created_image_id === 9_100_801 || item.id === 9_100_801
		);
		expect(creation).toBeDefined();
		for (const key of FEED_CREATION_ITEM_KEYS) {
			expect(creation).toHaveProperty(key);
		}
		expect(creation.feed_beta_why).toBeDefined();
		expect(typeof creation.feed_beta_why.summary).toBe('string');
		expect(creation.feed_beta_why.summary.length).toBeGreaterThan(0);
		expect(creation.feed_beta_why.developer?.pool).toBeTruthy();

		expect(queries._seenUpdates.length).toBe(1);
		expect(queries._seenUpdates[0].ids.length).toBe(
			creationPull.feedBetaServedIds.length
		);
	});

	test('beta slot-pack page returns feed_cursor sentinel', async () => {
		const catalog = mergeProdCatalogWithInjections(
			prodCatalogSteadyState(loadFeedBetaProdCatalogFixture().rows),
			[
				injectCatalogRow({
					createdImageId: 9_100_820,
					userId: 9_100_821,
					ageHours: 1,
					mediaType: 'video'
				})
			]
		);
		const { body, useFeedBeta } = await buildGetFeedJsonResponse({
			queries: createBetaApiQueries(catalog),
			user: { id: 9001, role: 'consumer', meta: { feedBetaEnabled: true } },
			query: { limit: 21, slot_pack: 'mobile_chat_v1' }
		});

		expect(useFeedBeta).toBe(true);
		expect(body.feed_cursor).toBeDefined();
		expect(body.feed_cursor.after_image_created_at).toBe(FEED_BETA_CURSOR_SENTINEL_AT);
		expect(Number(body.feed_cursor.after_image_id)).toBe(1);
	});

	test('beta response includes feed_timing segments', async () => {
		const catalog = mergeProdCatalogWithInjections(
			prodCatalogSteadyState(loadFeedBetaProdCatalogFixture().rows),
			[
				injectCatalogRow({
					createdImageId: 9_100_830,
					userId: 9_100_831,
					ageHours: 1
				})
			]
		);
		const { body } = await buildGetFeedJsonResponse({
			queries: createBetaApiQueries(catalog),
			user: { id: 9001, role: 'consumer', meta: { feedBetaEnabled: true } },
			query: { limit: 20, feed_surface: 'chat' }
		});

		expect(body.feed_timing).toBeDefined();
		expect(typeof body.feed_timing.total_ms).toBe('number');
		expect(body.feed_timing.segments).toBeDefined();
		expect(typeof body.feed_timing.segments).toBe('object');
		expect(Array.isArray(body.feed_timing.segments)).toBe(false);
		const segmentKeys = Object.keys(body.feed_timing.segments);
		expect(segmentKeys.some((k) => k.endsWith('pull.rows_total'))).toBe(true);
		expect(segmentKeys.some((k) => k.endsWith('assemble.total'))).toBe(true);
		expect(typeof body.feed_timing.server_handler_ms).toBe('number');
		expect(typeof body.feed_timing.response_bytes).toBe('number');
		expect(body.feed_timing.client_network_hint).toContain('Network');
	});
});
