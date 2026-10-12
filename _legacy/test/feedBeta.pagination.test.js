import { describe, expect, test } from '@jest/globals';
import { enforceCreatorCapOnPage, pickTopEngagedPerAuthor } from '../api_routes/feedBeta/creatorCap.js';
import { mergeBetaPage } from '../api_routes/feedBeta/mergeBetaPage.js';
import { pullFeedBetaRows } from '../api_routes/feedBeta/pullFeedBetaRows.js';

function row(id, opts = {}) {
	const { mediaType = 'image', userId = 1 } = opts;
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: `2025-01-${String((id % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
		user_id: userId,
		meta
	};
}

function rowWithEngagement(id, userId, engagement, likeCount = 0) {
	return {
		...row(id, { userId }),
		like_count: likeCount,
		feed_beta_why: { developer: { engagement } }
	};
}

describe('pickTopEngagedPerAuthor', () => {
	test('keeps two highest-engagement rows per author in original order', () => {
		const primary = [
			rowWithEngagement(1, 10, 0.2),
			rowWithEngagement(2, 10, 5.0),
			rowWithEngagement(3, 10, 1.0),
			rowWithEngagement(4, 10, 8.0)
		];
		const kept = pickTopEngagedPerAuthor(primary, 2);
		expect(kept.map((r) => r.id)).toEqual([2, 4]);
	});
});

describe('enforceCreatorCapOnPage', () => {
	test('limits same author and backfills from spare rows', () => {
		const primary = [1, 2, 3, 4].map((id) => row(id, { userId: 10 }));
		const spare = [5, 6, 7, 8].map((id) => row(id, { userId: 20 }));
		const out = enforceCreatorCapOnPage(primary, {
			limit: 4,
			spareRows: spare,
			maxPerCreator: 2
		});
		expect(out.length).toBe(4);
		const authorCounts = out.reduce((acc, r) => {
			const uid = String(r.user_id);
			acc[uid] = (acc[uid] || 0) + 1;
			return acc;
		}, {});
		expect(authorCounts['10']).toBe(2);
		expect(authorCounts['20']).toBe(2);
	});

	test('prefers high-engagement spare over low-engagement when filling cap slots', () => {
		const primary = [rowWithEngagement(1, 10, 9.0), rowWithEngagement(2, 10, 8.0)];
		const spare = [
			rowWithEngagement(3, 20, 0.1),
			rowWithEngagement(4, 20, 4.5)
		];
		const out = enforceCreatorCapOnPage(primary, {
			limit: 3,
			spareRows: spare,
			maxPerCreator: 2
		});
		expect(out.length).toBe(3);
		expect(out.some((r) => r.id === 4)).toBe(true);
		expect(out.some((r) => r.id === 3)).toBe(false);
	});
});

describe('mergeBetaPage creator cap', () => {
	test('round-robin page caps author at two and fills from other authors', () => {
		const videos = [1, 2, 3, 4, 5, 6].map((id) => row(id, { mediaType: 'video', userId: 99 }));
		const others = [10, 11, 12, 13, 14, 15].map((id) =>
			row(id, { userId: id <= 12 ? 50 : 51 })
		);
		const { rows } = mergeBetaPage({
			videoRows: videos,
			otherRows: others,
			limit: 6,
			slotPackPageOne: false
		});
		expect(rows.length).toBe(6);
		const authorCounts = rows.reduce((acc, r) => {
			const uid = String(r.user_id);
			acc[uid] = (acc[uid] || 0) + 1;
			return acc;
		}, {});
		expect(authorCounts['99'] || 0).toBeLessThanOrEqual(2);
		expect(authorCounts['50'] || 0).toBeLessThanOrEqual(2);
		expect(authorCounts['51'] || 0).toBeLessThanOrEqual(2);
	});
});

function catalogRow(id, opts = {}) {
	const { mediaType = 'image', userId = id, ageHours = 12 } = opts;
	const created = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: `/v${id}.mp4` } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: created,
		user_id: userId,
		meta,
		like_count: id % 7,
		comment_count: id % 3,
		nsfw: false
	};
}

describe('pullFeedBetaRows pagination', () => {
	test('page 1 hasMore with modest catalog; page 2 returns new ids', async () => {
		const catalog = [];
		for (let i = 1; i <= 120; i += 1) {
			catalog.push(
				catalogRow(i, {
					mediaType: i % 3 === 0 ? 'video' : 'image',
					userId: (i % 30) + 1,
					ageHours: i + 2
				})
			);
		}
		const queries = {
			selectFeedBetaSitewideCatalog: {
				getRecent: async () => catalog,
				getTopEngaged: async () => [],
				getBackCatalogSlice: async () => []
			},
			selectUserFollowing: { all: async () => [] }
		};
		const user = { id: 42, meta: { feedBetaEnabled: true, feedBetaSeen: [] } };

		const page1 = await pullFeedBetaRows({
			queries,
			user,
			limit: 20,
			offset: 0,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});
		expect(page1.rows.length).toBe(20);
		expect(page1.hasMore).toBe(true);

		const seenAfterPage1 = page1.feedBetaServedIds;
		const userPage2 = {
			...user,
			meta: { ...user.meta, feedBetaSeen: seenAfterPage1 }
		};
		const page2 = await pullFeedBetaRows({
			queries,
			user: userPage2,
			limit: 20,
			offset: 20,
			slotPack: false,
			enableNsfw: true,
			showOwnPosts: true,
			refresh: false
		});
		expect(page2.rows.length).toBe(20);
		const overlap = page2.rows.filter((r) =>
			page1.rows.some((a) => String(a.created_image_id) === String(r.created_image_id))
		);
		expect(overlap.length).toBe(0);
	});
});
