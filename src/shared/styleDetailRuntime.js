/**
 * Style detail page runtime — standalone and embed (`?embed=1`).
 */

import { createEmbedPageRuntime } from './embedPageRuntime.js';

const runtime = createEmbedPageRuntime('__ps_style_embed');

export const isStyleDetailEmbed = runtime.isEmbed;
export const isStyleDetailEmbedFrame = runtime.isEmbedFrame;
export const navigate = runtime.navigate;
export const shellOut = runtime.shellOut;
export const requestCloseOverlay = runtime.requestCloseOverlay;
export const navigateFromModal = runtime.navigateFromModal;
export const bindStyleDetailEmbedNavigation = runtime.bindEmbedNavigation;
export const bindStyleDetailEmbedEscape = runtime.bindEmbedEscape;

/**
 * @param {string} href
 */
export function assignStyleDetailLocation(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	if (isStyleDetailEmbedFrame()) {
		runtime.navigate(raw);
		return;
	}
	window.location.href = raw;
}
