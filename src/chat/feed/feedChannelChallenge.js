/**
 * Chat `#feed` only: challenge engagement loads after the main feed response.
 */

import { isChatFeedChallengePlaceholder } from '../../shared/chatFeedMobilePartition.js';
import { hydrateChallengeFeedCardThumbsLikePane } from '../../shared/challengeHistoryThumb.js';

export const CHAT_FEED_CHALLENGE_ENGAGEMENT_URL = '/api/feed/challenge-engagement';

/**
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function challengeEngagementItemsEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

/**
 * Read cached challenge engagement from the app service-worker data cache (if any).
 *
 * @returns {Promise<object|null>}
 */
export async function readChallengeEngagementFromSwCache() {
	if (typeof caches === 'undefined' || typeof window === 'undefined') return null;
	try {
		const keys = await caches.keys();
		const cacheName = keys.find((name) => /^parascene-data-v/.test(name));
		if (!cacheName) return null;
		const cache = await caches.open(cacheName);
		const requestUrl = new URL(CHAT_FEED_CHALLENGE_ENGAGEMENT_URL, window.location.origin).href;
		const cached = await cache.match(requestUrl);
		if (!cached?.ok) return null;
		const data = await cached.json();
		const item = data?.item;
		return item && typeof item === 'object' ? item : null;
	} catch {
		return null;
	}
}

/**
 * @param {Function} fetchJson
 * @returns {Promise<object|null>}
 */
export async function fetchChatFeedChallengeEngagement(fetchJson) {
	const res = await fetchJson(CHAT_FEED_CHALLENGE_ENGAGEMENT_URL, { credentials: 'include' });
	if (!res?.ok) return null;
	const item = res.data?.item;
	return item && typeof item === 'object' ? item : null;
}

/**
 * @returns {HTMLDivElement}
 */
export function createChatFeedChallengePlaceholderElement() {
	const el = document.createElement('div');
	el.className = 'feed-card feed-card-engagement feed-card-challenge-loading';
	el.dataset.chatFeedChallengeSlot = '1';
	el.setAttribute('aria-busy', 'true');
	el.setAttribute('aria-label', 'Loading community challenge');

	const shell = document.createElement('div');
	shell.className =
		'feed-card-engagement-inner feed-card-engagement-inner-challenge feed-card-engagement-inner-challenge--loading skeleton';
	shell.setAttribute('aria-hidden', 'true');
	/* Inline so height holds before chat.bundle.css picks up page rules. */
	shell.style.minHeight = '370px';
	shell.style.padding = '0';
	shell.style.background = 'var(--skeleton)';
	shell.style.border = 'none';
	shell.style.boxShadow = 'none';

	el.appendChild(shell);
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
 * @param {object} item
 * @param {(item: object, index: number) => HTMLElement} renderCard
 * @returns {HTMLElement}
 */
function renderChatFeedChallengeCard(item, renderCard) {
	const card = renderCard(item, -1);
	if (card instanceof HTMLElement) {
		card.dataset.chatFeedChallengeSlot = '1';
	}
	return card;
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
	slot.replaceWith(renderChatFeedChallengeCard(item, renderCard));
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
		slot.replaceWith(renderChatFeedChallengeCard(item, renderCard));
		return true;
	}
	const cards = routeWrap.querySelector('[data-feed-channel-cards]');
	if (!(cards instanceof HTMLElement)) return false;
	const card = renderChatFeedChallengeCard(item, renderCard);
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
 * @param {HTMLElement|null|undefined} messagesEl
 * @param {HTMLElement|null|undefined} routeWrap
 * @param {boolean} mobileLayout
 * @param {object|null} item
 * @param {(item: object, index: number) => HTMLElement} renderCard
 * @returns {boolean}
 */
function mountChatFeedChallengeItem(messagesEl, routeWrap, mobileLayout, item, renderCard) {
	if (!item) return false;
	if (mobileLayout) {
		return fillChatFeedChallengePlaceholder(messagesEl, routeWrap, item, renderCard);
	}
	return injectChatFeedChallengeDesktop(routeWrap, item, renderCard);
}

/**
 * @param {HTMLElement|null|undefined} messagesEl
 * @param {HTMLElement|null|undefined} routeWrap
 * @param {Function} fetchJson
 */
function hydrateMountedChatFeedChallengeCard(messagesEl, routeWrap, fetchJson) {
	const slot = findChatFeedChallengeSlot(messagesEl, routeWrap);
	if (!(slot instanceof HTMLElement)) return;
	if (slot.classList.contains('feed-card-challenge-loading')) return;
	void hydrateChallengeFeedCardThumbsLikePane(slot, fetchJson);
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

	const staleItem = await readChallengeEngagementFromSwCache();
	if (staleItem) {
		if (typeof isStale === 'function' && isStale()) return;
		mountChatFeedChallengeItem(messagesEl, routeWrap, mobileLayout, staleItem, renderCard);
		hydrateMountedChatFeedChallengeCard(messagesEl, routeWrap, fetchJson);
	} else if (!mobileLayout) {
		ensureChatFeedChallengeDesktopSkeleton(routeWrap);
	}

	try {
		const item = await fetchChatFeedChallengeEngagement(fetchJson);
		if (typeof isStale === 'function' && isStale()) return;

		if (!item) {
			findChatFeedChallengeSlot(messagesEl, routeWrap)?.remove();
			return;
		}

		if (challengeEngagementItemsEqual(staleItem, item)) return;

		mountChatFeedChallengeItem(messagesEl, routeWrap, mobileLayout, item, renderCard);
		hydrateMountedChatFeedChallengeCard(messagesEl, routeWrap, fetchJson);
	} catch (err) {
		console.warn('[Chat feed] challenge engagement', err?.message || err);
		if (!staleItem) {
			findChatFeedChallengeSlot(messagesEl, routeWrap)?.remove();
		}
	}
}

export { isChatFeedChallengePlaceholder };
