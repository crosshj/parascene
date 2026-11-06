/**
 * Shared clear control for prompt textareas/inputs (basic create "clear" link pattern + compact × button).
 */

const CLEAR_ICON_SVG = `<svg class="prompt-field-clear-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

/**
 * @param {HTMLTextAreaElement | HTMLInputElement} field
 * @returns {boolean}
 */
function fieldHasValue(field) {
	return Boolean((field.value || '').trim());
}

/**
 * @param {HTMLElement} wrap
 * @param {boolean} empty
 */
function syncEmptyWrapClass(wrap, empty) {
	if (!wrap?.classList?.contains('create-prompt-wrap')) return;
	wrap.classList.toggle('is-empty', empty);
}

/**
 * @param {HTMLElement} clearEl
 * @param {'link' | 'icon'} variant
 * @param {boolean} visible
 */
function syncClearVisibility(clearEl, variant, visible) {
	if (variant === 'link') {
		clearEl.classList.toggle('is-visible', visible);
		return;
	}
	if (visible) {
		clearEl.hidden = false;
		clearEl.classList.add('is-visible');
	} else {
		clearEl.hidden = true;
		clearEl.classList.remove('is-visible');
	}
}

/**
 * @param {HTMLTextAreaElement | HTMLInputElement} field
 * @param {{
 *   variant?: 'link' | 'icon',
 *   wrap?: HTMLElement | null,
 *   wrapClass?: string,
 *   onClear?: () => void,
 *   afterClear?: () => void,
 *   trackEmpty?: boolean,
 * }} [options]
 * @returns {{ wrap: HTMLElement, clearEl: HTMLElement, update: () => void } | null}
 */
export function attachPromptFieldClear(field, options = {}) {
	if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return null;

	const variant = options.variant === 'icon' ? 'icon' : 'link';
	const trackEmpty = options.trackEmpty !== false;

	let wrap =
		options.wrap instanceof HTMLElement
			? options.wrap
			: field.closest('.create-prompt-wrap, .prompt-field-wrap');

	if (!(wrap instanceof HTMLElement)) {
		wrap = document.createElement('div');
		wrap.className = options.wrapClass || 'create-prompt-wrap';
		const parent = field.parentNode;
		if (!parent) return null;
		parent.insertBefore(wrap, field);
		wrap.appendChild(field);
	}

	let clearEl = wrap.querySelector('[data-prompt-clear]');
	if (!(clearEl instanceof HTMLElement)) {
		clearEl = wrap.querySelector(variant === 'icon' ? '.prompt-field-clear-icon' : '.create-prompt-clear');
	}

	if (!(clearEl instanceof HTMLElement)) {
		if (variant === 'icon') {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'prompt-field-clear-icon';
			btn.setAttribute('data-prompt-clear', '');
			btn.setAttribute('aria-label', 'Clear prompt');
			btn.hidden = true;
			btn.innerHTML = CLEAR_ICON_SVG;
			clearEl = btn;
		} else {
			const link = document.createElement('a');
			link.href = '#';
			link.className = 'create-prompt-clear';
			link.setAttribute('data-prompt-clear', '');
			link.setAttribute('tabindex', '-1');
			link.setAttribute('aria-label', 'Clear field');
			link.textContent = 'clear';
			clearEl = link;
		}
		wrap.appendChild(clearEl);
	}

	function update() {
		const hasValue = fieldHasValue(field);
		syncClearVisibility(clearEl, variant, hasValue);
		if (trackEmpty) syncEmptyWrapClass(wrap, !hasValue);
	}

	function clearField(e) {
		e?.preventDefault?.();
		field.value = '';
		update();
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
		if (typeof options.onClear === 'function') options.onClear();
		if (typeof options.afterClear === 'function') options.afterClear();
		try {
			field.focus({ preventScroll: true });
		} catch {
			field.focus();
		}
	}

	clearEl.addEventListener('click', clearField);
	field.addEventListener('input', update);
	field.addEventListener('change', update);
	update();

	return { wrap, clearEl, update };
}

/**
 * @param {ParentNode | null | undefined} root
 * @param {{
 *   selector?: string,
 *   variant?: 'link' | 'icon',
 *   afterClear?: () => void,
 * }} [options]
 */
export function attachPromptFieldClearAll(root, options = {}) {
	if (!root) return;
	const selector =
		options.selector ||
		'.create-prompt-wrap .create-prompt-input, .create-prompt-wrap .prompt-editor, .create-prompt-wrap textarea, .create-prompt-wrap input[type="text"]';
	root.querySelectorAll(selector).forEach((field) => {
		if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return;
		const wrap = field.closest('.create-prompt-wrap, .prompt-field-wrap');
		attachPromptFieldClear(field, {
			variant: options.variant,
			wrap,
			afterClear: options.afterClear,
		});
	});
}
