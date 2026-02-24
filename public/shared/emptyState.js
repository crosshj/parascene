/**
 * Shared empty-state UI. Returns HTML string for .route-empty blocks:
 * loading spinner, or icon + title + message + optional CTA button.
 * Callers set container.innerHTML = renderEmptyState({ ... }).
 */

function escapeHtml(text) {
	if (text == null) return '';
	const s = String(text);
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * @param {{
 *   loading?: boolean;
 *   title?: string;
 *   message?: string;
 *   messageHtml?: string;
 *   buttonText?: string;
 *   buttonHref?: string;
 *   buttonRoute?: string;
 *   icon?: string;
 *   className?: string;
 *   loadingAriaLabel?: string;
 *   rawContent?: string;
 * }} options
 * @returns {string} HTML string
 */
export function renderEmptyState(options = {}) {
	const {
		loading = false,
		title = '',
		message = '',
		messageHtml: messageHtmlRaw = '',
		buttonText = '',
		buttonHref = '',
		buttonRoute = '',
		icon = '',
		className = '',
		loadingAriaLabel = 'Loading',
		rawContent = '',
	} = options;

	const extraClass = className ? ` ${className}`.trim() : '';

	if (loading) {
		return `<div class="route-empty route-loading${extraClass}"><div class="route-loading-spinner" aria-label="${escapeHtml(loadingAriaLabel)}" role="status"></div></div>`;
	}

	if (rawContent) {
		return `<div class="route-empty${extraClass}">${rawContent}</div>`;
	}

	const titleHtml = title ? `<div class="route-empty-title">${escapeHtml(title)}</div>` : '';
	const messageHtml = messageHtmlRaw
		? `<div class="route-empty-message">${messageHtmlRaw}</div>`
		: message
			? `<div class="route-empty-message">${escapeHtml(message)}</div>`
			: '';
	let buttonHtml = '';
	if (buttonText && (buttonHref || buttonRoute)) {
		const href = buttonHref || '#';
		const attrs = buttonRoute ? ` href="${escapeHtml(href)}" data-route="${escapeHtml(buttonRoute)}"` : ` href="${escapeHtml(href)}"`;
		buttonHtml = `<a class="route-empty-button"${attrs}>${escapeHtml(buttonText)}</a>`;
	}

	const iconHtml = icon ? `<div class="route-empty-icon">${icon}</div>` : '';
	const hasState = icon || title || message || buttonHtml;
	const stateClass = hasState ? ' route-empty-state' : '';

	return `<div class="route-empty${stateClass}${extraClass}">${iconHtml}${titleHtml}${messageHtml}${buttonHtml}</div>`;
}

/**
 * Loading only, for image-grid context (full-width empty cell).
 * @param {{ className?: string; loadingAriaLabel?: string }} options
 * @returns {string}
 */
export function renderEmptyLoading(options = {}) {
	const { className = 'route-empty-image-grid', loadingAriaLabel = 'Loading' } = options;
	return renderEmptyState({ loading: true, className, loadingAriaLabel });
}

/**
 * Error/simple one-liner (e.g. "Unable to load feed.").
 * @param {string} text
 * @param {{ className?: string }} options
 * @returns {string}
 */
export function renderEmptyError(text, options = {}) {
	const { className = '' } = options;
	return renderEmptyState({ rawContent: escapeHtml(text), className });
}
