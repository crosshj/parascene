/**
 * Fullscreen doom scroll overlay on chat — preserves underlying lane DOM and scroll position.
 */

import { mountChatDoomScroll, teardownChatDoomScroll } from './doomScrollMount.js';

const OVERLAY_ID = 'chat-doom-scroll-overlay';
export const CHAT_DOOM_OVERLAY_HISTORY_FLAG = 'chatDoomOverlay';
const RETURN_PATH_KEY = 'chatDoomReturnPath';
const STORE_KEY = '__chatDoomScrollOverlay';

/** @returns {{ overlayEl: HTMLElement | null, returnPath: string | null, savedScrollPositions: Array<{ el: HTMLElement, top: number } | { window: true, top: number }>, deferBaseLaneLoad: boolean, loadDeferredLane: (() => void) | null, mountInFlight: Promise<void> | null, startCreationId: number | null }} */
function getStore() {
	if (!window[STORE_KEY]) {
		window[STORE_KEY] = {
			overlayEl: null,
			returnPath: null,
			savedScrollPositions: [],
			deferBaseLaneLoad: false,
			loadDeferredLane: null,
			mountInFlight: null,
			startCreationId: null,
		};
	}
	return window[STORE_KEY];
}

/**
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isChatDoomScrollPath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	return /^\/chat\/c\/feed\/doom\/\d+/.test(p);
}

export function isChatDoomScrollOverlayOpen() {
	const { overlayEl } = getStore();
	return overlayEl instanceof HTMLElement && overlayEl.isConnected;
}

/**
 * True when the overlay has finished mounting slides (not just the cold-load black shell).
 * @param {number} [creationId]
 * @returns {boolean}
 */
export function isChatDoomScrollMountedForCreation(creationId) {
	const store = getStore();
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return false;
	if (!isChatDoomScrollOverlayOpen()) return false;
	if (store.startCreationId !== id) return false;
	return Boolean(store.overlayEl?.querySelector('.chat-doom-scroll-root'));
}

export function isChatDoomScrollOverlayHistoryActive() {
	return Boolean(window.history?.state?.[CHAT_DOOM_OVERLAY_HISTORY_FLAG]) || isChatDoomScrollOverlayOpen();
}

/**
 * Merge doom overlay flags into the next `history.replaceState` (slide URL sync).
 * @param {Record<string, unknown>} [patch]
 */
export function mergeChatDoomScrollHistoryState(patch = {}) {
	const curState = window.history?.state;
	const baseState = curState && typeof curState === 'object' ? curState : {};
	return {
		...baseState,
		prsnChat: true,
		...patch,
	};
}

function captureScrollPositions() {
	const store = getStore();
	store.savedScrollPositions = [];
	const messages = document.querySelector('[data-chat-messages]');
	if (messages instanceof HTMLElement) {
		store.savedScrollPositions.push({ el: messages, top: messages.scrollTop });
	}
	const routeSections = document.querySelectorAll('[data-route-content].active');
	routeSections.forEach((section) => {
		if (!(section instanceof HTMLElement)) return;
		if (section.scrollHeight <= section.clientHeight) return;
		store.savedScrollPositions.push({ el: section, top: section.scrollTop });
	});
	const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
	store.savedScrollPositions.push({ window: true, top: scrollY });
}

function restoreScrollPositions() {
	const store = getStore();
	for (const entry of store.savedScrollPositions) {
		if ('window' in entry && entry.window) {
			window.scrollTo(0, entry.top);
			continue;
		}
		if (entry.el instanceof HTMLElement) {
			entry.el.scrollTop = entry.top;
		}
	}
	store.savedScrollPositions = [];
}

/**
 * @param {number} creationId
 * @returns {string}
 */
function doomUrlForCreationId(creationId) {
	return `/chat/c/feed/doom/${encodeURIComponent(String(creationId))}`;
}

function captureReturnPathBeforeDoomPush() {
	const state = window.history?.state;
	if (
		state &&
		typeof state === 'object' &&
		state[CHAT_DOOM_OVERLAY_HISTORY_FLAG] &&
		typeof state[RETURN_PATH_KEY] === 'string' &&
		state[RETURN_PATH_KEY]
	) {
		return state[RETURN_PATH_KEY];
	}
	return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * @param {string} returnPath
 */
function buildDoomHistoryState(returnPath) {
	const curState = window.history?.state;
	const baseState = curState && typeof curState === 'object' ? curState : {};
	return {
		...baseState,
		prsnChat: true,
		[CHAT_DOOM_OVERLAY_HISTORY_FLAG]: true,
		[RETURN_PATH_KEY]: returnPath,
	};
}

function ensureOverlayElement() {
	const store = getStore();
	let el = document.getElementById(OVERLAY_ID);
	if (!(el instanceof HTMLElement)) {
		el = document.createElement('div');
		el.id = OVERLAY_ID;
		el.className = 'chat-doom-scroll-overlay';
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-modal', 'true');
		document.body.appendChild(el);
	}
	el.style.background = '#000';
	store.overlayEl = el;
	return el;
}

/**
 * Synchronous first paint for cold `/chat/c/feed/doom/:id` loads: black fullscreen layer +
 * `chat-page--doom-scroll` before async chat init finishes (avoids feed chrome flash).
 */
export function primeChatDoomScrollColdLoadShell() {
	if (typeof document === 'undefined' || !document.body) return;
	if (!isChatDoomScrollPath(window.location.pathname)) return;
	if (!isLikelyChatDoomMobileViewport()) return;

	document.body.classList.add('chat-page--doom-scroll');
	const hostEl = ensureOverlayElement();
	const hasContent = hostEl.querySelector(
		'.chat-doom-scroll-root, .chat-doom-scroll-loading, .chat-doom-error'
	);
	if (!hasContent) {
		hostEl.innerHTML =
			'<div class="chat-doom-scroll-loading" aria-busy="true" aria-label="Loading"></div>';
	}
}

function isLikelyChatDoomMobileViewport() {
	try {
		if (window.matchMedia('(max-width: 768px)').matches) return true;
		const ua = String(window.navigator?.userAgent || '').toLowerCase();
		return /android|iphone|ipod|ipad|mobile/.test(ua);
	} catch {
		return false;
	}
}

function schedulePrimeChatDoomScrollColdLoadShell() {
	if (typeof document === 'undefined') return;
	const run = () => {
		try {
			primeChatDoomScrollColdLoadShell();
		} catch {
			// ignore
		}
	};
	if (document.body) run();
	else document.addEventListener('DOMContentLoaded', run, { once: true });
}

schedulePrimeChatDoomScrollColdLoadShell();

/**
 * @param {() => void} fn
 */
export function registerChatDoomScrollDeferredLaneLoader(fn) {
	getStore().loadDeferredLane = typeof fn === 'function' ? fn : null;
}

/**
 * @param {HTMLElement | null | undefined} messagesEl
 * @returns {boolean}
 */
export function chatMessagesHasUnderlyingLane(messagesEl) {
	if (!(messagesEl instanceof HTMLElement)) return false;
	if (messagesEl.querySelector('[data-feed-channel-cards], [data-feed-container]')) return true;
	if (messagesEl.querySelector('.connect-chat-msg[data-chat-message-id]')) return true;
	if (messagesEl.querySelector('.challenge-pane-root')) return true;
	if (messagesEl.querySelector('.chat-comment-row, [data-chat-comments-list]')) return true;
	return false;
}

/**
 * @param {object} [options]
 * @param {number} options.startCreationId
 * @param {object} [options.mountDeps]
 * @param {boolean} [options.deferBaseLaneLoad]
 * @param {boolean} [options.skipHistoryPush]
 */
export async function openChatDoomScrollOverlay(options = {}) {
	const startCreationId = Number(options.startCreationId);
	if (!Number.isFinite(startCreationId) || startCreationId <= 0) return;

	const store = getStore();
	const mountDeps = options.mountDeps && typeof options.mountDeps === 'object' ? options.mountDeps : {};
	const deferBaseLaneLoad = options.deferBaseLaneLoad === true;
	const skipHistoryPush = options.skipHistoryPush === true;

	if (isChatDoomScrollMountedForCreation(startCreationId)) {
		return;
	}

	if (isChatDoomScrollOverlayOpen() && store.startCreationId != null) {
		teardownChatDoomScroll();
	}

	const returnPath = deferBaseLaneLoad ? '/chat/c/feed' : captureReturnPathBeforeDoomPush();
	store.returnPath = returnPath;
	store.deferBaseLaneLoad = deferBaseLaneLoad;
	store.startCreationId = startCreationId;

	if (!skipHistoryPush) {
		try {
			window.history.pushState(buildDoomHistoryState(returnPath), '', doomUrlForCreationId(startCreationId));
		} catch {
			// ignore
		}
	} else if (!window.history?.state?.[CHAT_DOOM_OVERLAY_HISTORY_FLAG]) {
		try {
			window.history.replaceState(buildDoomHistoryState(returnPath), '', window.location.href);
		} catch {
			// ignore
		}
	}

	if (!deferBaseLaneLoad) {
		captureScrollPositions();
	} else {
		store.savedScrollPositions = [];
	}

	const hostEl = ensureOverlayElement();
	hostEl.innerHTML =
		'<div class="chat-doom-scroll-loading route-loading" aria-busy="true" aria-label="Loading"></div>';
	document.body.classList.add('chat-page--doom-scroll');

	const mountPromise = mountChatDoomScroll({
		hostEl,
		startCreationId,
		fetchJsonWithStatusDeduped: mountDeps.fetchJsonWithStatusDeduped,
		getHiddenFeedItems: mountDeps.getHiddenFeedItems,
		viewerUserId: mountDeps.viewerUserId,
		applyComposerState: mountDeps.applyComposerState,
		syncChatBrowseViewBodyClass: mountDeps.syncChatBrowseViewBodyClass,
		onDismiss: dismissChatDoomScrollViaHistory,
	});

	store.mountInFlight = mountPromise;
	try {
		await mountPromise;
	} finally {
		if (store.mountInFlight === mountPromise) {
			store.mountInFlight = null;
		}
	}
}

/**
 * @param {{ fromPopstate?: boolean, skipScrollRestore?: boolean, loadDeferredLane?: boolean }} [options]
 */
export function closeChatDoomScrollOverlay(options = {}) {
	const store = getStore();
	const deferLoad = store.deferBaseLaneLoad;
	const returnPath =
		store.returnPath ||
		(typeof window.history?.state?.[RETURN_PATH_KEY] === 'string'
			? window.history.state[RETURN_PATH_KEY]
			: null);

	teardownChatDoomScroll();

	if (store.overlayEl?.parentNode) {
		store.overlayEl.parentNode.removeChild(store.overlayEl);
	}
	store.overlayEl = null;
	store.startCreationId = null;
	document.body.classList.remove('chat-page--doom-scroll');

	const shouldLoadDeferred = deferLoad && options.loadDeferredLane !== false;
	if (shouldLoadDeferred) {
		store.deferBaseLaneLoad = false;
		store.savedScrollPositions = [];
		if (!options.fromPopstate) {
			try {
				window.history.replaceState({ prsnChat: true }, '', '/chat/c/feed');
			} catch {
				// ignore
			}
		}
		const loader = store.loadDeferredLane;
		if (typeof loader === 'function') {
			void loader();
		}
	} else if (!options.skipScrollRestore) {
		restoreScrollPositions();
		store.deferBaseLaneLoad = false;
	}

	store.returnPath = null;
	if (!shouldLoadDeferred) {
		store.savedScrollPositions = [];
	}

	if (!options.fromPopstate && returnPath && !shouldLoadDeferred && !isChatDoomScrollPath(window.location.pathname)) {
		try {
			const current = window.location.pathname + window.location.search + window.location.hash;
			if (current !== returnPath) {
				window.history.replaceState({ prsnChat: true }, '', returnPath);
			}
		} catch {
			// ignore
		}
	}
}

export function dismissChatDoomScrollViaHistory() {
	if (!isChatDoomScrollOverlayOpen()) return;
	const store = getStore();
	if (store.deferBaseLaneLoad) {
		closeChatDoomScrollOverlay({ loadDeferredLane: true });
		return;
	}
	try {
		window.history.back();
	} catch {
		closeChatDoomScrollOverlay({ skipScrollRestore: false });
	}
}

/**
 * @param {PopStateEvent} [ev]
 * @returns {boolean}
 */
export function handleChatDoomScrollPopstate(ev) {
	if (!isChatDoomScrollOverlayOpen()) return false;

	const state = window.history?.state;
	if (state?.[CHAT_DOOM_OVERLAY_HISTORY_FLAG] && isChatDoomScrollPath(window.location.pathname)) {
		if (ev && typeof ev.stopImmediatePropagation === 'function') {
			ev.stopImmediatePropagation();
		}
		return true;
	}

	closeChatDoomScrollOverlay({ fromPopstate: true, loadDeferredLane: true });
	if (ev && typeof ev.stopImmediatePropagation === 'function') {
		ev.stopImmediatePropagation();
	}
	return true;
}
