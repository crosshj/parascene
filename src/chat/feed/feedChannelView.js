/**
 * Chat `#feed` pseudo-channel DOM: card grid shell + infinite-scroll sentinel.
 */

import { createFeedSpotlightVideoTile } from '../../shared/feedCardBuild.js';

const SPOTLIGHT_SLOTS = 4;

/**
 * Mobile-only (CSS): 2×2 strip above the vertical feed — skeleton tiles or image previews.
 * @param {object[]} [spotlightVideos]
 * @returns {HTMLDivElement}
 */
function createChatFeedMobileSpotlightElement(spotlightVideos = []) {
	const wrap = document.createElement('div');
	wrap.className = 'chat-feed-mobile-spotlight';
	const grid = document.createElement('div');
	grid.className = 'chat-feed-mobile-spotlight-grid';
	const videos = Array.isArray(spotlightVideos) ? spotlightVideos : [];
	for (let i = 0; i < SPOTLIGHT_SLOTS; i += 1) {
		const item = videos[i];
		if (item) {
			grid.appendChild(createFeedSpotlightVideoTile(item, i));
		} else {
			const cell = document.createElement('div');
			cell.className = 'chat-feed-mobile-spotlight-cell chat-feed-mobile-spotlight-cell--placeholder';
			cell.setAttribute('aria-hidden', 'true');
			const thumb = document.createElement('div');
			thumb.className = 'skeleton-feed-card-image chat-feed-mobile-spotlight-cell-thumb';
			cell.appendChild(thumb);
			grid.appendChild(cell);
		}
	}
	wrap.appendChild(grid);
	return wrap;
}

/**
 * HTML for the mobile spotlight strip (loading skeleton only). Keeps grid shell in sync with {@link createChatFeedMobileSpotlightElement}.
 * @returns {string}
 */
export function getChatFeedMobileSpotlightHtml() {
	return createChatFeedMobileSpotlightElement([]).outerHTML;
}

/**
 * @param {object[]} ordered — feed rows from the pager (`/api/feed`)
 * @param {(item: object, index: number) => HTMLElement} renderCard — typically `createFeedItemCard` + options
 * @param {{ spotlightVideos?: object[] }} [options]
 * @returns {{ routeWrap: HTMLDivElement, cards: HTMLDivElement, sentinel: HTMLDivElement }}
 */
export function createChatFeedChannelElements(ordered, renderCard, options = {}) {
	const spotlightVideos = Array.isArray(options.spotlightVideos) ? options.spotlightVideos : [];
	const routeWrap = document.createElement('div');
	routeWrap.className = 'feed-route chat-feed-channel-route';
	routeWrap.appendChild(createChatFeedMobileSpotlightElement(spotlightVideos));
	const cards = document.createElement('div');
	cards.className = 'route-cards feed-cards';
	cards.setAttribute('data-feed-channel-cards', '1');
	for (let i = 0; i < ordered.length; i++) {
		cards.appendChild(renderCard(ordered[i], i));
	}
	routeWrap.appendChild(cards);

	const sentinel = document.createElement('div');
	sentinel.dataset.chatFeedLoadSentinel = '1';
	sentinel.className = 'chat-page-feed-load-sentinel';
	sentinel.setAttribute('aria-hidden', 'true');
	sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';

	return { routeWrap, cards, sentinel };
}
