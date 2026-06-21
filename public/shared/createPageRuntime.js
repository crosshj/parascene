/**
 * Create page runtime — standalone and embed (`?embed=1`).
 */

import {
	CREATION_DETAIL_SHELL_SYNC_MESSAGE,
	defaultScopesForCreationShellSyncReason,
	normalizeCreationDetailShellSyncScopes,
} from './creationDetailEmbedShell.js';

const ROUTE_MESSAGE = 'prsn-creation-detail-overlay-route';
const CLOSE_MESSAGE = 'prsn-creation-detail-overlay-close';
const SHELL_OUT_MESSAGE = 'prsn-creation-detail-overlay-shell-out';
const DISMISS_MESSAGE = 'prsn-workflow-overlay-dismiss';
const CREATE_EDITOR_COOKIE = 'create_editor';

export function isCreatePageEmbed() {
	return window.__ps_create_embed === true;
}

export function isCreatePageEmbedFrame() {
	return isCreatePageEmbed() && window.parent !== window;
}

function isWorkflowEmbedFrame() {
	return (
		window.parent !== window &&
		(window.__ps_create_embed === true ||
			window.__ps_creation_edit_embed === true ||
			window.__ps_creation_detail_embed === true)
	);
}

function postToParentOverlay(payload) {
	if (!isWorkflowEmbedFrame()) return false;
	try {
		window.parent.postMessage(payload, window.location.origin);
		return true;
	} catch {
		return false;
	}
}

/** @param {'basic'|'advanced'} mode */
export function setCreateEditorMode(mode) {
	if (mode === 'basic') {
		document.cookie = `${CREATE_EDITOR_COOKIE}=simple; path=/; max-age=31536000`;
		return;
	}
	document.cookie = `${CREATE_EDITOR_COOKIE}=; path=/; max-age=0`;
}

/**
 * Switch basic ↔ advanced create (server picks template from cookie) and reload.
 * @param {'basic'|'advanced'} mode
 * @param {MouseEvent} [ev]
 */
export function switchCreateEditorMode(mode, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	setCreateEditorMode(mode);
	if (isWorkflowEmbedFrame()) {
		postToParentOverlay({ type: ROUTE_MESSAGE, href: '/create', forceReload: true });
		return;
	}
	window.location.assign('/create');
}

function isExternalNavigationHref(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return false;
	if (raw.startsWith('mailto:') || raw.startsWith('tel:')) return false;
	try {
		const url = new URL(raw, window.location.origin);
		return url.origin !== window.location.origin;
	} catch {
		return false;
	}
}

/**
 * @param {string} href
 * @param {{ forceReload?: boolean }} [options]
 */
export function navigate(href, options = {}) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return;

	if (isExternalNavigationHref(raw)) {
		window.location.assign(raw);
		return;
	}

	if (isCreatePageEmbed()) {
		postToParentOverlay({
			type: ROUTE_MESSAGE,
			href: raw,
			forceReload: Boolean(options.forceReload),
		});
		return;
	}

	window.location.assign(raw);
}

export function shellOut(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return;

	if (isExternalNavigationHref(raw)) {
		window.location.assign(raw);
		return;
	}

	if (isCreatePageEmbedFrame()) {
		postToParentOverlay({ type: SHELL_OUT_MESSAGE, href: raw });
		return;
	}

	window.location.assign(raw);
}

export function navigateFromModal(href) {
	const raw = String(href || '').trim();
	if (!raw || raw === '#') return;
	document.dispatchEvent(new CustomEvent('close-all-modals'));
	navigate(raw);
}

export function requestCloseOverlay() {
	return postToParentOverlay({ type: CLOSE_MESSAGE });
}

/** Standalone full-page navigation; shell-out when inside embed iframe. */
export function openFullPageRoute(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	if (isCreatePageEmbedFrame()) {
		postToParentOverlay({ type: SHELL_OUT_MESSAGE, href: raw });
		return;
	}
	window.location.assign(raw);
}

/**
 * @param {{ creationId?: number|string }} [options]
 */
export function refreshAfterSubmit(options = {}) {
	if (!isCreatePageEmbedFrame()) return;

	const creationId = Number(options.creationId);
	const reason = 'create-submitted';
	const scopes = defaultScopesForCreationShellSyncReason(reason);

	if (Number.isFinite(creationId) && creationId > 0) {
		postToParentOverlay({
			type: CREATION_DETAIL_SHELL_SYNC_MESSAGE,
			creationId,
			reason,
			scopes: normalizeCreationDetailShellSyncScopes(scopes),
		});
	}

	postToParentOverlay({ type: DISMISS_MESSAGE });
}

function shouldInterceptEmbedLink(link, e) {
	if (!(link instanceof HTMLAnchorElement)) return false;
	if (e.defaultPrevented) return false;
	if (typeof e.button === 'number' && e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	const href = (link.getAttribute('href') || '').trim();
	if (!href || href.startsWith('#')) return false;
	if (link.hasAttribute('download')) return false;
	if (link.target === '_blank') return false;
	if (isExternalNavigationHref(href)) return false;
	return true;
}

export function bindCreatePageEmbedNavigation() {
	if (!isCreatePageEmbed()) return;
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a[href]');
			if (!shouldInterceptEmbedLink(link, e)) return;
			const href = link.getAttribute('href') || '';
			if (/^\/create\/blog\//.test(href)) {
				e.preventDefault();
				e.stopPropagation();
				shellOut(href);
				return;
			}
			if (link.classList.contains('create-switch-to-advanced')) {
				e.preventDefault();
				e.stopPropagation();
				switchCreateEditorMode('advanced', e);
				return;
			}
			if (
				link.classList.contains('create-switch-to-basic') ||
				link.hasAttribute('data-create-switch-to-basic')
			) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			navigate(href);
		},
		true
	);
}

/**
 * @param {() => boolean} hasOpenEscapeTarget
 */
export function bindCreatePageEmbedEscape(hasOpenEscapeTarget) {
	if (!isCreatePageEmbed()) return;
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
