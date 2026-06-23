/**
 * Opens creation detail in a full-viewport iframe overlay on SPA shells (feed, explore, chat lanes).
 * Address bar uses canonical `/creations/:id`; browser back closes overlay and restores the lane URL.
 */

import { MODAL_DISMISS_ICON_SVG } from './modalDismiss.js';
import { navigateToMyCreationsIfNeeded } from '/shared/createSubmit.js';
import {
	applyCreationDetailEmbedShellSync,
	CREATION_DETAIL_SHELL_SYNC_MESSAGE,
} from './creationDetailEmbedShell.js';

const OVERLAY_ID = 'prsn-creation-detail-overlay';
const SHELL_OUT_VEIL_ID = 'prsn-creation-detail-shell-out-veil';
const HISTORY_FLAG = 'prsnCreationDetailOverlay';
const WORKFLOW_DISMISS_MESSAGE = 'prsn-workflow-overlay-dismiss';
const STOP_PLAYBACK_MESSAGE = 'prsn-creation-detail-stop-playback';
const OVERLAY_STORE_KEY = '__prsnCreationDetailOverlay';

/** @typedef {'detail'|'mutate'|'create'} OverlayPageKind */

/** @returns {{ overlayEl: HTMLElement | null, overlayFrame: HTMLIFrameElement | null, overlayCreationId: number | null, overlayPage: OverlayPageKind | null, overlayFramePath: string | null, overlayReturnPath: string | null, overlaySavedScrollPositions: Array<{ el: HTMLElement, top: number } | { window: true, top: number }>, overlayBodyScrollLockTop: number | null, overlayPushCount: number, overlayDismissEntirePending: boolean }} */
function getOverlayStore() {
	if (!window[OVERLAY_STORE_KEY]) {
		window[OVERLAY_STORE_KEY] = {
			overlayEl: null,
			overlayFrame: null,
			overlayCreationId: null,
			overlayPage: null,
			overlayFramePath: null,
			overlayReturnPath: null,
			overlaySavedScrollPositions: [],
			overlayBodyScrollLockTop: null,
			overlayPushCount: 0,
			overlayDismissEntirePending: false,
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
	if (p === '/create') {
		return Boolean(window.history?.state?.[HISTORY_FLAG]);
	}
	if (document.body?.classList?.contains('chat-page--doom-scroll')) return false;
	if (isChatDoomScrollPath(p)) return false;
	if (
		p === '/' ||
		p === '/index.html' ||
		p === '/feed' ||
		p === '/explore' ||
		p === '/creations' ||
		p === '/challenges'
	) {
		return true;
	}
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

/**
 * @param {string} href
 * @param {{ bustCache?: boolean }} [options]
 * @returns {{ kind: OverlayPageKind, creationId: number | null, canonicalUrl: string, embedUrl: string } | null}
 */
export function parseOverlayTarget(href, options = {}) {
	const raw = String(href || '').trim();
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw, window.location.origin);
		if (url.origin !== window.location.origin) return null;
	} catch {
		return null;
	}

	const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
	const canonicalUrl = url.pathname + url.search + url.hash;
	const embedParams = new URLSearchParams(url.search);
	embedParams.set('embed', '1');
	if (options.bustCache) {
		embedParams.set('_reload', String(Date.now()));
	}
	const embedQuery = embedParams.toString();
	const embedUrl = `${path}${embedQuery ? `?${embedQuery}` : '?embed=1'}${url.hash}`;

	const detailMatch = path.match(/^\/creations\/(\d+)$/);
	if (detailMatch) {
		const id = Number(detailMatch[1]);
		if (!Number.isFinite(id) || id <= 0) return null;
		return { kind: 'detail', creationId: id, canonicalUrl, embedUrl };
	}

	const mutateMatch = path.match(/^\/creations\/(\d+)\/(edit|mutate)$/);
	if (mutateMatch) {
		const id = Number(mutateMatch[1]);
		if (!Number.isFinite(id) || id <= 0) return null;
		return { kind: 'mutate', creationId: id, canonicalUrl, embedUrl };
	}

	if (path === '/create') {
		return { kind: 'create', creationId: null, canonicalUrl, embedUrl };
	}

	return null;
}

function overlayTitleForKind(kind) {
	if (kind === 'mutate') return 'Mutate';
	if (kind === 'create') return 'Create';
	return 'Creation';
}

/**
 * @param {{ kind: OverlayPageKind, creationId: number | null, canonicalUrl: string }} target
 * @param {string | null} returnPath
 */
function buildOverlayHistoryState(target, returnPath) {
	const curState = window.history?.state;
	const baseState = curState && typeof curState === 'object' ? curState : {};
	const existingReturn =
		typeof baseState.prsnOverlayReturnPath === 'string' ? baseState.prsnOverlayReturnPath : null;
	return {
		...baseState,
		[HISTORY_FLAG]: true,
		prsnOverlayPage: target.kind,
		prsnCreationDetailId: target.creationId,
		prsnOverlayHref: target.canonicalUrl,
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

/**
 * @param {{ kind: OverlayPageKind, creationId: number | null, canonicalUrl: string }} target
 * @param {{ stackPush?: boolean }} [options]
 */
function pushOverlayHistoryForTarget(target, options = {}) {
	const store = getOverlayStore();
	if (options.stackPush) {
		store.overlayPushCount = Math.max(1, Number(store.overlayPushCount) || 1) + 1;
	} else {
		store.overlayPushCount = 1;
	}
	try {
		const returnPath = captureReturnPathBeforeOverlayPush();
		store.overlayReturnPath = returnPath;
		window.history.pushState(
			buildOverlayHistoryState(target, returnPath),
			'',
			target.canonicalUrl
		);
	} catch {
		store.overlayReturnPath = null;
		store.overlayPushCount = 0;
	}
}

function embedFrameUrl(creationId) {
	return `${creationDetailUrl(creationId)}?embed=1`;
}

function requestEmbedFrameStopPlayback(frame) {
	if (!(frame instanceof HTMLIFrameElement)) return;
	try {
		frame.contentWindow?.postMessage?.({ type: STOP_PLAYBACK_MESSAGE }, window.location.origin);
	} catch {
		// ignore
	}
}

function assignOverlayFrameUrl(frame, url, target) {
	const kind = target?.kind || 'detail';
	const id = Number(target?.creationId);
	if (kind === 'mutate' && Number.isFinite(id) && id > 0) {
		frame.title = `Mutate #${id}`;
	} else if (kind === 'create') {
		frame.title = 'Create';
	} else if (Number.isFinite(id) && id > 0) {
		frame.title = `Creation #${id}`;
	}
	// Stop hero playback and blank before navigating so unload races cannot leave audio running.
	requestEmbedFrameStopPlayback(frame);
	try {
		frame.src = 'about:blank';
	} catch {
		// ignore
	}
	const navigateFrame = () => {
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
	};
	requestAnimationFrame(navigateFrame);
}

/**
 * @param {{ kind: OverlayPageKind, creationId: number | null, canonicalUrl: string, embedUrl: string }} target
 * @param {{ forceReload?: boolean }} [options]
 */
function syncOverlayFrameToTarget(target, options = {}) {
	const store = getOverlayStore();
	if (!(store.overlayFrame instanceof HTMLIFrameElement)) return;
	if (!options.forceReload && store.overlayFramePath === target.canonicalUrl) return;
	store.overlayPage = target.kind;
	store.overlayCreationId = target.creationId;
	store.overlayFramePath = target.canonicalUrl;
	assignOverlayFrameUrl(store.overlayFrame, target.embedUrl, target);
	updateOverlayChromeTitle(target.kind);
}

function syncOverlayFrameToCreationId(creationId) {
	syncOverlayFrameToTarget({
		kind: 'detail',
		creationId: Number(creationId),
		canonicalUrl: creationDetailUrl(creationId),
		embedUrl: embedFrameUrl(creationId),
	});
}

function syncOverlayFrameFromLocation() {
	const target = parseOverlayTarget(
		window.location.pathname + window.location.search + window.location.hash
	);
	if (!target) return;
	syncOverlayFrameToTarget(target);
}

/** Force embed reload for the current overlay target. */
function reloadWorkflowOverlayFrame(target) {
	const store = getOverlayStore();
	const resolved =
		target ||
		parseOverlayTarget(store.overlayFramePath || window.location.pathname + window.location.search);
	if (!resolved) return;
	if (!(store.overlayFrame instanceof HTMLIFrameElement)) return;
	store.overlayPage = resolved.kind;
	store.overlayCreationId = resolved.creationId;
	store.overlayFramePath = resolved.canonicalUrl;
	assignOverlayFrameUrl(store.overlayFrame, resolved.embedUrl, resolved);
}

function reloadCreationDetailOverlayFrame(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) {
		reloadWorkflowOverlayFrame();
		return;
	}
	reloadWorkflowOverlayFrame({
		kind: 'detail',
		creationId: id,
		canonicalUrl: creationDetailUrl(id),
		embedUrl: embedFrameUrl(id),
	});
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
 * @param {{ forceReload?: boolean }} [options]
 */
export function routeCreationDetailOverlayFromEmbed(href, options = {}) {
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
	const openOpts = { forceReload: Boolean(options.forceReload) };

	if (/^\/creations\/\d+\/(edit|mutate)\/?$/.test(path)) {
		openWorkflowOverlayFromHref(target, openOpts);
		return;
	}

	if (path === '/create') {
		openWorkflowOverlayFromHref(target, openOpts);
		return;
	}

	if (/^\/create\/blog\//.test(path)) {
		shellOutFromCreationDetailOverlay(target);
		return;
	}

	let creationId = parseCreationNavigationTargetId(target);
	if (creationId) {
		openWorkflowOverlayFromHref(`/creations/${creationId}`);
		return;
	}

	if (path === '/creations' || path === '/feed' || path === '/explore' || path === '/challenges') {
		dismissEntireCreationDetailOverlay();
		return;
	}

	shellOutFromCreationDetailOverlay(target);
}

/**
 * Parent shell: open inline lightbox above the creation-detail overlay (from embed iframe).
 * @param {object} data
 */
export function openInlineLightboxFromEmbed(data) {
	if (isCreationDetailEmbedFrame()) return;
	const kind = String(data?.kind || 'image').trim() || 'image';
	void import('./chatInlineImageLightbox.js')
		.then((mod) => {
			mod.closeChatInlineImageLightbox({ stripHistory: false });
			if (kind === 'video-gallery') {
				const slides = Array.isArray(data?.slides) ? data.slides : [];
				const hooksRaw = data?.hooks && typeof data.hooks === 'object' ? data.hooks : {};
				mod.openChatVideoGalleryLightbox(slides, hooksRaw);
				return;
			}
			if (kind === 'attachment') {
				const src = String(data?.src || '').trim();
				const attachmentKind = String(data?.attachmentKind || 'video').trim() || 'video';
				const meta =
					data?.creationMeta && typeof data.creationMeta === 'object' ? data.creationMeta : {};
				mod.openChatAttachmentPreviewLightbox(src, attachmentKind, {
					creationId: meta.creationId,
				});
				return;
			}
			const src = String(data?.src || '').trim();
			if (!src) return;
			const meta =
				data?.creationMeta && typeof data.creationMeta === 'object' ? data.creationMeta : {};
			mod.openChatInlineImageLightbox(src, meta);
		})
		.catch(() => {
			// ignore
		});
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
		requestEmbedFrameStopPlayback(store.overlayFrame);
		store.overlayFrame.src = 'about:blank';
	}
	store.overlayFrame = null;
	store.overlayCreationId = null;
	store.overlayPage = null;
	store.overlayFramePath = null;

	if (store.overlayEl?.parentNode) {
		store.overlayEl.parentNode.removeChild(store.overlayEl);
	}
	store.overlayEl = null;
	document.body.classList.remove('creation-detail-overlay-open');
	if (!options.skipScrollRestore) {
		restoreOverlayScrollPositions();
	}
	store.overlayReturnPath = null;
	store.overlayPushCount = 0;
	store.overlayDismissEntirePending = false;
	notifyOverlayDismissed(returnPath);
}

function overlayReturnPathFromStore() {
	const store = getOverlayStore();
	if (typeof store.overlayReturnPath === 'string' && store.overlayReturnPath) {
		return store.overlayReturnPath;
	}
	const state = window.history?.state;
	if (state && typeof state === 'object' && typeof state.prsnOverlayReturnPath === 'string') {
		return state.prsnOverlayReturnPath;
	}
	return null;
}

function shouldNavigateToMyCreationsOnWorkflowDismiss() {
	const store = getOverlayStore();
	const page = store.overlayPage;
	return page === 'create' || page === 'mutate';
}

function fallbackDismissEntireCreationDetailOverlay(options = {}) {
	const store = getOverlayStore();
	const preferMyCreations =
		options.preferMyCreations === true || shouldNavigateToMyCreationsOnWorkflowDismiss();
	const returnPath = overlayReturnPathFromStore();
	store.overlayDismissEntirePending = false;
	store.overlayPushCount = 0;
	if (preferMyCreations) {
		navigateToMyCreationsIfNeeded({
			replace: true,
			forceFreshFirstPage: false,
			stripOverlayHistory: true,
		});
		closeCreationDetailOverlay();
		return;
	}
	try {
		if (returnPath) {
			const curState = window.history?.state;
			const baseState = curState && typeof curState === 'object' ? { ...curState } : {};
			delete baseState[HISTORY_FLAG];
			delete baseState.prsnCreationDetailId;
			delete baseState.prsnOverlayPage;
			delete baseState.prsnOverlayHref;
			delete baseState.prsnOverlayReturnPath;
			window.history.replaceState(baseState, '', returnPath);
		}
	} catch {
		// ignore
	}
	closeCreationDetailOverlay();
}

/** Header back — one history step; popstate tears down or steps within overlay. */
function dismissCreationDetailOverlayViaHistory() {
	if (!isCreationDetailOverlayOpen()) return;
	try {
		window.history.back();
	} catch {
		// ignore
	}
}

/** Header X / embed close — exit the whole overlay stack back to the lane in one gesture. */
export function dismissEntireCreationDetailOverlay() {
	if (!isCreationDetailOverlayOpen()) return;
	// replaceState + close: reliable one-click dismiss even when overlayPushCount drifted
	// from duplicate same-URL history entries (e.g. iframe full reload after publish).
	fallbackDismissEntireCreationDetailOverlay();
}

/**
 * Handle popstate for overlay (browser back, header back, or forward within overlay stack).
 * @param {PopStateEvent} [ev]
 * @returns {boolean} true when consumed — chat/app must not re-route or reload the lane underneath.
 */
export function handleCreationDetailOverlayPopstate(ev) {
	if (!isCreationDetailOverlayOpen()) return false;

	const store = getOverlayStore();
	if (store.overlayDismissEntirePending) {
		store.overlayDismissEntirePending = false;
		store.overlayPushCount = 0;
		closeCreationDetailOverlay({ fromPopstate: true });
		if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
		return true;
	}

	const state = window.history?.state;
	const stillInOverlayStack = Boolean(state?.[HISTORY_FLAG]);

	if (stillInOverlayStack) {
		const locPath = window.location.pathname + window.location.search;
		if (store.overlayFramePath && locPath === store.overlayFramePath) {
			fallbackDismissEntireCreationDetailOverlay();
			if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
			return true;
		}
		syncOverlayFrameFromLocation();
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
		if (data.type === 'prsn-open-inline-lightbox') {
			openInlineLightboxFromEmbed(data);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-close') {
			dismissEntireCreationDetailOverlay();
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-navigate') {
			const id = Number(data.creationId);
			if (!Number.isFinite(id) || id <= 0) return;
			openWorkflowOverlayFromHref(`/creations/${id}`);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-shell-out') {
			shellOutFromCreationDetailOverlay(data.href);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-route') {
			routeCreationDetailOverlayFromEmbed(data.href, {
				forceReload: Boolean(data.forceReload),
			});
			return;
		}
		if (data.type === WORKFLOW_DISMISS_MESSAGE) {
			try {
				document.dispatchEvent(new CustomEvent('creations-pending-updated'));
			} catch {
				// ignore
			}
			fallbackDismissEntireCreationDetailOverlay({ preferMyCreations: true });
			return;
		}
		if (data.type === CREATION_DETAIL_SHELL_SYNC_MESSAGE) {
			applyCreationDetailEmbedShellSync(data);
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-refresh') {
			const id = Number(data.creationId);
			if (Number.isFinite(id) && id > 0) {
				reloadCreationDetailOverlayFrame(id);
			} else {
				reloadCreationDetailOverlayFrame();
			}
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

function ensureOverlayEscapeListener() {
	if (document.documentElement.dataset.prsnCreationOverlayEscapeBound === '1') return;
	document.documentElement.dataset.prsnCreationOverlayEscapeBound = '1';
	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			if (!isCreationDetailOverlayOpen()) return;
			e.preventDefault();
			dismissEntireCreationDetailOverlay();
		},
		true
	);
}

function updateOverlayChromeTitle(kind) {
	const store = getOverlayStore();
	const titleEl = store.overlayEl?.querySelector?.('.chat-page-header-title-text');
	if (!(titleEl instanceof HTMLElement)) return;
	titleEl.textContent = overlayTitleForKind(kind);
}

function buildOverlayChrome(target) {
	const kind = target?.kind || 'detail';
	const creationId = Number(target?.creationId);
	const toolbar = document.createElement('header');
	toolbar.className = 'creation-detail-overlay-chrome';
	toolbar.setAttribute('aria-label', overlayTitleForKind(kind));

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
		`<span class="chat-page-header-title-text">${overlayTitleForKind(kind)}</span>` +
		'</span>';

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'modal-dismiss creation-detail-overlay-dismiss';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.innerHTML = MODAL_DISMISS_ICON_SVG;
	closeBtn.addEventListener('click', () => dismissEntireCreationDetailOverlay());

	toolbar.append(backBtn, title, closeBtn);

	const frame = document.createElement('iframe');
	frame.className = 'creation-detail-overlay-frame';
	if (kind === 'mutate' && Number.isFinite(creationId) && creationId > 0) {
		frame.setAttribute('title', `Mutate #${creationId}`);
	} else if (kind === 'create') {
		frame.setAttribute('title', 'Create');
	} else if (Number.isFinite(creationId) && creationId > 0) {
		frame.setAttribute('title', `Creation #${creationId}`);
	} else {
		frame.setAttribute('title', 'Creation');
	}
	frame.setAttribute('loading', 'eager');
	frame.src = target?.embedUrl || embedFrameUrl(creationId);
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
 * @param {string} href
 * @param {{ forceReload?: boolean }} [options]
 */
export function openWorkflowOverlayFromHref(href, options = {}) {
	const target = parseOverlayTarget(href, { bustCache: Boolean(options.forceReload) });
	if (!target) {
		shellOutFromCreationDetailOverlay(href);
		return;
	}

	const store = getOverlayStore();

	ensureOverlayMessageListener();
	ensureOverlayPopstateListener();
	ensureOverlayEscapeListener();

	if (isCreationDetailOverlayOpen() && store.overlayFrame) {
		if (store.overlayFramePath === target.canonicalUrl) {
			// Same URL: iframe refreshAfterMutation already reloads content in place.
			// Full iframe reload here stacked a second document and left the prior player audible.
			if (options.forceReload) {
				reloadWorkflowOverlayFrame(target);
			}
		} else {
			syncOverlayFrameToTarget(target);
			pushOverlayHistoryForTarget(target, { stackPush: true });
		}
		return;
	}

	if (isCreationDetailOverlayOpen()) {
		closeCreationDetailOverlay();
	}

	const orphanedOverlay = document.getElementById(OVERLAY_ID);
	if (orphanedOverlay instanceof HTMLElement) {
		orphanedOverlay.remove();
	}

	store.overlayCreationId = target.creationId;
	store.overlayPage = target.kind;
	store.overlayFramePath = target.canonicalUrl;

	const shell = document.createElement('div');
	shell.id = OVERLAY_ID;
	shell.className = 'creation-detail-overlay';
	shell.setAttribute('role', 'dialog');
	shell.setAttribute('aria-modal', 'true');

	const { toolbar, frame } = buildOverlayChrome(target);
	shell.append(frame, toolbar);
	captureOverlayScrollPositions();
	lockOverlayBodyScroll();
	document.body.appendChild(shell);
	document.body.classList.add('creation-detail-overlay-open');

	store.overlayEl = shell;
	store.overlayFrame = frame;

	pushOverlayHistoryForTarget(target);
}

/**
 * @param {number|string} creationId
 */
export function openCreationDetailOverlay(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return;
	openWorkflowOverlayFromHref(creationDetailUrl(id));
}

/**
 * SPA navigation hook for mutate links.
 * @param {string} href
 * @param {MouseEvent} [ev]
 */
export function navigateToMutateFromSpa(href, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	if (!parseOverlayTarget(href) || !shouldUseCreationDetailOverlay()) {
		window.location.assign(href);
		return;
	}
	openWorkflowOverlayFromHref(href);
}

/**
 * SPA navigation hook for create links (all overlay-capable shells, including chat).
 * @param {string} href
 * @param {MouseEvent} [ev]
 * @param {{ forceReload?: boolean }} [options]
 */
export function navigateToCreateFromSpa(href = '/create', ev, options = {}) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	if (!parseOverlayTarget(href) || !shouldUseCreationDetailOverlay()) {
		window.location.assign(href);
		return;
	}
	openWorkflowOverlayFromHref(href, { forceReload: Boolean(options.forceReload) });
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
	openWorkflowOverlayFromHref(`/creations/${id}`);
}

function shouldInterceptWorkflowSpaLink(link, e) {
	if (!(link instanceof HTMLAnchorElement)) return false;
	if (e.defaultPrevented) return false;
	if (typeof e.button === 'number' && e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	if (link.target === '_blank' || link.hasAttribute('download')) return false;
	const href = (link.getAttribute('href') || '').trim();
	if (!href || href.startsWith('#')) return false;
	return true;
}

/** Capture /create and /creations/:id/mutate links in app SPA shells (empty states, footers, etc.). */
function bindWorkflowOverlaySpaLinkIntercepts() {
	if (document.documentElement.dataset.prsnWorkflowLinkInterceptBound === '1') return;
	document.documentElement.dataset.prsnWorkflowLinkInterceptBound = '1';
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a[href]');
			if (!shouldInterceptWorkflowSpaLink(link, e)) return;

			let url;
			try {
				url = new URL(link.getAttribute('href') || '', window.location.origin);
				if (url.origin !== window.location.origin) return;
			} catch {
				return;
			}

			const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
			const target = url.pathname + url.search + url.hash;

			if (path === '/create' || /^\/creations\/\d+\/(edit|mutate)$/.test(path)) {
				if (!shouldUseCreationDetailOverlay()) return;
				e.preventDefault();
				e.stopPropagation();
				openWorkflowOverlayFromHref(target);
			}
		},
		true
	);
}

ensureOverlayMessageListener();
ensureOverlayPopstateListener();
ensureOverlayEscapeListener();
bindWorkflowOverlaySpaLinkIntercepts();
