/**
 * Shared embed iframe runtime helpers for SPA page overlay targets.
 */

export const SPA_OVERLAY_ROUTE_MESSAGE = 'prsn-spa-page-overlay-route';
export const SPA_OVERLAY_CLOSE_MESSAGE = 'prsn-spa-page-overlay-close';
export const SPA_OVERLAY_SHELL_OUT_MESSAGE = 'prsn-spa-page-overlay-shell-out';
export const SPA_OVERLAY_EMBED_READY_MESSAGE = 'prsn-spa-page-overlay-embed-ready';
export const CHAT_SHELL_NAVIGATE_FROM_EMBED_MESSAGE = 'prsn-chat-shell-navigate-from-embed';

function isChatPathHref(href) {
	const raw = String(href || '').trim();
	if (!raw) return false;
	try {
		const path = new URL(raw, window.location.origin).pathname.replace(/\/+$/, '') || '/';
		return path === '/chat' || path.startsWith('/chat/');
	} catch {
		return false;
	}
}

function isParentChatShell() {
	try {
		if (window.parent === window) return false;
		const parentDoc = window.parent.document;
		const body = parentDoc?.body;
		if (!(body instanceof HTMLElement)) return false;
		const onChatPage =
			body.classList.contains('chat-page') ||
			parentDoc.documentElement?.classList?.contains('chat-page') ||
			body.dataset?.entry === 'chat';
		return onChatPage && Boolean(parentDoc.querySelector('[data-chat-page]'));
	} catch {
		return false;
	}
}

export function isSpaPageEmbedFrame() {
	if (typeof window === 'undefined' || window.parent === window) return false;
	return (
		window.__ps_profile_embed === true ||
		window.__ps_style_embed === true ||
		window.__ps_audio_clip_embed === true ||
		window.__ps_prompt_library_embed === true ||
		window.__ps_create_embed === true ||
		window.__ps_creation_edit_embed === true ||
		window.__ps_creation_detail_embed === true ||
		window.__ps_integrations_embed === true
	);
}

/** Tell the overlay shell the embed page has themed content ready to reveal. */
export function notifySpaPageOverlayEmbedReady() {
	if (!isSpaPageEmbedFrame()) return false;
	try {
		window.parent.postMessage(
			{
				type: SPA_OVERLAY_EMBED_READY_MESSAGE,
				href: window.location.pathname + window.location.search,
			},
			window.location.origin
		);
		return true;
	} catch {
		return false;
	}
}

function isExternalNavigationHref(href) {
	const raw = String(href || '').trim();
	if (!raw || raw.startsWith('#')) return false;
	if (raw.startsWith('mailto:') || raw.startsWith('tel:')) return true;
	try {
		const url = new URL(raw, window.location.origin);
		return url.origin !== window.location.origin;
	} catch {
		return false;
	}
}

/**
 * @param {string} embedFlag — e.g. `__ps_profile_embed`
 */
export function createEmbedPageRuntime(embedFlag) {
	function isEmbed() {
		return window[embedFlag] === true;
	}

	function isEmbedFrame() {
		return isEmbed() && window.parent !== window;
	}

	function postToParent(payload) {
		if (!isEmbedFrame()) return false;
		try {
			window.parent.postMessage(payload, window.location.origin);
			return true;
		} catch {
			return false;
		}
	}

	function navigate(href) {
		const raw = String(href || '').trim();
		if (!raw || raw.startsWith('#')) return;
		if (isExternalNavigationHref(raw)) {
			window.location.assign(raw);
			return;
		}
		if (isEmbedFrame()) {
			postToParent({ type: SPA_OVERLAY_ROUTE_MESSAGE, href: raw });
			return;
		}
		window.location.assign(raw);
	}

	function shellOut(href) {
		const raw = String(href || '').trim();
		if (!raw || raw.startsWith('#')) return;
		if (isExternalNavigationHref(raw)) {
			window.location.assign(raw);
			return;
		}
		if (isEmbedFrame()) {
			if (isParentChatShell() && isChatPathHref(raw)) {
				postToParent({ type: CHAT_SHELL_NAVIGATE_FROM_EMBED_MESSAGE, href: raw });
				return;
			}
			postToParent({ type: SPA_OVERLAY_SHELL_OUT_MESSAGE, href: raw });
			return;
		}
		window.location.assign(raw);
	}

	function requestCloseOverlay() {
		return postToParent({ type: SPA_OVERLAY_CLOSE_MESSAGE });
	}

	function navigateFromModal(href) {
		const raw = String(href || '').trim();
		if (!raw || raw === '#') return;
		document.dispatchEvent(new CustomEvent('close-all-modals'));
		navigate(raw);
	}

	function shouldInterceptEmbedLink(link, e, extraSkip) {
		if (!(link instanceof HTMLAnchorElement)) return false;
		if (e.defaultPrevented) return false;
		if (typeof e.button === 'number' && e.button !== 0) return false;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
		if (typeof extraSkip === 'function' && extraSkip(link)) return false;
		const href = (link.getAttribute('href') || '').trim();
		if (!href || href.startsWith('#')) return false;
		if (link.hasAttribute('download')) return false;
		if (link.target === '_blank') return false;
		if (isExternalNavigationHref(href)) return false;
		return true;
	}

	function bindEmbedNavigation(extraSkip) {
		if (!isEmbed()) return;
		const key = `embedNavBound_${embedFlag}`;
		if (document.documentElement.dataset[key] === '1') return;
		document.documentElement.dataset[key] = '1';
		document.addEventListener(
			'click',
			(e) => {
				const link = e.target?.closest?.('a[href]');
				if (!shouldInterceptEmbedLink(link, e, extraSkip)) return;
				e.preventDefault();
				e.stopPropagation();
				const href = link.getAttribute('href') || '';
				let path = '';
				try {
					path = new URL(href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
				} catch {
					path = '';
				}
				if (path.startsWith('/chat')) {
					shellOut(href);
					return;
				}
				navigate(href);
			},
			true
		);
	}

	function bindEmbedEscape(hasOpenEscapeTarget) {
		if (!isEmbed()) return;
		const key = `embedEscBound_${embedFlag}`;
		if (document.documentElement.dataset[key] === '1') return;
		document.documentElement.dataset[key] = '1';
		document.addEventListener(
			'keydown',
			(e) => {
				if (e.key !== 'Escape' || e.defaultPrevented) return;
				if (typeof hasOpenEscapeTarget === 'function' && hasOpenEscapeTarget()) return;
				if (!requestCloseOverlay()) return;
				e.preventDefault();
				e.stopPropagation();
			},
			true
		);
	}

	return {
		isEmbed,
		isEmbedFrame,
		navigate,
		shellOut,
		requestCloseOverlay,
		navigateFromModal,
		bindEmbedNavigation,
		bindEmbedEscape,
	};
}
