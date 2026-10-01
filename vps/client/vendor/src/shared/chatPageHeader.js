/**
 * Nested chat SPA header: back + title + trailing actions.
 * Default (frosted) and transparent (doom) variants share one back SVG.
 */

import { arrowBackIcon } from '/icons/svg-strings.js';

export const CHAT_PAGE_BACK_ICON_HTML = arrowBackIcon('chat-page-back-icon chat-page-back-icon-svg');

/**
 * @param {{ ariaLabel?: string, extraClass?: string }} [opts]
 * @returns {HTMLButtonElement}
 */
export function createChatPageBackButton(opts = {}) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = ['chat-page-back', String(opts.extraClass || '').trim()].filter(Boolean).join(' ');
	btn.setAttribute('aria-label', opts.ariaLabel || 'Back');
	btn.innerHTML = CHAT_PAGE_BACK_ICON_HTML;
	return btn;
}

/**
 * @param {{
 *   variant?: 'default' | 'transparent',
 *   ariaLabel?: string,
 *   extraClass?: string,
 *   titleHtml?: string,
 *   trailing?: Array<Node | null | undefined>,
 *   backAriaLabel?: string,
 * }} [opts]
 * @returns {{ header: HTMLElement, back: HTMLButtonElement, title: HTMLHeadingElement, actions: HTMLElement }}
 */
export function createChatPageHeader(opts = {}) {
	const variant = opts.variant === 'transparent' ? 'transparent' : 'default';
	const header = document.createElement('header');
	header.className = [
		'chat-page-header',
		variant === 'transparent' ? 'chat-page-header--transparent' : '',
		String(opts.extraClass || '').trim(),
	]
		.filter(Boolean)
		.join(' ');
	header.setAttribute('aria-label', opts.ariaLabel || 'Page navigation');

	const back = createChatPageBackButton({ ariaLabel: opts.backAriaLabel || 'Back' });

	const title = document.createElement('h1');
	title.className = 'chat-page-header-title chat-page-title';
	title.innerHTML =
		typeof opts.titleHtml === 'string' && opts.titleHtml
			? opts.titleHtml
			: '<span class="chat-page-header-title-text"></span>';

	const actions = document.createElement('div');
	actions.className = 'chat-page-header-actions';
	const trailing = Array.isArray(opts.trailing) ? opts.trailing : [];
	for (const node of trailing) {
		if (node instanceof Node) actions.appendChild(node);
	}

	header.append(back, title, actions);
	return { header, back, title, actions };
}
