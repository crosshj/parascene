/**
 * User profile page runtime — standalone and embed (`?embed=1`).
 */

import { createEmbedPageRuntime } from './embedPageRuntime.js';

const runtime = createEmbedPageRuntime('__ps_profile_embed');

export const isProfilePageEmbed = runtime.isEmbed;
export const isProfilePageEmbedFrame = runtime.isEmbedFrame;
export const navigate = runtime.navigate;
export const shellOut = runtime.shellOut;
export const requestCloseOverlay = runtime.requestCloseOverlay;
export const navigateFromModal = runtime.navigateFromModal;
export const bindProfilePageEmbedNavigation = runtime.bindEmbedNavigation;
export const bindProfilePageEmbedEscape = runtime.bindEmbedEscape;

/**
 * @param {ParentNode} [root]
 */
export function bindProfileEmbedDmLinks(root) {
	if (!runtime.isEmbed()) return;
	const scope = root instanceof Element || root instanceof DocumentFragment ? root : document;
	for (const link of scope.querySelectorAll('a.user-profile-dm[href]')) {
		if (!(link instanceof HTMLAnchorElement)) continue;
		if (link.dataset.profileDmShellOutBound === '1') continue;
		link.dataset.profileDmShellOutBound = '1';
		link.addEventListener(
			'click',
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const href = (link.getAttribute('href') || '').trim();
				if (!href) return;
				runtime.shellOut(href);
			},
			true
		);
	}
}

/**
 * @param {string} href
 */
export function navigateToCreation(href) {
	const raw = String(href || '').trim();
	if (!raw) return;
	if (isProfilePageEmbedFrame()) {
		runtime.navigate(raw);
		return;
	}
	window.location.assign(raw);
}
