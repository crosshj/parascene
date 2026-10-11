import { invalidateAppCaches } from './api.js';
import {
	openHashtagDestination,
	parseHashtagSlugFromTagPath,
} from './hashtagDestination.js';
import './hashtagDestination.css';

let refreshHandler = null;

export function isCreationDetailEmbed() { return false; }
export function isCreationDetailEmbedFrame() { return false; }

export function registerCreationDetailRefreshHandler(handler) {
	refreshHandler = typeof handler === 'function' ? handler : null;
}

export async function refreshAfterMutation(reason, options = {}) {
	invalidateAppCaches({
		tags: ['creations', 'feed', 'explore'],
		urls: ['/api/create/images'],
	});
	if (options.skipContentRefresh !== true && refreshHandler) await refreshHandler();
	document.dispatchEvent(new CustomEvent('creation-detail:mutation', {
		detail: { reason, ...options },
	}));
}

function internalHref(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return null;
	try {
		const url = new URL(raw, location.origin);
		return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
	} catch {
		return null;
	}
}

export function navigate(href) {
	const internal = internalHref(href);
	if (internal) {
		document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href: internal } }));
		return;
	}
	window.location.assign(href);
}

export const shellOut = navigate;

export function requestCloseOverlay() {
	document.dispatchEvent(new CustomEvent('parascene:dismiss-overlay'));
	return true;
}

export function navigateFromModal(href) {
	document.dispatchEvent(new CustomEvent('close-all-modals'));
	navigate(href);
}

/**
 * Handle a #tag click that maps to /t/:slug (channel-vs-tag resolve).
 * @param {string} slug
 */
export function requestHashtagIntent(slug) {
	const safe = String(slug || '')
		.trim()
		.toLowerCase();
	if (!safe) return;
	void openHashtagDestination(safe, { navigate });
}

function shouldInterceptHashtagMentionLink(link, e) {
	if (!(link instanceof HTMLAnchorElement)) return false;
	if (!link.classList.contains('mention-link')) return false;
	if (e.defaultPrevented) return false;
	if (typeof e.button === 'number' && e.button !== 0) return false;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
	const href = (link.getAttribute('href') || '').trim();
	if (!href || href.startsWith('#')) return false;
	if (link.hasAttribute('download')) return false;
	if (link.target === '_blank') return false;
	return Boolean(parseHashtagSlugFromTagPath(href));
}

/**
 * Intercept #tag mention links (chat, creation detail, comments, modals).
 */
export function bindCreationDetailHashtagClicks() {
	if (document.documentElement.dataset.prsnCreationHashtagBound === '1') return;
	document.documentElement.dataset.prsnCreationHashtagBound = '1';
	document.addEventListener(
		'click',
		(e) => {
			const link = e.target?.closest?.('a.mention-link[href]');
			if (!shouldInterceptHashtagMentionLink(link, e)) return;
			const href = link.getAttribute('href') || '';
			const slug = parseHashtagSlugFromTagPath(href);
			if (!slug) return;
			e.preventDefault();
			e.stopPropagation();
			requestHashtagIntent(slug);
		},
		true
	);
}

export function bindCreationDetailEmbedNavigation() {}
export function bindCreationDetailEmbedEscape() {}
