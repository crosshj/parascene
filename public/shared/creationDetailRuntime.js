/**
 * Creation detail page runtime — standalone and embed (`?embed=1`).
 * All navigation and post-mutation refresh from creation-detail + its modals should go through here.
 */

import { notifyCreationDetailEmbedShellSync } from './creationDetailEmbedShell.js';

const ROUTE_MESSAGE = 'prsn-creation-detail-overlay-route';
const SPA_ROUTE_MESSAGE = 'prsn-spa-page-overlay-route';
const CLOSE_MESSAGE = 'prsn-creation-detail-overlay-close';
const SHELL_OUT_MESSAGE = 'prsn-spa-page-overlay-shell-out';
const LEGACY_SHELL_OUT_MESSAGE = 'prsn-creation-detail-overlay-shell-out';

/** @type {null | (() => void | Promise<void>)} */
let refreshHandler = null;

export function isCreationDetailEmbed() {
	return window.__ps_creation_detail_embed === true;
}

export function isCreationDetailEmbedFrame() {
	return isCreationDetailEmbed() && window.parent !== window;
}

function postToParentOverlay(payload) {
	if (!isCreationDetailEmbedFrame()) return false;
	try {
		window.parent.postMessage(payload, window.location.origin);
		return true;
	} catch {
		return false;
	}
}

function resolveCreationId(options = {}) {
	const id = Number(options.creationId);
	if (Number.isFinite(id) && id > 0) return id;
	const m = String(window.location.pathname || '').match(/^\/creations\/(\d+)/);
	if (!m) return null;
	const fromPath = Number(m[1]);
	return Number.isFinite(fromPath) && fromPath > 0 ? fromPath : null;
}

/**
 * Register the page's `loadCreation` (or equivalent) for mutation refresh.
 * @param {() => void | Promise<void>} fn
 */
export function registerCreationDetailRefreshHandler(fn) {
	refreshHandler = typeof fn === 'function' ? fn : null;
}

/**
 * After a successful write: refresh iframe content; notify parent lanes in embed.
 * @param {string} reason
 * @param {{ creationId?: number|string, scopes?: string[], standaloneReload?: boolean, skipContentRefresh?: boolean }} [options]
 */
export async function refreshAfterMutation(reason, options = {}) {
	if (options.skipContentRefresh !== true && typeof refreshHandler === 'function') {
		await refreshHandler();
	}
	if (isCreationDetailEmbed()) {
		const creationId = resolveCreationId(options);
		if (creationId) {
			notifyCreationDetailEmbedShellSync({
				creationId,
				reason,
				scopes: options.scopes,
			});
		}
		return;
	}
	if (options.standaloneReload === true) {
		window.location.reload();
	}
}

function isExternalNavigationHref(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return false;
	if (raw.startsWith('mailto:') || raw.startsWith('tel:')) return true;
	try {
		const url = new URL(raw, window.location.origin);
		return url.origin !== window.location.origin;
	} catch {
		return false;
	}
}

/**
 * Navigate from creation detail (link click, programmatic).
 * Embed: delegate to parent overlay. Standalone: full navigation.
 * @param {string} href
 */
export function navigate(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return;

	if (isExternalNavigationHref(raw)) {
		window.location.assign(raw);
		return;
	}

	if (isCreationDetailEmbed()) {
		postToParentOverlay({ type: SPA_ROUTE_MESSAGE, href: raw });
		postToParentOverlay({ type: ROUTE_MESSAGE, href: raw });
		return;
	}

	window.location.assign(raw);
}

/** Leave overlay and open a full-page route on the parent shell. */
export function shellOut(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return;

	if (isExternalNavigationHref(raw)) {
		window.location.assign(raw);
		return;
	}

	if (isCreationDetailEmbedFrame()) {
		postToParentOverlay({ type: SHELL_OUT_MESSAGE, href: raw });
		postToParentOverlay({ type: LEGACY_SHELL_OUT_MESSAGE, href: raw });
		return;
	}

	window.location.assign(raw);
}

export function requestCloseOverlay() {
	return postToParentOverlay({ type: CLOSE_MESSAGE });
}

/** Close modals then navigate (modal links, pageInit handler). */
export function navigateFromModal(href) {
	const raw = String(href || '').trim();
	if (!raw || raw === '#') return;
	document.dispatchEvent(new CustomEvent('close-all-modals'));
	navigate(raw);
}

function shouldInterceptEmbedLink(link, e) {
	if (!(link instanceof HTMLAnchorElement)) return false;
	if (e.defaultPrevented) return false;
	if (typeof e.button === 'number' && e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	if (link.classList.contains('user-text-inline-image-link')) return false;
	if (link.closest('.user-text-inline-image-link')) return false;
	if (link.closest('.connect-chat-creation-embed-inner--video')) return false;
	if (link.closest('.connect-chat-creation-embed-inner--group-carousel')) return false;
	if (link.closest('.connect-chat-creation-embed-inner--group-video-carousel')) return false;
	if (
		link.closest('.connect-chat-creation-embed-inner') &&
		!link.classList.contains('connect-chat-creation-embed-detail-link') &&
		!link.closest('.connect-chat-creation-embed-media-hover-bar')
	) {
		return false;
	}
	const href = (link.getAttribute('href') || '').trim();
	if (!href || href.startsWith('#')) return false;
	if (link.hasAttribute('download')) return false;
	if (link.target === '_blank') return false;
	if (isExternalNavigationHref(href)) return false;
	return true;
}

/**
 * Capture same-origin link clicks and delegate navigation to parent when embed.
 */
export function bindCreationDetailEmbedNavigation() {
	if (!isCreationDetailEmbed()) return;
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a[href]');
			if (!shouldInterceptEmbedLink(link, e)) return;
			e.preventDefault();
			e.stopPropagation();
			const href = link.getAttribute('href') || '';
			let path = '';
			try {
				path = new URL(href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
			} catch {
				path = '';
			}
			if (path.startsWith('/chat')) {
				shellOut(href);
				return;
			}
			navigate(href);
		},
		true
	);
}

/**
 * @param {() => boolean} hasOpenEscapeTarget
 */
export function bindCreationDetailEmbedEscape(hasOpenEscapeTarget) {
	if (!isCreationDetailEmbed()) return;
	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			if (typeof hasOpenEscapeTarget === 'function' && hasOpenEscapeTarget()) return;
			if (!requestCloseOverlay()) return;
			e.preventDefault();
			e.stopPropagation();
		},
		true
	);
}
