/**
 * Chat `#feed` only: challenge engagement loads after the main feed response.
 */

import { isChatFeedChallengePlaceholder } from '../../shared/chatFeedMobilePartition.js';

/**
 * @param {Function} fetchJson
 * @returns {Promise<object|null>}
 */
export async function fetchChatFeedChallengeEngagement(fetchJson) {
	const res = await fetchJson('/api/feed/challenge-engagement', { credentials: 'include' });
	if (!res?.ok) return null;
	const item = res.data?.item;
	return item && typeof item === 'object' ? item : null;
}

/**
 * @returns {HTMLDivElement}
 */
export function createChatFeedChallengePlaceholderElement() {
	const el = document.createElement('div');
	el.className = 'feed-card feed-card-challenge-placeholder route-card';
	el.dataset.chatFeedChallengeSlot = '1';
	el.setAttribute('aria-busy', 'true');
	el.setAttribute('aria-label', 'Loading community challenge');
	el.innerHTML = `<div class="skeleton-feed-card feed-card-challenge-placeholder-skeleton" aria-hidden="true">
		<div class="skeleton-feed-card-image"></div>
		<div class="skeleton-feed-card-footer">
			<div class="skeleton-feed-card-content">
				<div class="skeleton-line skeleton-line--title"></div>
				<div class="skeleton-line skeleton-line--subtitle"></div>
			</div>
		</div>
	</div>`;
	return el;
}

/**
 * @param {HTMLElement|null|undefined} messagesEl
 * @param {HTMLElement|null|undefined} routeWrap
 * @returns {HTMLElement|null}
 */
function findChatFeedChallengeSlot(messagesEl, routeWrap) {
	if (messagesEl instanceof HTMLElement) {
		const inMessages = messagesEl.querySelector('[data-chat-feed-challenge-slot]');
		if (inMessages instanceof HTMLElement) return inMessages;
	}
	if (routeWrap instanceof HTMLElement) {
		const inRoute = routeWrap.querySelector('[data-chat-feed-challenge-slot]');
		if (inRoute instanceof HTMLElement) return inRoute;
	}
	return null;
}

/**
 * Desktop chat: reserve a skeleton in the first card strip before fetch completes.
 *
 * @param {HTMLElement|null|undefined} routeWrap
 */
export function ensureChatFeedChallengeDesktopSkeleton(routeWrap) {
	if (!(routeWrap instanceof HTMLElement)) return;
	if (routeWrap.querySelector('[data-chat-feed-challenge-slot]')) return;
	const cards = routeWrap.querySelector('[data-feed-channel-cards]');
	if (!(cards instanceof HTMLElement)) return;
	const sk = createChatFeedChallengePlaceholderElement();
	const idx = Math.min(1, cards.children.length);
	const ref = cards.children[idx];
	if (ref) cards.insertBefore(sk, ref);
	else cards.appendChild(sk);
}

/**
 * @param {HTMLElement|null|undefined} messagesEl
 * @param {HTMLElement|null|undefined} routeWrap
 * @param {object|null} item
 * @param {(item: object, index: number) => HTMLElement} renderCard
 * @returns {boolean}
 */
export function fillChatFeedChallengePlaceholder(messagesEl, routeWrap, item, renderCard) {
	const slot = findChatFeedChallengeSlot(messagesEl, routeWrap);
	if (!slot) return false;
	if (!item) {
		slot.remove();
		return false;
	}
	slot.replaceWith(renderCard(item, -1));
	return true;
}

/**
 * @param {HTMLElement} routeWrap
 * @param {object} item
 * @param {(item: object, index: number) => HTMLElement} renderCard
 * @returns {boolean}
 */
export function injectChatFeedChallengeDesktop(routeWrap, item, renderCard) {
	if (!(routeWrap instanceof HTMLElement) || !item) return false;
	const slot = findChatFeedChallengeSlot(null, routeWrap);
	if (slot) {
		slot.replaceWith(renderCard(item, -1));
		return true;
	}
	const cards = routeWrap.querySelector('[data-feed-channel-cards]');
	if (!(cards instanceof HTMLElement)) return false;
	const card = renderCard(item, 0);
	const slotName = typeof item.slot === 'string' ? item.slot.trim().toLowerCase() : 'after_first';
	let idx = 0;
	if (slotName === 'after_first') idx = Math.min(1, cards.children.length);
	else if (slotName === 'after_second') idx = Math.min(2, cards.children.length);
	else if (slotName === 'after_fifth') idx = Math.min(5, cards.children.length);
	const ref = cards.children[idx];
	if (ref) cards.insertBefore(card, ref);
	else cards.appendChild(card);
	return true;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.messagesEl
 * @param {HTMLElement} opts.routeWrap
 * @param {boolean} opts.mobileLayout
 * @param {Function} opts.fetchJson
 * @param {(item: object, index: number) => HTMLElement} opts.renderCard
 * @param {() => boolean} [opts.isStale]
 */
export async function loadDeferredChatFeedChallenge(opts) {
	const { messagesEl, routeWrap, mobileLayout, fetchJson, renderCard, isStale } = opts;
	if (!mobileLayout) {
		ensureChatFeedChallengeDesktopSkeleton(routeWrap);
	}
	try {
		const item = await fetchChatFeedChallengeEngagement(fetchJson);
		if (typeof isStale === 'function' && isStale()) return;
		if (mobileLayout) {
			fillChatFeedChallengePlaceholder(messagesEl, routeWrap, item, renderCard);
			return;
		}
		if (item) {
			injectChatFeedChallengeDesktop(routeWrap, item, renderCard);
			return;
		}
		findChatFeedChallengeSlot(messagesEl, routeWrap)?.remove();
	} catch (err) {
		console.warn('[Chat feed] challenge engagement', err?.message || err);
		findChatFeedChallengeSlot(messagesEl, routeWrap)?.remove();
	}
}

export { isChatFeedChallengePlaceholder };
