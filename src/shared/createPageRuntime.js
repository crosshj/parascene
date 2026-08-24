/**
 * Create page runtime — native overlay host (create workflow mounted in parent DOM).
 */

import {
	getCreateWorkflowHost,
	isCreateWorkflowNativeHost,
} from '/shared/createWorkflowHost.js';

const _qs = (() => {
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

const [creationDetailEmbedShellMod, escapeLayersMod] = await Promise.all([
	import(`/shared/creationDetailEmbedShell.js${_qs}`),
	import(`/shared/escapeLayers.js${_qs}`),
]);
const {
	CREATION_DETAIL_SHELL_SYNC_MESSAGE,
	defaultScopesForCreationShellSyncReason,
	normalizeCreationDetailShellSyncScopes,
} = creationDetailEmbedShellMod;
const { documentHasNestedEscapeLayer } = escapeLayersMod;

const ROUTE_MESSAGE = 'prsn-creation-detail-overlay-route';
const CLOSE_MESSAGE = 'prsn-creation-detail-overlay-close';
const SHELL_OUT_MESSAGE = 'prsn-creation-detail-overlay-shell-out';
const DISMISS_MESSAGE = 'prsn-workflow-overlay-dismiss';
const CREATE_EDITOR_COOKIE = 'create_editor';

function postToParentOverlay(payload) {
	const host = getCreateWorkflowHost();
	if (!host) return false;
	if (payload?.type === ROUTE_MESSAGE && typeof host.onNavigate === 'function') {
		host.onNavigate(payload.href, { forceReload: Boolean(payload.forceReload) });
		return true;
	}
	if (payload?.type === SHELL_OUT_MESSAGE && typeof host.onShellOut === 'function') {
		host.onShellOut(payload.href);
		return true;
	}
	if (payload?.type === CLOSE_MESSAGE && typeof host.onClose === 'function') {
		host.onClose();
		return true;
	}
	if (payload?.type === DISMISS_MESSAGE && typeof host.onDismiss === 'function') {
		host.onDismiss();
		return true;
	}
	if (payload?.type === CREATION_DETAIL_SHELL_SYNC_MESSAGE && typeof host.onShellSync === 'function') {
		host.onShellSync(payload);
		return true;
	}
	return false;
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
 * Switch basic ↔ advanced create and remount the native overlay.
 * @param {'basic'|'advanced'} mode
 * @param {MouseEvent} [ev]
 */
export function switchCreateEditorMode(mode, ev) {
	if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
	setCreateEditorMode(mode);
	if (isCreateWorkflowNativeHost()) {
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

	if (isCreateWorkflowNativeHost()) {
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

	if (isCreateWorkflowNativeHost()) {
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

/** Full-page navigation; shell-out when inside native create overlay. */
export function openFullPageRoute(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	if (isCreateWorkflowNativeHost()) {
		postToParentOverlay({ type: SHELL_OUT_MESSAGE, href: raw });
		return;
	}
	window.location.assign(raw);
}

/**
 * @param {{ creationId?: number|string }} [options]
 */
export function refreshAfterSubmit(options = {}) {
	if (!isCreateWorkflowNativeHost()) return;

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
	if (!isCreateWorkflowNativeHost()) return;
	if (document.documentElement.dataset.prsnCreateEmbedNavBound === '1') return;
	document.documentElement.dataset.prsnCreateEmbedNavBound = '1';
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
	if (!isCreateWorkflowNativeHost()) return;
	if (document.documentElement.dataset.prsnCreateEmbedEscBound === '1') return;
	document.documentElement.dataset.prsnCreateEmbedEscBound = '1';
	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			if (typeof hasOpenEscapeTarget === 'function' && hasOpenEscapeTarget()) return;
			if (documentHasNestedEscapeLayer()) return;
			if (!requestCloseOverlay()) return;
			e.preventDefault();
			e.stopPropagation();
		},
		true
	);
}
