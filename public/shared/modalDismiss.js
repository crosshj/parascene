/** Settings-modal dismiss icon (22×22 stroke X). */
export const MODAL_DISMISS_ICON_SVG =
	'<svg class="modal-dismiss-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

/**
 * @param {{ label?: string, extraClass?: string, attrs?: Record<string, string> }} [opts]
 * @returns {HTMLButtonElement}
 */
export function createModalDismissButton(opts = {}) {
	const { label = 'Close', extraClass = '', attrs = {} } = opts;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = ['modal-dismiss', extraClass].filter(Boolean).join(' ');
	btn.setAttribute('aria-label', label);
	btn.innerHTML = MODAL_DISMISS_ICON_SVG;
	for (const [key, value] of Object.entries(attrs)) {
		btn.setAttribute(key, value);
	}
	return btn;
}
