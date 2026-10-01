import { invalidateAppCaches } from './api.js';

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

export function requestHashtagIntent(slug) {
	const safe = String(slug || '').trim().toLowerCase();
	if (safe) navigate(`/t/${encodeURIComponent(safe)}`);
}

export function bindCreationDetailHashtagClicks() {}
export function bindCreationDetailEmbedNavigation() {}
export function bindCreationDetailEmbedEscape() {}
