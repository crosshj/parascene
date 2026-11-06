/**
 * Native create/mutate overlay host. When set, create/mutate runtimes
 * navigate via callbacks instead of iframe postMessage.
 *
 * Host is stored on window so every module copy (bare vs `?v=` cache-bust)
 * shares the same overlay callbacks. `let host` in this file would split
 * across those copies and skip post-submit dismiss.
 */

/** @typedef {{
 *   root?: HTMLElement | null,
 *   onNavigate?: (href: string, options?: { forceReload?: boolean }) => void,
 *   onDismiss?: (options?: { creationId?: number }) => void,
 *   onShellOut?: (href: string) => void,
 *   onClose?: () => void,
 *   onShellSync?: (payload: object) => void,
 * }} CreateWorkflowHost */

const HOST_KEY = '__prsnCreateWorkflowHost';

/** @type {CreateWorkflowHost | null} */
let moduleHost = null;

function readHost() {
	if (typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, HOST_KEY)) {
		return window[HOST_KEY];
	}
	return moduleHost;
}

/** @param {CreateWorkflowHost | null} next */
function writeHost(next) {
	const value = next && typeof next === 'object' ? next : null;
	moduleHost = value;
	if (typeof window !== 'undefined') {
		window[HOST_KEY] = value;
	}
}

/** @param {CreateWorkflowHost | null} next */
export function setCreateWorkflowHost(next) {
	writeHost(next);
}

export function clearCreateWorkflowHost() {
	writeHost(null);
}

/** @returns {CreateWorkflowHost | null} */
export function getCreateWorkflowHost() {
	return readHost();
}

export function isCreateWorkflowNativeHost() {
	return Boolean(readHost());
}

/**
 * Mount point for in-workflow dialogs. Prefer the SPA overlay shell so they
 * stack above overlay chrome instead of under it on document.body.
 * @returns {HTMLElement}
 */
export function getCreateWorkflowModalParent() {
	const overlay = typeof document !== 'undefined'
		? document.querySelector('.creation-detail-overlay')
		: null;
	if (overlay instanceof HTMLElement) return overlay;
	return document.body;
}
