/**
 * Prompt library page runtime — standalone and embed (`?embed=1`).
 */

const _qs = (() => {
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

const { createEmbedPageRuntime, SPA_OVERLAY_ROUTE_MESSAGE } = await import(
	`/shared/embedPageRuntime.js${_qs}`
);

const runtime = createEmbedPageRuntime('__ps_prompt_library_embed');

export const isPromptLibraryEmbed = runtime.isEmbed;
export const isPromptLibraryEmbedFrame = runtime.isEmbedFrame;
export const navigate = runtime.navigate;
export const shellOut = runtime.shellOut;
export const requestCloseOverlay = runtime.requestCloseOverlay;
export const navigateFromModal = runtime.navigateFromModal;
export function bindPromptLibraryEmbedNavigation() {
	runtime.bindEmbedNavigation((link) => {
		const href = (link.getAttribute('href') || '').trim();
		if (!href) return false;
		try {
			const path = new URL(href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
			return path === '/prompt-library';
		} catch {
			return false;
		}
	});
}
export const bindPromptLibraryEmbedEscape = runtime.bindEmbedEscape;

/**
 * @param {string} hash
 */
export function notifyPromptLibraryEmbedHash(hash) {
	if (!isPromptLibraryEmbedFrame()) return;
	try {
		window.parent.postMessage(
			{ type: 'prsn-prompt-library-overlay-hash', hash: String(hash || '').trim() },
			window.location.origin
		);
	} catch {
		// ignore
	}
}

export { SPA_OVERLAY_ROUTE_MESSAGE };
