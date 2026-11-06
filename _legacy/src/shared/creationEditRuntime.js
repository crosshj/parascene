/**
 * Creation mutate page runtime — native overlay host (mutate workflow mounted in parent DOM).
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

export function isCreationEditEmbed() {
	return isCreateWorkflowNativeHost();
}

function postToParentOverlay(payload) {
	const host = getCreateWorkflowHost();
	if (!host) return false;
	if (payload?.type === ROUTE_MESSAGE && typeof host.onNavigate === 'function') {
		host.onNavigate(payload.href);
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
 * @param {string} href
 */
export function navigate(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return;

	if (isExternalNavigationHref(raw)) {
		window.location.assign(raw);
		return;
	}

	if (isCreationEditEmbed()) {
		postToParentOverlay({ type: ROUTE_MESSAGE, href: raw });
		return;
	}

	window.location.assign(raw);
}

/** Leave overlay for a full-page route the parent cannot host in-frame. */
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

export function requestCloseOverlay() {
	return postToParentOverlay({ type: CLOSE_MESSAGE });
}

/**
 * After successful mutate submit: sync parent lanes and dismiss overlay.
 * @param {{ creationId?: number|string }} [options]
 */
export function refreshAfterSubmit(options = {}) {
	if (!isCreateWorkflowNativeHost()) return;

	const creationId = Number(options.creationId);
	const reason = 'mutate-submitted';
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

export function bindCreationEditEmbedNavigation() {
	if (!isCreationEditEmbed()) return;
	if (document.documentElement.dataset.prsnMutateEmbedNavBound === '1') return;
	document.documentElement.dataset.prsnMutateEmbedNavBound = '1';
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a[href]');
			if (!shouldInterceptEmbedLink(link, e)) return;
			if (
				link.classList.contains('create-switch-to-advanced') ||
				link.hasAttribute('data-mutate-advanced-mode')
			) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			navigate(link.getAttribute('href') || '');
		},
		true
	);
}

/**
 * @param {() => boolean} hasOpenEscapeTarget
 */
export function bindCreationEditEmbedEscape(hasOpenEscapeTarget) {
	if (!isCreationEditEmbed()) return;
	if (document.documentElement.dataset.prsnMutateEmbedEscBound === '1') return;
	document.documentElement.dataset.prsnMutateEmbedEscBound = '1';
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
