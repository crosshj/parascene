/**
 * Chat `#feed` pseudo-channel DOM: card grid shell + infinite-scroll sentinel.
 */

import { createFeedSpotlightVideoTile } from '../../shared/feedCardBuild.js';

const SPOTLIGHT_SLOTS = 4;

/**
 * Mobile-only (CSS): 2×2 strip above the vertical feed — skeleton tiles or image previews.
 * @param {object[]} [spotlightVideos]
 * @param {{ resolveSpotlightHref?: (item: object) => string | undefined, performSpotlightNavigation?: (href: string, ev: MouseEvent) => void }} [tileOptions]
 * @returns {HTMLDivElement}
 */
function createChatFeedMobileSpotlightElement(spotlightVideos = [], tileOptions = {}) {
	const wrap = document.createElement('div');
	wrap.className = 'chat-feed-mobile-spotlight';
	const grid = document.createElement('div');
	grid.className = 'chat-feed-mobile-spotlight-grid';
	const videos = Array.isArray(spotlightVideos) ? spotlightVideos : [];
	for (let i = 0; i < SPOTLIGHT_SLOTS; i += 1) {
		const item = videos[i];
		if (item) {
			grid.appendChild(createFeedSpotlightVideoTile(item, i, tileOptions));
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

function createFeedChannelSentinel() {
	const sentinel = document.createElement('div');
	sentinel.dataset.chatFeedLoadSentinel = '1';
	sentinel.className = 'chat-page-feed-load-sentinel';
	sentinel.setAttribute('aria-hidden', 'true');
	sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
	return sentinel;
}

/**
 * @param {HTMLElement} routeWrap
 */
function stampTailCardsHost(routeWrap) {
	const hosts = routeWrap.querySelectorAll('[data-feed-channel-cards]');
	for (let i = 0; i < hosts.length; i += 1) {
		hosts[i].removeAttribute('data-feed-channel-cards-tail');
	}
	if (hosts.length > 0) {
		hosts[hosts.length - 1].setAttribute('data-feed-channel-cards-tail', '1');
	}
}

/**
 * HTML for the mobile spotlight strip (loading skeleton only). Keeps grid shell in sync with {@link createChatFeedMobileSpotlightElement}.
 * @returns {string}
 */
export function getChatFeedMobileSpotlightHtml() {
	return createChatFeedMobileSpotlightElement([]).outerHTML;
}

/**
 * Mobile: interleaved spotlight strips and card sections from {@link partitionChatFeedMobileAlternating}
 * (between strips: next three non-video creation cards; tail preserves full feed order).
 * @param {Array<{ type: 'spotlight', videos: object[] } | { type: 'cards', items: object[] }>} segments
 * @param {(item: object, index: number) => HTMLElement} renderCard
 * @param {{ resolveSpotlightHref?: (item: object) => string | undefined, performSpotlightNavigation?: (href: string, ev: MouseEvent) => void }} [channelOptions]
 * @returns {{ routeWrap: HTMLDivElement, cards: HTMLDivElement, sentinel: HTMLDivElement }}
 */
export function createChatFeedChannelElementsFromSegments(segments, renderCard, channelOptions = {}) {
	/** @type {{ resolveSpotlightHref?: (item: object) => string | undefined, performSpotlightNavigation?: (href: string, ev: MouseEvent) => void }} */
	const spotlightOpts = {};
	if (typeof channelOptions.resolveSpotlightHref === 'function') {
		spotlightOpts.resolveSpotlightHref = channelOptions.resolveSpotlightHref;
	}
	if (typeof channelOptions.performSpotlightNavigation === 'function') {
		spotlightOpts.performSpotlightNavigation = channelOptions.performSpotlightNavigation;
	}
	const routeWrap = document.createElement('div');
	routeWrap.className = 'feed-route chat-feed-channel-route';
	let cardIndex = 0;
	/** @type {HTMLDivElement | null} */
	let lastCards = null;
	const list = Array.isArray(segments) ? segments : [];
	for (let s = 0; s < list.length; s += 1) {
		const seg = list[s];
		if (!seg || typeof seg !== 'object') continue;
		if (seg.type === 'spotlight') {
			const vids = Array.isArray(seg.videos) ? seg.videos : [];
			routeWrap.appendChild(createChatFeedMobileSpotlightElement(vids, spotlightOpts));
		} else if (seg.type === 'cards') {
			const items = Array.isArray(seg.items) ? seg.items : [];
			if (items.length === 0) continue;
			const cards = document.createElement('div');
			cards.className = 'route-cards feed-cards';
			cards.setAttribute('data-feed-channel-cards', '1');
			for (let i = 0; i < items.length; i += 1) {
				cards.appendChild(renderCard(items[i], cardIndex));
				cardIndex += 1;
			}
			routeWrap.appendChild(cards);
			lastCards = cards;
		}
	}
	stampTailCardsHost(routeWrap);
	const sentinel = createFeedChannelSentinel();
	const tailEl = routeWrap.querySelector('[data-feed-channel-cards-tail]');
	/** @type {HTMLDivElement} */
	const cardsOut =
		tailEl instanceof HTMLDivElement
			? tailEl
			: lastCards ||
				(() => {
					const empty = document.createElement('div');
					empty.className = 'route-cards feed-cards';
					empty.setAttribute('data-feed-channel-cards', '1');
					routeWrap.appendChild(empty);
					stampTailCardsHost(routeWrap);
					return empty;
				})();
	return { routeWrap, cards: cardsOut, sentinel };
}

/**
 * @param {object[]} ordered — feed rows from the pager (`/api/feed`)
 * @param {(item: object, index: number) => HTMLElement} renderCard — typically `createFeedItemCard` + options
 * @param {{ spotlightVideos?: object[], resolveSpotlightHref?: (item: object) => string | undefined }} [options]
 * @returns {{ routeWrap: HTMLDivElement, cards: HTMLDivElement, sentinel: HTMLDivElement }}
 */
export function createChatFeedChannelElements(ordered, renderCard, options = {}) {
	const spotlightVideos = Array.isArray(options.spotlightVideos) ? options.spotlightVideos : [];
	const channelOpts =
		typeof options.resolveSpotlightHref === 'function'
			? { resolveSpotlightHref: options.resolveSpotlightHref }
			: {};
	return createChatFeedChannelElementsFromSegments(
		[
			{ type: 'spotlight', videos: spotlightVideos },
			{ type: 'cards', items: Array.isArray(ordered) ? ordered : [] }
		],
		renderCard,
		channelOpts
	);
}
