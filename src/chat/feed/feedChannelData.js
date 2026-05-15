/**
 * Chat `#feed` pseudo-channel: fetch paging + item identity (no DOM).
 * Rendering lives in `./feedChannelView.js`.
 */

import { getHiddenFeedItems } from '../../shared/feedHiddenItems.js';

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
 * Factory for `createPseudoColumnPager({ fetchPage })` — loads `/api/feed` pages for chat `#feed`.
 *
 * @param {object} opts
 * @param {Function} opts.fetchJsonWithStatusDeduped
 * @param {() => string[]} [opts.getHiddenFeedItems]
 * @param {number} [opts.pageSize]
 * @param {boolean} [opts.mobileChatSlotPack] — chat `#feed` only: server composes video/image mix (`slot_pack=mobile_chat_v1`) + cursor paging; UI only groups spotlight on narrow viewports
 * @param {boolean} [opts.videosOnly] — doom scroll: `/api/feed?creation_media=video` (newest-first video creations only)
 */
export function createChatFeedFetchPage(opts) {
	const fetchJsonWithStatusDeduped = opts.fetchJsonWithStatusDeduped;
	const getHidden =
		typeof opts.getHiddenFeedItems === 'function' ? opts.getHiddenFeedItems : getHiddenFeedItems;
	const pageSize =
		typeof opts.pageSize === 'number' && Number.isFinite(opts.pageSize) && opts.pageSize > 0
			? opts.pageSize
			: FEED_CHANNEL_PAGE_SIZE;
	const useSlotPack = Boolean(opts.mobileChatSlotPack) && !opts.videosOnly;
	const videosOnly = Boolean(opts.videosOnly);
	const cursorRef = { after_image_created_at: null, after_image_id: null };

	return async function fetchChatFeedPage({ initial, items }) {
		const qs = new URLSearchParams();
		qs.set('limit', String(pageSize));
		if (videosOnly) {
			qs.set('creation_media', 'video');
			qs.set('offset', String(initial ? 0 : items.length));
		} else {
			qs.set('feed_surface', 'chat');
		}
		if (useSlotPack) {
			qs.set('slot_pack', 'mobile_chat_v1');
			if (initial) {
				cursorRef.after_image_created_at = null;
				cursorRef.after_image_id = null;
			}
			if (!initial && cursorRef.after_image_created_at && cursorRef.after_image_id) {
				qs.set('feed_after_image_created_at', cursorRef.after_image_created_at);
				qs.set('feed_after_image_id', cursorRef.after_image_id);
			} else if (!initial) {
				qs.set('offset', String(items.length));
			}
		} else if (!useSlotPack) {
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
		if (useSlotPack && feed.data?.feed_cursor) {
			const fc = feed.data.feed_cursor;
			cursorRef.after_image_created_at =
				fc.after_image_created_at != null ? String(fc.after_image_created_at) : null;
			cursorRef.after_image_id = fc.after_image_id != null ? String(fc.after_image_id) : null;
		}
		let pageItems = Array.isArray(feed.data?.items) ? feed.data.items : [];
		const hiddenIds = getHidden();
		pageItems = pageItems.filter((item) => {
			if (videosOnly) {
				const itemId = String(item.created_image_id || item.id);
				return itemId && !hiddenIds.includes(itemId);
			}
			if (item.type === 'tip' || item.type === 'blog_post' || item.type === 'engagement') {
				return true;
			}
			const itemId = String(item.created_image_id || item.id);
			return !hiddenIds.includes(itemId);
		});
		return { pageItems, hasMore: Boolean(feed.data?.hasMore) };
	};
}
