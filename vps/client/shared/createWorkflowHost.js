/** Native Create host supplied by its mounted controller. */

/** @typedef {{
 *   root?: HTMLElement | null,
 *   onNavigate?: (href: string, options?: { forceReload?: boolean }) => void,
 *   onDismiss?: (options?: { creationId?: number }) => void,
 *   onShellOut?: (href: string) => void,
 *   onClose?: () => void,
 *   onSwitchEditor?: (mode: string) => void,
 *   onShellSync?: (payload: object) => void,
 * }} CreateWorkflowHost */

let moduleHost = null;
function readHost() { return moduleHost; }
function writeHost(next) { moduleHost = next && typeof next === 'object' ? next : null; }

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
	const overlay = moduleHost?.root;
	if (overlay instanceof HTMLElement) return overlay;
	return document.body;
}
