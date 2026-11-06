import { describe, expect, test } from '@jest/globals';
import { drawThreadPageFromCatalog } from '../api_routes/feedBeta/pools.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../api_routes/feedBeta/params.js';

function row(id, opts = {}) {
	const {
		mediaType = 'image',
		videoUrl = '',
		ageHours = 12,
		likes = 0,
		comments = 0,
		userId = 1,
		newcomer = false
	} = opts;
	const created = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
	const meta =
		mediaType === 'video'
			? { media_type: 'video', video: { file_path: videoUrl || '/v.mp4' } }
			: { media_type: 'image' };
	return {
		created_image_id: id,
		id,
		created_at: created,
		user_id: userId,
		meta,
		like_count: likes,
		comment_count: comments
	};
}

describe('drawThreadPageFromCatalog', () => {
	const ctx = {
		nowMs: Date.now(),
		followingIds: new Set(['99']),
		newcomerAuthorIds: new Set(['50']),
		newcomerHandles: new Set(['newbie']),
		params: FEED_BETA_DEFAULT_PARAMS
	};

	test('uses pool draws on page 2 (not score-slice pagination)', () => {
		const catalog = [];
		for (let i = 1; i <= 40; i += 1) {
			catalog.push(
				row(i, {
					mediaType: 'image',
					ageHours: i + 10,
					likes: i % 5,
					userId: i === 5 ? 50 : i
				})
			);
		}
		const page1 = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 8,
			seen: new Set(),
			shuffleSeed: 'test:p1',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 1,
			showOwnPosts: true
		});
		const page2 = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 8,
			seen: new Set(page1.map((r) => String(r.created_image_id))),
			shuffleSeed: 'test:p2',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 1,
			showOwnPosts: true
		});
		expect(page1.length).toBe(8);
		expect(page2.length).toBe(8);
		const overlap = page1.filter((a) =>
			page2.some((b) => b.created_image_id === a.created_image_id)
		);
		expect(overlap.length).toBe(0);
	});

	test('prefers hot and newcomer pools on page 1', () => {
		const catalog = [
			row(1, { ageHours: 2, likes: 80, comments: 10 }),
			row(2, { ageHours: 50, likes: 0 }),
			row(3, { ageHours: 6, likes: 1, userId: 50 }),
			row(4, { ageHours: 100, likes: 200, comments: 40 })
		];
		const out = drawThreadPageFromCatalog(catalog, {
			thread: 'other',
			take: 4,
			seen: new Set(),
			shuffleSeed: 'test:hot',
			scoreContext: ctx,
			enableNsfw: true,
			viewerUserId: 1,
			showOwnPosts: true
		});
		const ids = out.map((r) => r.created_image_id);
		expect(ids).toContain(1);
		expect(ids).toContain(3);
	});
});
