/**
 * Chat `#feed` pseudo-channel DOM: card grid shell + infinite-scroll sentinel.
 */

/**
 * @param {object[]} ordered — feed rows from the pager (`/api/feed`)
 * @param {(item: object, index: number) => HTMLElement} renderCard — typically `createFeedItemCard` + options
 * @returns {{ routeWrap: HTMLDivElement, cards: HTMLDivElement, sentinel: HTMLDivElement }}
 */
export function createChatFeedChannelElements(ordered, renderCard) {
	const routeWrap = document.createElement('div');
	routeWrap.className = 'feed-route chat-feed-channel-route';
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
