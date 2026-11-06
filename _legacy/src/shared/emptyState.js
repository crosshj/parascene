/**
 * Shared empty-state UI. Returns HTML string for .route-empty blocks:
 * loading skeletons, or icon + title + message + optional CTA button.
 * Callers set container.innerHTML = renderEmptyState({ ... }).
 */

import {
	renderChallengePaneSkeleton,
	renderChatThreadSkeleton,
	renderFeedCardsSkeleton,
	renderGridSkeleton,
} from './skeleton.js';

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
 * @param {string} [className]
 * @param {string} [explicitVariant]
 * @returns {'feed' | 'grid' | 'chat-thread' | 'challenge'}
 */
function resolveLoadingVariant(className, explicitVariant) {
	if (explicitVariant) return explicitVariant;
	const cls = String(className || '');
	if (cls.includes('chat-page-thread-loading')) return 'chat-thread';
	if (cls.includes('challenge-pane')) return 'challenge';
	if (cls.includes('feed')) return 'feed';
	return 'grid';
}

/**
 * @param {'feed' | 'grid' | 'chat-thread' | 'challenge'} variant
 * @returns {string}
 */
function renderLoadingSkeletonContent(variant) {
	switch (variant) {
		case 'feed':
			return renderFeedCardsSkeleton(4);
		case 'chat-thread':
			return renderChatThreadSkeleton();
		case 'challenge':
			return renderChallengePaneSkeleton();
		default:
			return `<div class="content-cards-image-grid route-loading-grid-inner">${renderGridSkeleton(12)}</div>`;
	}
}

/**
 * @param {{
 *   loading?: boolean;
 *   loadingVariant?: 'feed' | 'grid' | 'chat-thread' | 'challenge';
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
		loadingVariant,
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
		const variant = resolveLoadingVariant(className, loadingVariant);
		const inner = renderLoadingSkeletonContent(variant);
		return `<div class="route-empty route-loading route-loading-skeleton route-loading-skeleton--${variant}${extraClass}" aria-busy="true" aria-label="${escapeHtml(loadingAriaLabel)}">${inner}</div>`;
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
 * @param {{ className?: string; loadingAriaLabel?: string; loadingVariant?: 'feed' | 'grid' | 'chat-thread' | 'challenge' }} options
 * @returns {string}
 */
export function renderEmptyLoading(options = {}) {
	const { className = 'route-empty-image-grid', loadingAriaLabel = 'Loading', loadingVariant } = options;
	return renderEmptyState({ loading: true, className, loadingAriaLabel, loadingVariant });
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

const PANE_LOAD_ERROR_ICON_DEFAULT = `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

/**
 * Full empty-state for failed pane loads (chat thread, pseudo-channel, etc.): icon + title + message.
 * @param {string} message — detail line (escaped)
 * @param {{ title?: string, icon?: string, buttonText?: string, buttonHref?: string, buttonRoute?: string, className?: string }} [options]
 * @returns {string}
 */
export function renderPaneLoadError(message, options = {}) {
	const title =
		typeof options.title === 'string' && options.title.trim()
			? options.title.trim()
			: "Couldn't load this";
	const body =
		typeof message === 'string' && message.trim()
			? message.trim()
			: 'Something went wrong. Please try again in a moment.';
	const icon =
		typeof options.icon === 'string' && options.icon.trim() ? options.icon.trim() : PANE_LOAD_ERROR_ICON_DEFAULT;
	const extra = options.className ? ` ${String(options.className).trim()}` : '';
	const className = `route-empty-image-grid chat-page-pane-load-error${extra}`.trim();
	return renderEmptyState({
		className,
		icon,
		title,
		message: body,
		buttonText: options.buttonText || '',
		buttonHref: options.buttonHref || '',
		buttonRoute: options.buttonRoute || '',
	});
}
