/**
 * Chat `#feed` pseudo-channel: fetch paging + item identity (no DOM).
 * Rendering lives in `./feedChannelView.js`.
 */

import { getHiddenFeedItems } from '../../shared/feedCardBuild.js';

export const FEED_CHANNEL_PAGE_SIZE = 20;

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
 */
export function createChatFeedFetchPage(opts) {
	const fetchJsonWithStatusDeduped = opts.fetchJsonWithStatusDeduped;
	const getHidden =
		typeof opts.getHiddenFeedItems === 'function' ? opts.getHiddenFeedItems : getHiddenFeedItems;
	const pageSize =
		typeof opts.pageSize === 'number' && Number.isFinite(opts.pageSize) && opts.pageSize > 0
			? opts.pageSize
			: FEED_CHANNEL_PAGE_SIZE;

	return async function fetchChatFeedPage({ initial, items }) {
		const offset = initial ? 0 : items.length;
		const feed = await fetchJsonWithStatusDeduped(
			`/api/feed?limit=${pageSize}&offset=${offset}`,
			{ credentials: 'include' },
			{ windowMs: 30000 }
		);
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
		return { pageItems, hasMore: Boolean(feed.data?.hasMore) };
	};
}
