/**
 * Unified SPA page overlay — single iframe stack for embed-capable routes on feed/explore/chat/app shells.
 */

import { MODAL_DISMISS_ICON_SVG } from './modalDismiss.js';
import { navigateToChatPathFromOverlay, navigateToMyCreationsIfNeeded } from '/shared/createSubmit.js';
import { SPA_OVERLAY_EMBED_READY_MESSAGE } from './embedPageRuntime.js';
import {
	applyCreationDetailEmbedShellSync,
	CREATION_DETAIL_SHELL_SYNC_MESSAGE,
} from './creationDetailEmbedShell.js';

const OVERLAY_ID = 'prsn-spa-page-overlay';
const SHELL_OUT_VEIL_ID = 'prsn-spa-page-shell-out-veil';
const OVERLAY_FRAME_VEIL_CLASS = 'creation-detail-overlay-frame-veil';
const HISTORY_FLAG = 'prsnSpaPageOverlay';
const OVERLAY_STORE_KEY = '__prsnSpaPageOverlay';
const WORKFLOW_DISMISS_MESSAGE = 'prsn-workflow-overlay-dismiss';
const STOP_PLAYBACK_MESSAGE = 'prsn-creation-detail-stop-playback';
const OVERLAY_VEIL_FALLBACK_MS = 5000;

let overlayFramePendingUrl = null;
let overlayFramePendingGeneration = 0;
let overlayFrameVeilFallbackTimer = null;

/** @typedef {'profile'|'style'|'audio-clip'|'prompt-library'|'creation-detail'|'creation-mutate'|'create'|'integrations'} SpaOverlayPageKind */

const PROFILE_PATH_RE = /^\/p\/[a-z0-9][a-z0-9_-]{2,23}$/i;
const USER_ID_PATH_RE = /^\/user\/\d+$/;
const AUDIO_CLIP_PATH_RE = /^\/audio-clips\/\d+$/;

/** @returns {{ overlayEl: HTMLElement | null, overlayFrame: HTMLIFrameElement | null, overlayPage: SpaOverlayPageKind | null, overlayCreationId: number | null, overlayFramePath: string | null, overlayReturnPath: string | null, overlaySavedScrollPositions: Array<{ el: HTMLElement, top: number } | { window: true, top: number }>, overlayBodyScrollLockTop: number | null, overlayPushCount: number, overlayDismissEntirePending: boolean }} */
function getOverlayStore() {
	if (!window[OVERLAY_STORE_KEY]) {
		window[OVERLAY_STORE_KEY] = {
			overlayEl: null,
			overlayFrame: null,
			overlayPage: null,
			overlayCreationId: null,
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

function normalizePath(pathname) {
	return String(pathname || '').replace(/\/+$/, '') || '/';
}

function getParentShellBackgroundColor() {
	try {
		const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
		if (bg) return bg;
	} catch {
		// ignore
	}
	return '';
}

function normalizeEmbedUrlForMatch(href) {
	const raw = String(href || '').trim();
	if (!raw) return '';
	try {
		const url = new URL(raw, window.location.origin);
		const params = new URLSearchParams(url.search);
		params.delete('_reload');
		const query = params.toString();
		return `${url.pathname}${query ? `?${query}` : ''}`;
	} catch {
		return raw;
	}
}

function clearOverlayFrameVeilFallbackTimer() {
	if (overlayFrameVeilFallbackTimer) {
		clearTimeout(overlayFrameVeilFallbackTimer);
		overlayFrameVeilFallbackTimer = null;
	}
}

function scheduleOverlayFrameVeilFallback(frame, generation) {
	clearOverlayFrameVeilFallbackTimer();
	overlayFrameVeilFallbackTimer = setTimeout(() => {
		if (generation !== overlayFramePendingGeneration) return;
		revealOverlayFrame(frame);
	}, OVERLAY_VEIL_FALLBACK_MS);
}

function revealOverlayFrame(frame) {
	clearOverlayFrameVeilFallbackTimer();
	setOverlayFrameVeilActive(frame, false);
	if (frame instanceof HTMLIFrameElement) {
		frame.classList.remove('is-overlay-loading');
	}
}

function handleOverlayEmbedReady(frame, href, generation) {
	if (!(frame instanceof HTMLIFrameElement)) return;
	if (generation !== overlayFramePendingGeneration) return;
	const pending = normalizeEmbedUrlForMatch(overlayFramePendingUrl);
	const incoming = normalizeEmbedUrlForMatch(href);
	if (pending && incoming && pending !== incoming) return;
	revealOverlayFrame(frame);
}

function isEmbedBody() {
	return (
		document.body.classList.contains('creation-detail-embed') ||
		document.body.classList.contains('prompt-library-embed') ||
		document.body.classList.contains('profile-page-embed') ||
		document.body.classList.contains('style-detail-embed') ||
		document.body.classList.contains('audio-clip-detail-embed') ||
		document.body.classList.contains('create-page-embed') ||
		document.body.classList.contains('creation-edit-embed') ||
		document.body.classList.contains('integrations-embed') ||
		window.__ps_creation_detail_embed === true ||
		window.__ps_prompt_library_embed === true ||
		window.__ps_profile_embed === true ||
		window.__ps_style_embed === true ||
		window.__ps_audio_clip_embed === true ||
		window.__ps_create_embed === true ||
		window.__ps_creation_edit_embed === true ||
		window.__ps_integrations_embed === true
	);
}

function isStandaloneOverlayHostPage() {
	if (isEmbedBody()) return false;
	const entry = document.body?.dataset?.entry;
	if (entry === 'creation-detail') return true;
	if (entry === 'prompt-library') return true;
	if (entry === 'user-profile') return true;
	if (entry === 'style-detail') return true;
	if (entry === 'audio-clip-detail') return true;
	if (document.body.classList.contains('create-page') || document.body.classList.contains('create-page-advanced')) {
		return true;
	}
	if (document.body.classList.contains('creation-edit-page')) return true;
	if (document.body.classList.contains('integrations-page')) return true;
	return false;
}

function isChatPageShell() {
	return (
		document.body?.classList?.contains('chat-page') ||
		document.documentElement?.classList?.contains('chat-page') ||
		document.body?.dataset?.entry === 'chat'
	);
}

function isOverlayCapableShell() {
	if (isStandaloneOverlayHostPage()) return false;
	if (isChatPageShell()) return true;
	const entry = document.body?.dataset?.entry;
	return entry === 'app' || entry === 'app-admin';
}

function isOverlayRoutePath(pathname) {
	const p = normalizePath(pathname);
	return Boolean(matchSpaOverlayKind(p));
}

function isOverlayLanePath(pathname) {
	const p = normalizePath(pathname);
	if (window.history?.state?.[HISTORY_FLAG] && isOverlayRoutePath(p)) {
		return true;
	}
	if (/^\/creations\/\d+(\/(edit|mutate))?$/.test(p)) {
		return Boolean(window.history?.state?.[HISTORY_FLAG]);
	}
	if (p === '/create') {
		return Boolean(window.history?.state?.[HISTORY_FLAG]);
	}
	if (p === '/' || p === '/index.html' || p === '/feed' || p === '/explore' || p === '/creations' || p === '/challenges') {
		return true;
	}
	if (/^\/chat\/c\/(feed|explore|creations|comments)(\/|$)/.test(p)) return true;
	if (isChatPageShell() && (p === '/chat' || p.startsWith('/chat/'))) {
		return true;
	}
	return false;
}

/**
 * @param {string} path
 * @returns {SpaOverlayPageKind | null}
 */
function matchSpaOverlayKind(path) {
	const p = normalizePath(path);
	if (p === '/user' || USER_ID_PATH_RE.test(p) || PROFILE_PATH_RE.test(p)) return 'profile';
	if (p.startsWith('/styles/')) return 'style';
	if (AUDIO_CLIP_PATH_RE.test(p)) return 'audio-clip';
	if (p === '/prompt-library') return 'prompt-library';
	if (p === '/integrations') return 'integrations';
	if (/^\/creations\/\d+\/(edit|mutate)$/.test(p)) return 'creation-mutate';
	if (/^\/creations\/\d+$/.test(p)) return 'creation-detail';
	if (p === '/create') return 'create';
	return null;
}

/**
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function shouldUseSpaPageOverlay(pathname = window.location.pathname) {
	if (!isOverlayCapableShell()) return false;
	return isOverlayLanePath(pathname);
}

export const shouldUseCreationDetailOverlay = shouldUseSpaPageOverlay;
export const shouldUsePromptLibraryOverlay = shouldUseSpaPageOverlay;

export function isSpaPageOverlayHistoryActive() {
	return Boolean(window.history?.state?.[HISTORY_FLAG]) || isSpaPageOverlayOpen();
}

export const isCreationDetailOverlayHistoryActive = isSpaPageOverlayHistoryActive;
export const isPromptLibraryOverlayHistoryActive = isSpaPageOverlayHistoryActive;

export function isSpaPageOverlayOpen() {
	const { overlayEl } = getOverlayStore();
	return overlayEl instanceof HTMLElement && overlayEl.isConnected;
}

export const isCreationDetailOverlayOpen = isSpaPageOverlayOpen;
export const isPromptLibraryOverlayOpen = isSpaPageOverlayOpen;

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

/**
 * @param {string} href
 * @param {{ bustCache?: boolean }} [options]
 * @returns {{ kind: SpaOverlayPageKind, creationId: number | null, canonicalUrl: string, embedUrl: string } | null}
 */
export function parseSpaOverlayTarget(href, options = {}) {
	const raw = String(href || '').trim();
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw, window.location.origin);
		if (url.origin !== window.location.origin) return null;
	} catch {
		return null;
	}

	const path = normalizePath(url.pathname);
	const kind = matchSpaOverlayKind(path);
	if (!kind) return null;

	const canonicalUrl = url.pathname + url.search + url.hash;
	const embedParams = new URLSearchParams(url.search);
	embedParams.set('embed', '1');
	const shellBg = getParentShellBackgroundColor();
	if (shellBg) {
		embedParams.set('shell_bg', shellBg);
	}
	if (options.bustCache) {
		embedParams.set('_reload', String(Date.now()));
	}
	const embedQuery = embedParams.toString();
	const embedUrl = `${path}${embedQuery ? `?${embedQuery}` : '?embed=1'}${url.hash}`;

	let creationId = null;
	if (kind === 'creation-detail' || kind === 'creation-mutate') {
		const m = path.match(/^\/creations\/(\d+)/);
		if (m) {
			const id = Number(m[1]);
			creationId = Number.isFinite(id) && id > 0 ? id : null;
		}
	}

	return { kind, creationId, canonicalUrl, embedUrl };
}

export const parseOverlayTarget = parseSpaOverlayTarget;

export function parsePromptLibraryOverlayTarget(href, options = {}) {
	const target = parseSpaOverlayTarget(href, options);
	if (!target || target.kind !== 'prompt-library') return null;
	return { canonicalUrl: target.canonicalUrl, embedUrl: target.embedUrl };
}

function overlayTitleForKind(kind) {
	switch (kind) {
		case 'profile':
			return 'Profile';
		case 'style':
			return 'Style';
		case 'audio-clip':
			return 'Audio clip';
		case 'prompt-library':
			return 'Prompt Library';
		case 'integrations':
			return 'Connections';
		case 'creation-mutate':
			return 'Mutate';
		case 'create':
			return 'Create';
		case 'creation-detail':
		default:
			return 'Creation';
	}
}

function frameTitleForTarget(target) {
	const kind = target?.kind || 'creation-detail';
	const id = Number(target?.creationId);
	if (kind === 'profile') return 'Profile';
	if (kind === 'style') return 'Style';
	if (kind === 'audio-clip') return 'Audio clip';
	if (kind === 'prompt-library') return 'Prompt Library';
	if (kind === 'integrations') return 'Connections';
	if (kind === 'creation-mutate' && Number.isFinite(id) && id > 0) return `Mutate #${id}`;
	if (kind === 'create') return 'Create';
	if (kind === 'creation-detail' && Number.isFinite(id) && id > 0) return `Creation #${id}`;
	return overlayTitleForKind(kind);
}

/**
 * @param {{ kind: SpaOverlayPageKind, creationId: number | null, canonicalUrl: string }} target
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
		window.history.pushState(buildOverlayHistoryState(target, returnPath), '', target.canonicalUrl);
	} catch {
		store.overlayReturnPath = null;
		store.overlayPushCount = 0;
	}
}

function requestEmbedFrameStopPlayback(frame) {
	if (!(frame instanceof HTMLIFrameElement)) return;
	try {
		frame.contentWindow?.postMessage?.({ type: STOP_PLAYBACK_MESSAGE }, window.location.origin);
	} catch {
		// ignore
	}
}

function getOverlayFrameVeil(frame) {
	const shell = frame?.closest?.('.creation-detail-overlay');
	const veil = shell?.querySelector?.(`.${OVERLAY_FRAME_VEIL_CLASS}`);
	return veil instanceof HTMLElement ? veil : null;
}

function setOverlayFrameVeilActive(frame, active) {
	const veil = getOverlayFrameVeil(frame);
	if (!veil) return;
	veil.classList.toggle('is-active', Boolean(active));
	veil.setAttribute('aria-hidden', active ? 'false' : 'true');
}

function onOverlayFrameLoad(frame) {
	try {
		const win = frame.contentWindow;
		if (!win) return;
		if (win.history && 'scrollRestoration' in win.history) {
			win.history.scrollRestoration = 'manual';
		}
		win.scrollTo(0, 0);
	} catch {
		// ignore
	}
}

function ensureOverlayFrameLoadHandler(frame) {
	if (!(frame instanceof HTMLIFrameElement)) return;
	if (frame.dataset.prsnOverlayFrameLoadBound === '1') return;
	frame.dataset.prsnOverlayFrameLoadBound = '1';
	frame.addEventListener('load', () => {
		onOverlayFrameLoad(frame);
	});
}

function assignOverlayFrameUrl(frame, url, target) {
	const title = frameTitleForTarget(target);
	frame.title = title;
	if (target?.kind === 'creation-detail' || target?.kind === 'creation-mutate') {
		requestEmbedFrameStopPlayback(frame);
	}
	overlayFramePendingGeneration += 1;
	const generation = overlayFramePendingGeneration;
	overlayFramePendingUrl = url;
	frame.classList.add('is-overlay-loading');
	setOverlayFrameVeilActive(frame, true);
	scheduleOverlayFrameVeilFallback(frame, generation);
	const navigateFrame = () => {
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

function syncOverlayFrameFromLocation() {
	const target = parseSpaOverlayTarget(
		window.location.pathname + window.location.search + window.location.hash
	);
	if (!target) return;
	syncOverlayFrameToTarget(target);
}

function reloadSpaOverlayFrame(target) {
	const store = getOverlayStore();
	const resolved =
		target ||
		parseSpaOverlayTarget(store.overlayFramePath || window.location.pathname + window.location.search);
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
		reloadSpaOverlayFrame();
		return;
	}
	reloadSpaOverlayFrame({
		kind: 'creation-detail',
		creationId: id,
		canonicalUrl: `/creations/${encodeURIComponent(String(id))}`,
		embedUrl: `/creations/${encodeURIComponent(String(id))}?embed=1`,
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
	const detail = { returnPath, pathname };
	for (const type of [
		'prsn-spa-page-overlay-dismissed',
		'prsn-creation-detail-overlay-dismissed',
		'prsn-prompt-library-overlay-dismissed',
	]) {
		try {
			document.dispatchEvent(new CustomEvent(type, { detail }));
		} catch {
			// ignore
		}
	}
}

/** Full-viewport loading cover used when leaving an overlay for a full page load. */
export function showShellOutVeil() {
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

export function hideShellOutVeil() {
	const veil = document.getElementById(SHELL_OUT_VEIL_ID);
	if (veil instanceof HTMLElement) {
		veil.hidden = true;
	}
	try {
		document.body.classList.remove('creation-detail-overlay-shell-out');
	} catch {
		// ignore
	}
}

/** Show the shell-out veil, then full-navigate (same timing as overlay shell-out). */
export function assignWithShellOutVeil(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	showShellOutVeil();
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			window.location.assign(raw.startsWith('/') || raw.startsWith('http') ? raw : `/${raw}`);
		});
	});
}

export function shellOutFromSpaPageOverlay(href) {
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
	closeSpaPageOverlay({ skipScrollRestore: true });
	if (navigateToChatPathFromOverlay(targetPath)) {
		return;
	}
	assignWithShellOutVeil(targetPath);
}

export const shellOutFromCreationDetailOverlay = shellOutFromSpaPageOverlay;
export const shellOutFromPromptLibraryOverlay = shellOutFromSpaPageOverlay;

export function isCreationDetailEmbedFrame() {
	return window.__ps_creation_detail_embed === true && window.parent !== window;
}

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
 * @param {string} href
 * @param {{ forceReload?: boolean }} [options]
 */
export function routeSpaPageOverlayFromEmbed(href, options = {}) {
	const raw = String(href || '').trim();
	if (!raw) return;
	let url;
	try {
		url = new URL(raw, window.location.origin);
		if (url.origin !== window.location.origin) {
			shellOutFromSpaPageOverlay(url.href);
			return;
		}
	} catch {
		return;
	}

	const path = normalizePath(url.pathname);
	const target = url.pathname + url.search + url.hash;
	const openOpts = { forceReload: Boolean(options.forceReload) };

	if (path.startsWith('/chat/') || path === '/auth' || path === '/auth.html' || path.startsWith('/pricing')) {
		shellOutFromSpaPageOverlay(target);
		return;
	}

	if (/^\/create\/blog\//.test(path)) {
		shellOutFromSpaPageOverlay(target);
		return;
	}

	if (path === '/creations' || path === '/feed' || path === '/explore' || path === '/challenges') {
		dismissEntireSpaPageOverlay();
		return;
	}

	const overlayTarget = parseSpaOverlayTarget(target, openOpts);
	if (overlayTarget) {
		openSpaPageOverlayFromHref(target, openOpts);
		return;
	}

	shellOutFromSpaPageOverlay(target);
}

export const routeCreationDetailOverlayFromEmbed = routeSpaPageOverlayFromEmbed;
export const routePromptLibraryOverlayFromEmbed = routeSpaPageOverlayFromEmbed;

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

export function closeSpaPageOverlay(options = {}) {
	const store = getOverlayStore();
	const returnPath =
		store.overlayReturnPath ||
		(typeof window.history?.state?.prsnOverlayReturnPath === 'string'
			? window.history.state.prsnOverlayReturnPath
			: null);
	if (store.overlayFrame) {
		requestEmbedFrameStopPlayback(store.overlayFrame);
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

export const closeCreationDetailOverlay = closeSpaPageOverlay;
export const closePromptLibraryOverlay = closeSpaPageOverlay;

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
	return page === 'create' || page === 'creation-mutate';
}

function fallbackDismissEntireSpaPageOverlay(options = {}) {
	const store = getOverlayStore();
	const preferMyCreations =
		options.preferMyCreations === true || shouldNavigateToMyCreationsOnWorkflowDismiss();
	const returnPath = overlayReturnPathFromStore();
	store.overlayDismissEntirePending = false;
	store.overlayPushCount = 0;
	if (preferMyCreations) {
		// Close before navigating so chat lane loaders (openThreadForCurrentPath) are not
		// blocked by the overlay-open guard while the URL is already /creations.
		closeSpaPageOverlay();
		navigateToMyCreationsIfNeeded({
			replace: true,
			forceFreshFirstPage: false,
			stripOverlayHistory: true,
		});
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
	closeSpaPageOverlay();
}

export function dismissEntireSpaPageOverlay() {
	if (!isSpaPageOverlayOpen()) return;
	fallbackDismissEntireSpaPageOverlay();
}

export const dismissEntireCreationDetailOverlay = dismissEntireSpaPageOverlay;
export const dismissEntirePromptLibraryOverlay = dismissEntireSpaPageOverlay;

function dismissSpaPageOverlayViaHistory() {
	if (!isSpaPageOverlayOpen()) return;
	try {
		window.history.back();
	} catch {
		// ignore
	}
}

/**
 * @param {PopStateEvent} [ev]
 * @returns {boolean}
 */
export function handleSpaPageOverlayPopstate(ev) {
	if (!isSpaPageOverlayOpen()) return false;

	const store = getOverlayStore();
	if (store.overlayDismissEntirePending) {
		store.overlayDismissEntirePending = false;
		store.overlayPushCount = 0;
		closeSpaPageOverlay({ fromPopstate: true });
		if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
		return true;
	}

	const state = window.history?.state;
	const stillInOverlayStack = Boolean(state?.[HISTORY_FLAG]);

	if (stillInOverlayStack) {
		const locPath = window.location.pathname + window.location.search + window.location.hash;
		if (store.overlayFramePath && locPath === store.overlayFramePath) {
			fallbackDismissEntireSpaPageOverlay();
			if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
			return true;
		}
		syncOverlayFrameFromLocation();
		if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
		return true;
	}

	closeSpaPageOverlay({ fromPopstate: true });
	if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
	return true;
}

export const handleCreationDetailOverlayPopstate = handleSpaPageOverlayPopstate;
export const handlePromptLibraryOverlayPopstate = handleSpaPageOverlayPopstate;

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

function syncOverlayHashFromEmbed(hash) {
	const store = getOverlayStore();
	if (!isSpaPageOverlayOpen()) return;
	const rawHash = String(hash || '').trim();
	const normalized = rawHash.startsWith('#') ? rawHash : rawHash ? `#${rawHash}` : '';
	const canonicalUrl = `/prompt-library${normalized}`;
	store.overlayFramePath = canonicalUrl;
	try {
		const returnPath = overlayReturnPathFromStore();
		window.history.replaceState(
			buildOverlayHistoryState({ kind: 'prompt-library', creationId: null, canonicalUrl }, returnPath),
			'',
			canonicalUrl
		);
	} catch {
		// ignore
	}
}

function ensureOverlayMessageListener() {
	if (document.documentElement.dataset.prsnSpaOverlayMsgBound === '1') return;
	document.documentElement.dataset.prsnSpaOverlayMsgBound = '1';
	window.addEventListener('message', (event) => {
		if (event.origin !== window.location.origin) return;
		const data = event.data;
		if (!data || typeof data !== 'object') return;

		const routeTypes = new Set([
			'prsn-spa-page-overlay-route',
			'prsn-creation-detail-overlay-route',
			'prsn-prompt-library-overlay-route',
		]);
		const closeTypes = new Set([
			'prsn-spa-page-overlay-close',
			'prsn-creation-detail-overlay-close',
			'prsn-prompt-library-overlay-close',
		]);
		const shellOutTypes = new Set([
			'prsn-spa-page-overlay-shell-out',
			'prsn-creation-detail-overlay-shell-out',
		]);

		if (data.type === 'prsn-open-inline-lightbox') {
			openInlineLightboxFromEmbed(data);
			return;
		}
		if (closeTypes.has(data.type)) {
			dismissEntireSpaPageOverlay();
			return;
		}
		if (shellOutTypes.has(data.type)) {
			shellOutFromSpaPageOverlay(data.href);
			return;
		}
		if (routeTypes.has(data.type)) {
			routeSpaPageOverlayFromEmbed(data.href, { forceReload: Boolean(data.forceReload) });
			return;
		}
		if (data.type === 'prsn-creation-detail-overlay-navigate') {
			const id = Number(data.creationId);
			if (Number.isFinite(id) && id > 0) {
				openSpaPageOverlayFromHref(`/creations/${id}`);
			}
			return;
		}
		if (data.type === WORKFLOW_DISMISS_MESSAGE) {
			try {
				document.dispatchEvent(new CustomEvent('creations-pending-updated'));
			} catch {
				// ignore
			}
			fallbackDismissEntireSpaPageOverlay({ preferMyCreations: true });
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
				reloadSpaOverlayFrame();
			}
			return;
		}
		if (data.type === 'prsn-prompt-library-overlay-hash') {
			syncOverlayHashFromEmbed(data.hash);
			return;
		}
		if (data.type === SPA_OVERLAY_EMBED_READY_MESSAGE) {
			const store = getOverlayStore();
			handleOverlayEmbedReady(store.overlayFrame, data.href, overlayFramePendingGeneration);
		}
	});
}

function ensureOverlayPopstateListener() {
	if (document.documentElement.dataset.prsnSpaOverlayPopstateBound === '1') return;
	document.documentElement.dataset.prsnSpaOverlayPopstateBound = '1';
	window.addEventListener('popstate', (ev) => {
		handleSpaPageOverlayPopstate(ev);
	}, true);
}

function ensureOverlayEscapeListener() {
	if (document.documentElement.dataset.prsnSpaOverlayEscapeBound === '1') return;
	document.documentElement.dataset.prsnSpaOverlayEscapeBound = '1';
	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			if (!isSpaPageOverlayOpen()) return;
			e.preventDefault();
			dismissEntireSpaPageOverlay();
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
	const kind = target?.kind || 'creation-detail';
	const toolbar = document.createElement('header');
	toolbar.className = 'creation-detail-overlay-chrome';
	toolbar.setAttribute('aria-label', overlayTitleForKind(kind));

	const backBtn = document.createElement('button');
	backBtn.type = 'button';
	backBtn.className = 'chat-page-mobile-chrome-back';
	backBtn.setAttribute('aria-label', 'Back');
	backBtn.innerHTML = '<span class="chat-page-back-icon" aria-hidden="true">&lt;-</span>';
	backBtn.addEventListener('click', () => dismissSpaPageOverlayViaHistory());

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
	closeBtn.addEventListener('click', () => dismissEntireSpaPageOverlay());

	toolbar.append(backBtn, title, closeBtn);

	const frame = document.createElement('iframe');
	frame.className = 'creation-detail-overlay-frame is-overlay-loading';
	frame.setAttribute('title', frameTitleForTarget(target));
	frame.setAttribute('loading', 'eager');
	const shellBg = getParentShellBackgroundColor();
	if (shellBg) {
		frame.style.backgroundColor = shellBg;
	}
	ensureOverlayFrameLoadHandler(frame);

	const veil = document.createElement('div');
	veil.className = `${OVERLAY_FRAME_VEIL_CLASS} is-active`;
	veil.setAttribute('aria-hidden', 'false');

	return { toolbar, frame, veil };
}

function mountSpaPageOverlayShell(target, store) {
	for (const legacyId of ['prsn-creation-detail-overlay', 'prsn-prompt-library-overlay', OVERLAY_ID]) {
		const orphaned = document.getElementById(legacyId);
		if (orphaned instanceof HTMLElement) orphaned.remove();
	}

	store.overlayCreationId = target.creationId;
	store.overlayPage = target.kind;
	store.overlayFramePath = target.canonicalUrl;

	const shell = document.createElement('div');
	shell.id = OVERLAY_ID;
	shell.className = 'creation-detail-overlay';
	shell.setAttribute('role', 'dialog');
	shell.setAttribute('aria-modal', 'true');

	const { toolbar, frame, veil } = buildOverlayChrome(target);
	shell.append(frame, veil, toolbar);
	captureOverlayScrollPositions();
	lockOverlayBodyScroll();
	document.body.appendChild(shell);
	document.body.classList.add('creation-detail-overlay-open');

	store.overlayEl = shell;
	store.overlayFrame = frame;

	assignOverlayFrameUrl(frame, target.embedUrl, target);
	pushOverlayHistoryForTarget(target);
}

/**
 * @param {string} href
 * @param {{ forceReload?: boolean }} [options]
 */
export function openSpaPageOverlayFromHref(href, options = {}) {
	const target = parseSpaOverlayTarget(href, { bustCache: Boolean(options.forceReload) });
	if (!target) {
		shellOutFromSpaPageOverlay(href);
		return;
	}

	const store = getOverlayStore();

	ensureOverlayMessageListener();
	ensureOverlayPopstateListener();
	ensureOverlayEscapeListener();

	if (isSpaPageOverlayOpen() && store.overlayFrame) {
		if (store.overlayFramePath === target.canonicalUrl) {
			if (options.forceReload) {
				syncOverlayFrameToTarget(target, { forceReload: true });
			}
		} else {
			syncOverlayFrameToTarget(target);
			pushOverlayHistoryForTarget(target, { stackPush: true });
		}
		return;
	}

	if (isSpaPageOverlayOpen()) {
		closeSpaPageOverlay();
	}

	mountSpaPageOverlayShell(target, store);
}

export const openWorkflowOverlayFromHref = openSpaPageOverlayFromHref;
export const openPromptLibraryOverlayFromHref = openSpaPageOverlayFromHref;

export function openCreationDetailOverlay(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return;
	openSpaPageOverlayFromHref(`/creations/${encodeURIComponent(String(id))}`);
}

export function navigateToSpaPageFromSpa(href, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	if (!parseSpaOverlayTarget(href) || !shouldUseSpaPageOverlay()) {
		window.location.assign(href);
		return;
	}
	openSpaPageOverlayFromHref(href);
}

export function navigateToMutateFromSpa(href, ev) {
	navigateToSpaPageFromSpa(href, ev);
}

export function navigateToCreateFromSpa(href = '/create', ev, options = {}) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	if (!parseSpaOverlayTarget(href) || !shouldUseSpaPageOverlay()) {
		window.location.assign(href);
		return;
	}
	openSpaPageOverlayFromHref(href, { forceReload: Boolean(options.forceReload) });
}

export function navigateToCreationDetailFromSpa(href, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	const id = parseCreationNavigationTargetId(href);
	const detailPath = id ? `/creations/${id}` : '';
	if (!id || !shouldUseSpaPageOverlay()) {
		window.location.assign(href);
		return;
	}
	openSpaPageOverlayFromHref(detailPath);
}

export const navigateToPromptLibraryFromSpa = navigateToSpaPageFromSpa;

function shouldInterceptSpaOverlayLink(link, e) {
	if (!(link instanceof HTMLAnchorElement)) return false;
	if (e.defaultPrevented) return false;
	if (typeof e.button === 'number' && e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	if (link.target === '_blank' || link.hasAttribute('download')) return false;
	if (link.hasAttribute('data-chat-doom-comments')) return false;
	const href = (link.getAttribute('href') || '').trim();
	if (!href || href.startsWith('#')) return false;
	return true;
}

function bindSpaPageOverlayLinkIntercepts() {
	if (document.documentElement.dataset.prsnSpaOverlayLinkInterceptBound === '1') return;
	document.documentElement.dataset.prsnSpaOverlayLinkInterceptBound = '1';
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a[href]');
			if (!shouldInterceptSpaOverlayLink(link, e)) return;

			let url;
			try {
				url = new URL(link.getAttribute('href') || '', window.location.origin);
				if (url.origin !== window.location.origin) return;
			} catch {
				return;
			}

			const path = normalizePath(url.pathname);
			if (!matchSpaOverlayKind(path)) return;
			if (!shouldUseSpaPageOverlay()) return;

			e.preventDefault();
			e.stopPropagation();
			openSpaPageOverlayFromHref(url.pathname + url.search + url.hash);
		},
		true
	);
}

ensureOverlayMessageListener();
ensureOverlayPopstateListener();
ensureOverlayEscapeListener();
bindSpaPageOverlayLinkIntercepts();
