function esc(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Compact two-or-more option switch. Same shape as the organize Draft | Public control.
 * @param {{
 *   label: string,
 *   value: string,
 *   options: { id: string, label: string }[],
 *   name?: string,
 * }} opts
 */
export function segmentedControlHtml(opts) {
	const label = String(opts?.label || 'Options');
	const value = String(opts?.value || '');
	const name = String(opts?.name || '').trim();
	const options = Array.isArray(opts?.options) ? opts.options : [];
	const nameAttr = name ? ` data-segmented-name="${esc(name)}"` : '';
	const buttons = options
		.map((opt) => {
			const id = String(opt?.id || '');
			const on = id === value;
			return `<button type="button" class="segmented-control-option${on ? ' is-active' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-segmented-value="${esc(id)}" tabindex="${on ? '0' : '-1'}">${esc(opt?.label || id)}</button>`;
		})
		.join('');
	return `<div class="segmented-control" role="radiogroup" aria-label="${esc(label)}"${nameAttr} data-segmented-control>${buttons}</div>`;
}
