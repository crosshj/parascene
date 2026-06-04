/**
 * Sitewide feed_items queries for Feed [beta] ranking (no follow exclusion).
 * @param {import('@supabase/supabase-js').SupabaseClient} serviceClient
 * @param {{ prefixedTable: (name: string) => string, resolveFeedRowTitle: Function, getThumbnailUrl: Function }} deps
 */
import { createSeededRng, shuffleInPlace } from '../api_routes/feedBeta/rng.js';

export function createSelectFeedBetaSitewideCatalog(serviceClient, deps) {
	const { prefixedTable, resolveFeedRowTitle, getThumbnailUrl } = deps;
	const BETA_COLS =
		'id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)';

	/**
	 * @param {number|null|undefined} viewerId
	 * @param {object[]} rawData
	 */
	async function hydrateRows(viewerId, rawData) {
		const page = (Array.isArray(rawData) ? rawData : [])
			.map((row) => {
				const { prsn_created_images, ...rest } = row;
				const filename = prsn_created_images?.filename ?? null;
				const file_path = prsn_created_images?.file_path ?? null;
				const user_id = prsn_created_images?.user_id ?? null;
				let meta = prsn_created_images?.meta ?? null;
				if (typeof meta === 'string' && meta) {
					try {
						meta = JSON.parse(meta);
					} catch {
						meta = null;
					}
				}
				const nsfw = !!(meta && typeof meta === 'object' && meta.nsfw);
				const videoPath =
					meta && typeof meta === 'object' && meta.video && typeof meta.video.file_path === 'string'
						? meta.video.file_path.trim()
						: '';
				let resolvedUrl = file_path || (filename ? `/api/images/created/${filename}` : null);
				if (!resolvedUrl && videoPath) {
					resolvedUrl = videoPath;
				}
				const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
				return {
					...rest,
					title,
					filename,
					user_id,
					meta,
					nsfw,
					url: resolvedUrl,
					thumbnail_url: getThumbnailUrl(resolvedUrl),
					like_count: 0,
					comment_count: 0,
					viewer_liked: false
				};
			})
			.filter((item) => {
				if (item?.user_id == null) return false;
				if (typeof item.url === 'string' && item.url.length > 0) return true;
				let meta = item.meta;
				if (typeof meta === 'string' && meta) {
					try {
						meta = JSON.parse(meta);
					} catch {
						meta = null;
					}
				}
				const videoPath =
					meta && typeof meta === 'object' && meta.video && typeof meta.video.file_path === 'string'
						? meta.video.file_path.trim()
						: '';
				return Boolean(videoPath);
			});

		const createdImageIds = page
			.map((item) => item.created_image_id)
			.filter((cid) => cid !== null && cid !== undefined);
		if (createdImageIds.length === 0) return page;

		const id = viewerId ?? null;
		const [countResult, commentResult, likedResult, profileResult] = await Promise.all([
			serviceClient
				.from(prefixedTable('created_image_like_counts'))
				.select('created_image_id, like_count')
				.in('created_image_id', createdImageIds),
			serviceClient
				.from(prefixedTable('created_image_comment_counts'))
				.select('created_image_id, comment_count')
				.in('created_image_id', createdImageIds),
			id != null
				? serviceClient
						.from(prefixedTable('likes_created_image'))
						.select('created_image_id')
						.eq('user_id', id)
						.in('created_image_id', createdImageIds)
				: Promise.resolve({ data: [], error: null }),
			(() => {
				const authorIds = [
					...new Set(
						page
							.map((item) => item.user_id)
							.filter((uid) => uid != null && Number.isFinite(Number(uid)))
							.map((uid) => Number(uid))
							.filter((uid) => uid > 0)
					)
				];
				if (authorIds.length === 0) {
					return Promise.resolve({ data: [], error: null });
				}
				return serviceClient
					.from(prefixedTable('user_profiles'))
					.select('user_id, user_name, display_name, avatar_url')
					.in('user_id', authorIds);
			})()
		]);

		if (countResult.error) throw countResult.error;
		if (commentResult.error) throw commentResult.error;
		if (likedResult.error) throw likedResult.error;
		if (profileResult.error) throw profileResult.error;

		const countById = new Map(
			(countResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
		);
		const commentCountById = new Map(
			(commentResult.data ?? []).map((row) => [
				String(row.created_image_id),
				Number(row.comment_count ?? 0)
			])
		);
		const likedIdSet = likedResult.data?.length
			? new Set((likedResult.data ?? []).map((row) => String(row.created_image_id)))
			: null;
		const profileByUserId = new Map(
			(profileResult.data ?? []).map((row) => [String(row.user_id), row])
		);

		return page.map((item) => {
			const key = item.created_image_id != null ? String(item.created_image_id) : null;
			const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
			return {
				...item,
				like_count: key ? (countById.get(key) ?? 0) : 0,
				comment_count: key ? (commentCountById.get(key) ?? 0) : 0,
				viewer_liked: key && likedIdSet ? likedIdSet.has(key) : false,
				author_user_name: profile?.user_name ?? null,
				author_display_name: profile?.display_name ?? null,
				author_avatar_url: profile?.avatar_url ?? null
			};
		});
	}

	async function fetchFeedItemRows(viewerId, builder) {
		const { data, error } = await builder();
		if (error) throw error;
		return hydrateRows(viewerId, data);
	}

	async function getRecent(viewerId, { limit = 500 } = {}) {
		const lim = Math.min(Math.max(1, Number(limit) || 500), 600);
		return fetchFeedItemRows(viewerId, () =>
			serviceClient
				.from(prefixedTable('feed_items'))
				.select(BETA_COLS)
				.not('prsn_created_images.user_id', 'is', null)
				.is('prsn_created_images.unavailable_at', null)
				.order('created_at', { ascending: false })
				.limit(lim)
		);
	}

	return {
		getRecent,

		getTopEngaged: async (viewerId, { limit = 200 } = {}) => {
			const lim = Math.min(Math.max(1, Number(limit) || 200), 300);
			const { data: likeRows, error: likeErr } = await serviceClient
				.from(prefixedTable('created_image_like_counts'))
				.select('created_image_id, like_count')
				.order('like_count', { ascending: false })
				.limit(lim * 2);
			if (likeErr) throw likeErr;
			const ids = (Array.isArray(likeRows) ? likeRows : [])
				.map((r) => r.created_image_id)
				.filter((id) => id != null);
			if (ids.length === 0) return [];

			const rows = await fetchFeedItemRows(viewerId, () =>
				serviceClient
					.from(prefixedTable('feed_items'))
					.select(BETA_COLS)
					.in('created_image_id', ids)
					.not('prsn_created_images.user_id', 'is', null)
					.is('prsn_created_images.unavailable_at', null)
			);

			const likeRank = new Map(
				(likeRows ?? []).map((r, i) => [String(r.created_image_id), i])
			);
			return rows
				.slice()
				.sort((a, b) => {
					const ar = likeRank.get(String(a.created_image_id)) ?? 9999;
					const br = likeRank.get(String(b.created_image_id)) ?? 9999;
					return ar - br;
				})
				.slice(0, lim);
		},

		getBackCatalogSlice: async (viewerId, { olderThanIso, offset = 0, limit = 300 } = {}) => {
			const lim = Math.min(Math.max(1, Number(limit) || 300), 400);
			const off = Math.max(0, Number(offset) || 0);
			const cutoff = String(olderThanIso || '').trim();
			if (!cutoff) return [];

			return fetchFeedItemRows(viewerId, () =>
				serviceClient
					.from(prefixedTable('feed_items'))
					.select(BETA_COLS)
					.not('prsn_created_images.user_id', 'is', null)
					.is('prsn_created_images.unavailable_at', null)
					.lt('created_at', cutoff)
					.order('created_at', { ascending: false })
					.range(off, off + lim - 1)
			);
		},

		/**
		 * Seeded random window into published feed_items (for pool-exhaustion backfill).
		 * @param {number|null|undefined} viewerId
		 * @param {{ seed?: string, limit?: number }} [opts]
		 */
		getRandomSlice: async (viewerId, { seed = '', limit = 40 } = {}) => {
			const lim = Math.min(Math.max(1, Number(limit) || 40), 400);
			const { count, error: countErr } = await serviceClient
				.from(prefixedTable('feed_items'))
				.select('id, prsn_created_images!inner(id)', { count: 'exact', head: true })
				.not('prsn_created_images.user_id', 'is', null)
				.is('prsn_created_images.unavailable_at', null);
			if (countErr) throw countErr;

			const total = Math.max(0, Number(count) || 0);
			if (total === 0) return [];

			const rng = createSeededRng(String(seed ?? viewerId ?? 'random'));
			const windowSize = Math.min(Math.max(lim * 2, lim), total, 600);
			const maxOffset = Math.max(0, total - windowSize);
			const offset = maxOffset > 0 ? Math.floor(rng() * (maxOffset + 1)) : 0;

			const rows = await fetchFeedItemRows(viewerId, () =>
				serviceClient
					.from(prefixedTable('feed_items'))
					.select(BETA_COLS)
					.not('prsn_created_images.user_id', 'is', null)
					.is('prsn_created_images.unavailable_at', null)
					.order('created_at', { ascending: false })
					.range(offset, offset + windowSize - 1)
			);

			shuffleInPlace(rows, rng);
			return rows.slice(0, lim);
		},

		getCandidates: (viewerId, opts = {}) => getRecent(viewerId, opts),

		/** Published sitewide feed_items count (available creations). Used for hasMore exhaustion. */
		getPublishedCount: async () => {
			const { count, error } = await serviceClient
				.from(prefixedTable('feed_items'))
				.select('id, prsn_created_images!inner(id)', { count: 'exact', head: true })
				.not('prsn_created_images.user_id', 'is', null)
				.is('prsn_created_images.unavailable_at', null);
			if (error) throw error;
			return Math.max(0, Number(count) || 0);
		}
	};
}
