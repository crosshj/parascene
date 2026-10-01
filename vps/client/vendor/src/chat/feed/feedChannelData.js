/**
 * Chat `#feed` pseudo-channel: fetch paging + item identity (no DOM).
 * Rendering lives in `./feedChannelView.js`.
 */

import { getHiddenFeedItems } from '../../shared/feedHiddenItems.js';
import { encodeFeedBetaAck } from '../../shared/feedBetaContinuation.js';

export const FEED_CHANNEL_PAGE_SIZE = 28;

/**
 * Stable keys for dedupe across `/api/feed` pages (tips, blog, engagement, creations).
 * @param {object} it
 * @returns {string}
 */
export function getChatFeedItemKey(it) {
	if (it.type === 'tip' || it.type === 'blog_post' || it.type === 'engagement') {
		return `${it.type}:${it.id ?? it.slug ?? it.title ?? ''}`;
	}
	return String(it.created_image_id || it.id || '');
}

/**
 * @param {object|null|undefined} apiCursor — `feed_cursor` from `/api/feed`
 * @returns {{ after_image_created_at: string, after_image_id: string } | null}
 */
export function normalizeFeedCursorFromApi(apiCursor) {
	if (!apiCursor || typeof apiCursor !== 'object') return null;
	const at =
		apiCursor.after_image_created_at != null
			? String(apiCursor.after_image_created_at).trim()
			: '';
	const idRaw = apiCursor.after_image_id;
	const id = idRaw != null ? String(idRaw).trim() : '';
	if (!at || !id) return null;
	return { after_image_created_at: at, after_image_id: id };
}

/**
 * Factory for `createPseudoColumnPager({ fetchPage })` — loads `/api/feed` pages for chat `#feed`.
 *
 * @param {object} opts
 * @param {Function} opts.fetchJsonWithStatusDeduped
 * @param {() => string[]} [opts.getHiddenFeedItems]
 * @param {number} [opts.pageSize]
 * @param {boolean} [opts.mobileChatSlotPack] — chat `#feed` mobile: page 1 `slot_pack`; page 2+ `feed_after_*` from API `feed_cursor` (slot-pack boundary, then server-advanced cursor).
 */
export function createChatFeedFetchPage(opts) {
	const fetchJsonWithStatusDeduped = opts.fetchJsonWithStatusDeduped;
	const getHidden =
		typeof opts.getHiddenFeedItems === 'function' ? opts.getHiddenFeedItems : getHiddenFeedItems;
	const pageSize =
		typeof opts.pageSize === 'number' && Number.isFinite(opts.pageSize) && opts.pageSize > 0
			? opts.pageSize
			: FEED_CHANNEL_PAGE_SIZE;
	const useSlotPack = Boolean(opts.mobileChatSlotPack);
	const cursorRef = { after_image_created_at: null, after_image_id: null };
	let lastFeedBeta = null;

	function applyFeedCursor(cursor) {
		const norm = normalizeFeedCursorFromApi(cursor);
		if (!norm) return;
		cursorRef.after_image_created_at = norm.after_image_created_at;
		cursorRef.after_image_id = norm.after_image_id;
	}

	return async function fetchChatFeedPage({ initial, items }) {
		const qs = new URLSearchParams();
		qs.set('limit', String(pageSize));
		qs.set('feed_surface', 'chat');
		if (useSlotPack && initial) {
			qs.set('slot_pack', 'mobile_chat_v1');
			cursorRef.after_image_created_at = null;
			cursorRef.after_image_id = null;
			lastFeedBeta = null;
		} else if (!initial && cursorRef.after_image_created_at && cursorRef.after_image_id) {
			qs.set('feed_after_image_created_at', cursorRef.after_image_created_at);
			qs.set('feed_after_image_id', cursorRef.after_image_id);
			const ack = encodeFeedBetaAck(lastFeedBeta);
			if (ack) qs.set('feed_beta_ack', ack);
		} else if (!initial && useSlotPack) {
			qs.set('offset', String(items.length));
		} else {
			qs.set('offset', String(initial ? 0 : items.length));
		}

		const feed = await fetchJsonWithStatusDeduped(`/api/feed?${qs.toString()}`, { credentials: 'include' }, { windowMs: 30000 });
		if (!feed.ok) {
			if (initial) {
				const msg = feed.data?.message || feed.data?.error || 'Failed to load feed';
				throw new Error(typeof msg === 'string' ? msg : 'Failed to load feed');
			}
			return { pageItems: [], hasMore: false };
		}
		let pageItems = Array.isArray(feed.data?.items) ? feed.data.items : [];
		const hiddenIds = getHidden();
		pageItems = pageItems.filter((item) => {
			if (item.type === 'tip' || item.type === 'blog_post' || item.type === 'engagement') {
				return true;
			}
			const itemId = String(item.created_image_id || item.id);
			return !hiddenIds.includes(itemId);
		});

		if (feed.data?.feed_cursor) {
			applyFeedCursor(feed.data.feed_cursor);
		}
		if (feed.data?.feed_beta && typeof feed.data.feed_beta === 'object') {
			lastFeedBeta = feed.data.feed_beta;
		}

		return {
			pageItems,
			hasMore: Boolean(feed.data?.hasMore),
			feedBeta: lastFeedBeta
		};
	};
}
