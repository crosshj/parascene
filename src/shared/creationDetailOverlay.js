/**
 * Opens creation detail in a full-viewport iframe overlay on SPA shells (feed, explore, chat lanes).
 * Address bar uses canonical `/creations/:id`; browser back closes overlay and restores the lane URL.
 */

const OVERLAY_ID = 'prsn-creation-detail-overlay';
const SHELL_OUT_VEIL_ID = 'prsn-creation-detail-shell-out-veil';
const HISTORY_FLAG = 'prsnCreationDetailOverlay';
const OVERLAY_STORE_KEY = '__prsnCreationDetailOverlay';

/** @returns {{ overlayEl: HTMLElement | null, overlayFrame: HTMLIFrameElement | null, overlayCreationId: number | null, overlayReturnPath: string | null, overlaySavedScrollPositions: Array<{ el: HTMLElement, top: number } | { window: true, top: number }>, overlayBodyScrollLockTop: number | null }} */
function getOverlayStore() {
	if (!window[OVERLAY_STORE_KEY]) {
		window[OVERLAY_STORE_KEY] = {
			overlayEl: null,
			overlayFrame: null,
			overlayCreationId: null,
			overlayReturnPath: null,
			overlaySavedScrollPositions: [],
			overlayBodyScrollLockTop: null,
		};
	}
	return window[OVERLAY_STORE_KEY];
}

function isStandaloneCreationDetailPage() {
	return (
		document.body.classList.contains('creation-detail-page') &&
		!document.body.classList.contains('creation-detail-embed')
	);
}

function isChatPageShell() {
	return (
		document.body?.classList?.contains('chat-page') ||
		document.documentElement?.classList?.contains('chat-page') ||
		document.body?.dataset?.entry === 'chat'
	);
}

function isOverlayCapableShell() {
	if (isStandaloneCreationDetailPage()) return false;
	if (isChatPageShell()) return true;
	const entry = document.body?.dataset?.entry;
	return entry === 'app' || entry === 'app-admin';
}

function isChatDoomScrollPath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	return /^\/chat\/c\/feed\/doom\/\d+/.test(p);
}

function isOverlayLanePath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	if (/^\/creations\/\d+(\/(edit|mutate))?$/.test(p)) {
		return Boolean(window.history?.state?.[HISTORY_FLAG]);
	}
	if (document.body?.classList?.contains('chat-page--doom-scroll')) return false;
	if (isChatDoomScrollPath(p)) return false;
	if (p === '/feed' || p === '/explore' || p === '/creations' || p === '/challenges') return true;
	if (/^\/chat\/c\/(feed|explore|creations|comments)(\/|$)/.test(p)) return true;
	if (isChatPageShell() && (p === '/chat' || p.startsWith('/chat/'))) {
		return true;
	}
	return false;
}

/**
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function shouldUseCreationDetailOverlay(pathname = window.location.pathname) {
	if (!isOverlayCapableShell()) return false;
	return isOverlayLanePath(pathname);
}

export function isCreationDetailOverlayHistoryActive() {
	return Boolean(window.history?.state?.[HISTORY_FLAG]) || isCreationDetailOverlayOpen();
}

/**
 * @param {string} href
 * @returns {number|null}
 */
export function parseCreationIdFromHref(href) {
	const raw = String(href || '').trim();
	if (!raw) return null;
	try {
		const url = new URL(raw, window.location.origin);
		const m = url.pathname.match(/^\/creations\/(\d+)\/?$/);
		if (!m) return null;
		const id = Number(m[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	} catch {
		const m = raw.match(/^\/creations\/(\d+)\/?/);
		if (!m) return null;
		const id = Number(m[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
}

/**
 * Creation id from `/creations/:id` or chat feed doom paths (`/chat/c/feed/doom/:id`).
 * @param {string} href
 * @returns {number|null}
 */
export function parseCreationNavigationTargetId(href) {
	const fromCreation = parseCreationIdFromHref(href);
	if (fromCreation) return fromCreation;
	const raw = String(href || '').trim();
	if (!raw) return null;
	try {
		const url = new URL(raw, window.location.origin);
		const doom = url.pathname.match(/^\/chat\/c\/feed\/doom\/(\d+)\/?$/);
		if (!doom) return null;
		const id = Number(doom[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	} catch {
		const m = raw.match(/^\/chat\/c\/feed\/doom\/(\d+)\/?/);
		if (!m) return null;
		const id = Number(m[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
}

export function isCreationDetailOverlayOpen() {
	const { overlayEl } = getOverlayStore();
	return overlayEl instanceof HTMLElement && overlayEl.isConnected;
}

function creationDetailUrl(creationId) {
	return `/creations/${encodeURIComponent(String(creationId))}`;
}

function buildOverlayHistoryState(creationId, returnPath) {
	const curState = window.history?.state;
	const baseState = curState && typeof curState === 'object' ? curState : {};
	const existingReturn =
		typeof baseState.prsnOverlayReturnPath === 'string' ? baseState.prsnOverlayReturnPath : null;
	return {
		...baseState,
		[HISTORY_FLAG]: true,
		prsnCreationDetailId: creationId,
		prsnOverlayReturnPath: returnPath || existingReturn || null,
	};
}

function captureReturnPathBeforeOverlayPush() {
	const state = window.history?.state;
	if (
		state &&
		typeof state === 'object' &&
		state[HISTORY_FLAG] &&
		typeof state.prsnOverlayReturnPath === 'string' &&
		state.prsnOverlayReturnPath
	) {
		return state.prsnOverlayReturnPath;
	}
	return window.location.pathname + window.location.search + window.location.hash;
}

function pushOverlayHistoryEntry(creationId) {
	const store = getOverlayStore();
	try {
		const returnPath = captureReturnPathBeforeOverlayPush();
		store.overlayReturnPath = returnPath;
		window.history.pushState(
			buildOverlayHistoryState(creationId, returnPath),
			'',
			creationDetailUrl(creationId)
		);
	} catch {
		store.overlayReturnPath = null;
	}
}

function syncOverlayFrameToCreationId(creationId) {
	const store = getOverlayStore();
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return;
	if (!(store.overlayFrame instanceof HTMLIFrameElement)) return;
	if (store.overlayCreationId === id) return;
	store.overlayCreationId = id;
	const url = `${creationDetailUrl(id)}?embed=1`;
	const frame = store.overlayFrame;
	frame.title = `Creation #${id}`;
	// Replace (don't push) so browser back only walks the parent overlay stack, not iframe history.
	try {
		const win = frame.contentWindow;
		if (win) {
			win.location.replace(url);
			return;
		}
	} catch {
		// ignore
	}
	frame.src = url;
}

function overlayLanePathname(returnPath) {
	if (typeof returnPath === 'string' && returnPath.trim()) {
		const raw = returnPath.trim();
		try {
			if (raw.startsWith('http://') || raw.startsWith('https://')) {
				return new URL(raw).pathname;
			}
			const pathOnly = raw.split('?')[0].split('#')[0];
			return pathOnly || window.location.pathname;
		} catch {
			return window.location.pathname;
		}
	}
	return window.location.pathname;
}

function notifyOverlayDismissed(returnPath) {
	const pathname = overlayLanePathname(returnPath);
	try {
		document.dispatchEvent(
			new CustomEvent('prsn-creation-detail-overlay-dismissed', {
				detail: { returnPath, pathname },
			})
		);
	} catch {
		// ignore
	}
}

function showCreationDetailShellOutVeil() {
	let veil = document.getElementById(SHELL_OUT_VEIL_ID);
	if (!(veil instanceof HTMLElement)) {
		veil = document.createElement('div');
		veil.id = SHELL_OUT_VEIL_ID;
		veil.className = 'creation-detail-overlay-shell-out-veil';
		veil.setAttribute('role', 'status');
		veil.setAttribute('aria-live', 'polite');
		veil.setAttribute('aria-label', 'Loading');
		document.body.appendChild(veil);
	}
	veil.hidden = false;
	document.body.classList.add('creation-detail-overlay-shell-out');
}

/**
 * Leave overlay and navigate the parent shell to a full-page route (e.g. mutate).
 * @param {string} href
 */
export function shellOutFromCreationDetailOverlay(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	let targetPath;
	try {
		const url = new URL(raw, window.location.origin);
		if (url.origin !== window.location.origin) return;
		targetPath = url.pathname + url.search + url.hash;
	} catch {
		return;
	}
	const store = getOverlayStore();
	const returnPath =
		store.overlayReturnPath ||
		(typeof window.history?.state?.prsnOverlayReturnPath === 'string'
			? window.history.state.prsnOverlayReturnPath
			: null);
	showCreationDetailShellOutVeil();
	closeCreationDetailOverlay({ skipScrollRestore: true });
	try {
		if (returnPath) {
			window.history.replaceState({}, '', returnPath);
		}
	} catch {
		// ignore
	}
	const navigate = () => {
		window.location.assign(targetPath);
	};
	requestAnimationFrame(() => {
		requestAnimationFrame(navigate);
	});
}

export function isCreationDetailEmbedFrame() {
	return window.__ps_creation_detail_embed === true && window.parent !== window;
}

/**
 * Iframe → parent: delegate same-origin navigation to the overlay shell.
 * @param {string} href
 * @returns {boolean}
 */
export function requestCreationDetailEmbedRoute(href) {
	const raw = String(href || '').trim();
	if (!raw || !isCreationDetailEmbedFrame()) return false;
	try {
		window.parent.postMessage(
			{ type: 'prsn-creation-detail-overlay-route', href: raw },
			window.location.origin
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Parent routing for navigations initiated inside the embed iframe.
 * @param {string} href
 */
export function routeCreationDetailOverlayFromEmbed(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	let url;
	try {
		url = new URL(raw, window.location.origin);
		if (url.origin !== window.location.origin) {
			shellOutFromCreationDetailOverlay(url.href);
			return;
		}
	} catch {
		return;
	}

	const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
	const target = url.pathname + url.search + url.hash;

	if (/^\/creations\/\d+\/(edit|mutate)\/?$/.test(path)) {
		shellOutFromCreationDetailOverlay(target);
		return;
	}

	let creationId = parseCreationNavigationTargetId(target);
	if (creationId) {
		openCreationDetailOverlay(creationId);
		return;
	}

	if (path === '/creations' || path === '/feed' || path === '/explore' || path === '/challenges') {
		dismissCreationDetailOverlayViaHistory();
		return;
	}

	shellOutFromCreationDetailOverlay(target);
}

/**
 * @param {{ fromPopstate?: boolean, skipScrollRestore?: boolean }} [options]
 */
export function closeCreationDetailOverlay(options = {}) {
	const store = getOverlayStore();
	const returnPath =
		store.overlayReturnPath ||
		(typeof window.history?.state?.prsnOverlayReturnPath === 'string'
			? window.history.state.prsnOverlayReturnPath
			: null);
	if (store.overlayFrame) {
		store.overlayFrame.src = 'about:blank';
	}
	store.overlayFrame = null;
	store.overlayCreationId = null;

	if (store.overlayEl?.parentNode) {
		store.overlayEl.parentNode.removeChild(store.overlayEl);
	}
	store.overlayEl = null;
	document.body.classList.remove('creation-detail-overlay-open');
	if (!options.skipScrollRestore) {
		restoreOverlayScrollPositions();
	}
	store.overlayReturnPath = null;
	notifyOverlayDismissed(returnPath);
}

/** Header back / embed close — pop history only; popstate tears down or steps within overlay. */
function dismissCreationDetailOverlayViaHistory() {
	if (!isCreationDetailOverlayOpen()) return;
	try {
		window.history.back();
	} catch {
		// ignore
	}
}

/**
 * Handle popstate for overlay (browser back, header back, or forward within overlay stack).
 * @param {PopStateEvent} [ev]
 * @returns {boolean} true when consumed — chat/app must not re-route or reload the lane underneath.
 */
export function handleCreationDetailOverlayPopstate(ev) {
	if (!isCreationDetailOverlayOpen()) return false;

	const state = window.history?.state;
	const stillInOverlayStack = Boolean(state?.[HISTORY_FLAG]);

	if (stillInOverlayStack) {
		let id = Number(state?.prsnCreationDetailId);
		if (!Number.isFinite(id) || id <= 0) {
			id = Number(parseCreationIdFromHref(window.location.pathname));
		}
		if (Number.isFinite(id) && id > 0) {
			syncOverlayFrameToCreationId(id);
		}
		if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
		return true;
	}

	closeCreationDetailOverlay({ fromPopstate: true });
	if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
	return true;
}

function captureOverlayScrollPositions() {
	const store = getOverlayStore();
	store.overlaySavedScrollPositions = [];
	const messages = document.querySelector('[data-chat-messages]');
	if (messages instanceof HTMLElement) {
		store.overlaySavedScrollPositions.push({ el: messages, top: messages.scrollTop });
	}
	const routeSections = document.querySelectorAll('[data-route-content].active');
	routeSections.forEach((section) => {
		if (!(section instanceof HTMLElement)) return;
		if (section.scrollHeight <= section.clientHeight) return;
		store.overlaySavedScrollPositions.push({ el: section, top: section.scrollTop });
	});
	const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
	store.overlaySavedScrollPositions.push({ window: true, top: scrollY });
}

function lockOverlayBodyScroll() {
	const store = getOverlayStore();
	if (document.body.classList.contains('chat-page')) return;
	const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
	store.overlayBodyScrollLockTop = scrollY;
	document.body.style.top = `-${scrollY}px`;
}

function unlockOverlayBodyScroll() {
	const store = getOverlayStore();
	if (store.overlayBodyScrollLockTop == null) return;
	const top = store.overlayBodyScrollLockTop;
	store.overlayBodyScrollLockTop = null;
	document.body.style.removeProperty('top');
	window.scrollTo(0, top);
}

function restoreOverlayScrollPositions() {
	const store = getOverlayStore();
	for (const entry of store.overlaySavedScrollPositions) {
		if ('window' in entry && entry.window) {
			window.scrollTo(0, entry.top);
			continue;
		}
		if (entry.el instanceof HTMLElement) {
			entry.el.scrollTop = entry.top;
		}
	}
	store.overlaySavedScrollPositions = [];
	if (store.overlayBodyScrollLockTop != null) {
		unlockOverlayBodyScroll();
	}
}

function ensureOverlayMessageListener() {
	if (document.documentElement.dataset.prsnCreationOverlayMsgBound === '1') return;
	document.documentElement.dataset.prsnCreationOverlayMsgBound = '1';
	window.addEventListener('message', (event) => {
		if (event.origin !== window.location.origin) return;
		const data = event.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'prsn-creation-detail-overlay-close') {
			dismissCreationDetailOverlayViaHistory();
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-navigate') {
			const id = Number(data.creationId);
			if (!Number.isFinite(id) || id <= 0) return;
			openCreationDetailOverlay(id);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-shell-out') {
			shellOutFromCreationDetailOverlay(data.href);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-route') {
			routeCreationDetailOverlayFromEmbed(data.href);
		}
	});
}

function ensureOverlayPopstateListener() {
	if (document.documentElement.dataset.prsnCreationOverlayPopstateBound === '1') return;
	document.documentElement.dataset.prsnCreationOverlayPopstateBound = '1';
	window.addEventListener('popstate', (ev) => {
		handleCreationDetailOverlayPopstate(ev);
	}, true);
}

function buildOverlayChrome(creationId) {
	const toolbar = document.createElement('header');
	toolbar.className = 'creation-detail-overlay-chrome';
	toolbar.setAttribute('aria-label', 'Creation');

	const backBtn = document.createElement('button');
	backBtn.type = 'button';
	backBtn.className = 'chat-page-mobile-chrome-back';
	backBtn.setAttribute('aria-label', 'Back');
	backBtn.innerHTML = '<span class="chat-page-back-icon" aria-hidden="true">&lt;-</span>';
	backBtn.addEventListener('click', () => dismissCreationDetailOverlayViaHistory());

	const title = document.createElement('h1');
	title.className = 'chat-page-mobile-chrome-title';
	title.innerHTML =
		'<span class="chat-page-mobile-chrome-channel-part">' +
		'<span class="chat-page-header-title-text">Creation</span>' +
		'</span>';

	toolbar.append(backBtn, title);

	const frame = document.createElement('iframe');
	frame.className = 'creation-detail-overlay-frame';
	frame.setAttribute('title', `Creation #${creationId}`);
	frame.setAttribute('loading', 'eager');
	frame.src = `${creationDetailUrl(creationId)}?embed=1`;
	frame.addEventListener('load', () => {
		try {
			const win = frame.contentWindow;
			if (!win) return;
			if (win.history && 'scrollRestoration' in win.history) {
				win.history.scrollRestoration = 'manual';
			}
			win.scrollTo(0, 0);
		} catch {
			// ignore cross-origin or transient load races
		}
	});

	return { toolbar, frame };
}

/**
 * @param {number|string} creationId
 */
export function openCreationDetailOverlay(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return;

	const store = getOverlayStore();

	ensureOverlayMessageListener();
	ensureOverlayPopstateListener();

	if (isCreationDetailOverlayOpen() && store.overlayFrame) {
		syncOverlayFrameToCreationId(id);
		pushOverlayHistoryEntry(id);
		return;
	}

	if (isCreationDetailOverlayOpen()) {
		closeCreationDetailOverlay();
	}

	store.overlayCreationId = id;
	const shell = document.createElement('div');
	shell.id = OVERLAY_ID;
	shell.className = 'creation-detail-overlay';
	shell.setAttribute('role', 'dialog');
	shell.setAttribute('aria-modal', 'true');

	const { toolbar, frame } = buildOverlayChrome(id);
	shell.append(frame, toolbar);
	captureOverlayScrollPositions();
	lockOverlayBodyScroll();
	document.body.appendChild(shell);
	document.body.classList.add('creation-detail-overlay-open');

	store.overlayEl = shell;
	store.overlayFrame = frame;

	pushOverlayHistoryEntry(id);
}

/**
 * SPA navigation hook for feed cards and creation links.
 * @param {string} href
 * @param {MouseEvent} [ev]
 */
export function navigateToCreationDetailFromSpa(href, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	const id = parseCreationNavigationTargetId(href);
	if (!id || !shouldUseCreationDetailOverlay()) {
		window.location.assign(href);
		return;
	}
	openCreationDetailOverlay(id);
}

ensureOverlayMessageListener();
ensureOverlayPopstateListener();
