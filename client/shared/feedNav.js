/** Feed navigation helpers retained for shared callers; the ranked feed is now the default. */
export function feedNavLabel(base) {
	return String(base ?? '').trim();
}

/** @returns {boolean} */
export function readFeedEnabledSync() {
	if (typeof window === 'undefined') return false;
	if (window.__PRSN_FEED_ENABLED__ === true) return true;
	if (window.__PRSN_FEED_ENABLED__ === false) return false;
	return true;
}

/** @param {boolean} enabled */
export function setFeedEnabledClient(enabled) {
	if (typeof window === 'undefined') return;
	const on = enabled !== false;
	window.__PRSN_FEED_ENABLED__ = on;
	applyFeedDocumentClass(on);
	applyFeedNavLabelsToDom(on);
	try { document.dispatchEvent(new CustomEvent('feed-changed', { detail: { enabled: on } })); } catch { /* ignore */ }
}

/** @param {boolean} [enabled] */
export function applyFeedDocumentClass(enabled = readFeedEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.documentElement?.classList.toggle('feed-enabled', enabled === true);
}

/** @param {boolean} [enabled] */
export function applyFeedNavLabelsToDom(enabled = readFeedEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.querySelectorAll('[data-feed-nav="feed"]').forEach((el) => { el.textContent = 'Feed'; });
	document.querySelectorAll('[data-feed-nav="home"]').forEach((el) => { el.textContent = 'Home'; });
	applyFeedDocumentClass(enabled);
}

if (typeof window !== 'undefined') {
	applyFeedDocumentClass();
}
