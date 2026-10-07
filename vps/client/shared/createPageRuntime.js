/**
 * Create page runtime — native overlay host (create workflow mounted in parent DOM).
 */

import {
	getCreateWorkflowHost,
	isCreateWorkflowNativeHost,
} from './createWorkflowHost.js';
import {
	CREATION_DETAIL_SHELL_SYNC_MESSAGE,
	defaultScopesForCreationShellSyncReason,
	normalizeCreationDetailShellSyncScopes,
} from './creationDetailEmbedShell.js';
import { documentHasNestedEscapeLayer } from './escapeLayers.js';

const ROUTE_MESSAGE = 'prsn-creation-detail-overlay-route';
const CLOSE_MESSAGE = 'prsn-creation-detail-overlay-close';
const SHELL_OUT_MESSAGE = 'prsn-creation-detail-overlay-shell-out';
const DISMISS_MESSAGE = 'prsn-workflow-overlay-dismiss';
const CREATE_EDITOR_COOKIE = 'create_editor';

/** Shell handoff so create-form and composer submits share one trip onto My Creations. */
let afterSubmitHandoff = null;

/**
 * @param {{ sync?: (payload: object) => void, navigate?: (href: string, options?: object) => void } | null} next
 */
export function setAfterCreateSubmitHandoff(next) {
	afterSubmitHandoff = next && typeof next === 'object' ? next : null;
}

function postToParentOverlay(payload) {
	const host = getCreateWorkflowHost();
	if (!host) return false;
	if (payload?.type === ROUTE_MESSAGE && typeof host.onNavigate === 'function') {
		host.onNavigate(payload.href, { forceReload: Boolean(payload.forceReload), replace: Boolean(payload.replace) });
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
	} else {
		document.cookie = `${CREATE_EDITOR_COOKIE}=; path=/; max-age=0`;
	}
	document.dispatchEvent(new CustomEvent('create-editor-mode-change', { detail: { mode } }));
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
		const host = getCreateWorkflowHost();
  if (host?.onSwitchEditor) { host.onSwitchEditor(mode); return; }
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
			replace: Boolean(options.replace),
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
 * After a creation is accepted: refresh My Creations, then open that list.
 * Create form, mutate, import, and the composer all call this. The list owns
 * the card from here — queued, then generating, then the finished media.
 * @param {{ creationId?: number|string }} [options]
 */
export function refreshAfterSubmit(options = {}) {
	const creationId = Number(options.creationId);
	if (!(Number.isFinite(creationId) && creationId > 0)) return;

	const reason = 'create-submitted';
	const payload = {
		creationId,
		reason,
		scopes: normalizeCreationDetailShellSyncScopes(defaultScopesForCreationShellSyncReason(reason)),
	};

	if (typeof afterSubmitHandoff?.sync === 'function') afterSubmitHandoff.sync(payload);
	else {
		postToParentOverlay({
			type: CREATION_DETAIL_SHELL_SYNC_MESSAGE,
			creationId: payload.creationId,
			reason: payload.reason,
			scopes: payload.scopes,
		});
	}

	if (typeof afterSubmitHandoff?.navigate === 'function') {
		afterSubmitHandoff.navigate('/creations', { replace: true });
		return;
	}
	if (!isCreateWorkflowNativeHost() && typeof afterSubmitHandoff?.sync !== 'function') return;
	navigate('/creations', { replace: true });
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

const bindings = new WeakMap();

export function bindCreatePageEmbedNavigation() {
 const root = getCreateWorkflowHost()?.root;
 if (!root || bindings.has(root)) return;
 const controller = new AbortController();
 bindings.set(root, controller);
 root.addEventListener('click', (e) => {
  const link = e.target?.closest?.('a[href]');
  if (!shouldInterceptEmbedLink(link, e)) return;
  if (link.hasAttribute('data-create-switch-to-basic') || link.classList.contains('create-switch-to-basic')) return;
  e.preventDefault();
  e.stopPropagation();
  if (link.classList.contains('create-switch-to-advanced')) switchCreateEditorMode('advanced', e);
  else navigate(link.getAttribute('href'));
 }, { signal: controller.signal });
}

// Layout owns Escape and overlay dismissal. Nested feature dialogs handle Escape first.
export function bindCreatePageEmbedEscape() {}

export function releaseCreatePageBindings(root) {
 bindings.get(root)?.abort();
 bindings.delete(root);
}
