import { getHiddenFeedItems } from '../../shared/feedHiddenItems.js';

export const DOOM_FEED_PAGE_SIZE = 28;

/**
 * Doom mount list: anchor at index 0, then older videos in server order.
 * Drops any rows before the anchor (newer than anchor) if the API ever sent them.
 *
 * @param {object[]} items
 * @param {number} startCreationId
 * @returns {object[]}
 */
export function normalizeDoomAnchorMountItems(items, startCreationId) {
	const anchorId = Number(startCreationId);
	const list = Array.isArray(items) ? items.slice() : [];
	const idx = list.findIndex((it) => Number(it?.created_image_id ?? it?.id) === anchorId);
	if (idx < 0) return list;
	if (idx === 0) return list;
	return [list[idx], ...list.slice(idx + 1)];
}

function normalizeDoomCursorFromApi(cursor) {
	if (!cursor || typeof cursor !== 'object') return null;
	const id = cursor.after_created_image_id != null
		? String(cursor.after_created_image_id).trim()
		: '';
	return id || null;
}

function inferCursorFromItems(items) {
	const list = Array.isArray(items) ? items : [];
	if (list.length === 0) return null;
	const last = list[list.length - 1];
	const id = last?.created_image_id ?? last?.id;
	if (!Number.isFinite(Number(id))) return null;
	return String(id);
}

export function createDoomFeedPager(opts) {
	const fetchJsonWithStatusDeduped = opts.fetchJsonWithStatusDeduped;
	const getHidden =
		typeof opts.getHiddenFeedItems === 'function' ? opts.getHiddenFeedItems : getHiddenFeedItems;
	const pageSize =
		typeof opts.pageSize === 'number' && Number.isFinite(opts.pageSize) && opts.pageSize > 0
			? opts.pageSize
			: DOOM_FEED_PAGE_SIZE;
	const cursorRef = { afterCreatedImageId: null };

	async function pullPage(queryParams) {
		const qs = new URLSearchParams();
		qs.set('limit', String(pageSize));
		Object.entries(queryParams).forEach(([k, v]) => {
			if (v == null || String(v).trim() === '') return;
			qs.set(k, String(v));
		});
		const res = await fetchJsonWithStatusDeduped(
			`/api/feed/doom?${qs.toString()}`,
			{ credentials: 'include' },
			{ windowMs: 30000 }
		);
		if (!res.ok) {
			const msg = res.data?.message || res.data?.error || 'Failed to load doom timeline';
			throw new Error(typeof msg === 'string' ? msg : 'Failed to load doom timeline');
		}
		const items = Array.isArray(res.data?.items) ? res.data.items : [];
		const hiddenIds = getHidden();
		const pageItems = items.filter((item) => {
			const itemId = String(item?.created_image_id ?? item?.id ?? '').trim();
			return itemId && !hiddenIds.includes(itemId);
		});
		const apiCursor = normalizeDoomCursorFromApi(res.data?.cursor);
		cursorRef.afterCreatedImageId = apiCursor || inferCursorFromItems(items) || null;
		return { pageItems, hasMore: Boolean(res.data?.hasMore) };
	}

	return {
		async fetchMountPage(startCreationId) {
			const cid = Number(startCreationId);
			if (!Number.isFinite(cid) || cid <= 0) {
				throw new Error('Invalid doom start creation id');
			}
			cursorRef.afterCreatedImageId = null;
			return pullPage({ start: String(cid) });
		},
		async fetchOlderPage() {
			const cursor = cursorRef.afterCreatedImageId;
			if (!cursor) return { pageItems: [], hasMore: false };
			return pullPage({ after_created_image_id: cursor });
		}
	};
}
