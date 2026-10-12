/** Feed navigation helpers retained for shared callers; the ranked feed is now the default. */
export function feedNavLabel(base) {
	return String(base ?? '').trim();
}

/** @returns {boolean} */
export function readFeedBetaEnabledSync() {
	if (typeof window === 'undefined') return false;
	if (window.__PRSN_FEED_BETA_ENABLED__ === true) return true;
	if (window.__PRSN_FEED_BETA_ENABLED__ === false) return false;
	return true;
}

export function feedBetaActiveFromProfile(user) {
	if (!user || typeof user !== 'object') return true;
	return user.forceLegacyFeed !== true && user.meta?.forceLegacyFeed !== true;
}

/** @param {boolean} enabled */
export function setFeedBetaEnabledClient(enabled) {
	if (typeof window === 'undefined') return;
	const on = enabled !== false;
	window.__PRSN_FEED_BETA_ENABLED__ = on;
	applyFeedBetaDocumentClass(on);
	applyFeedBetaNavLabelsToDom(on);
	try { document.dispatchEvent(new CustomEvent('feed-beta-changed', { detail: { enabled: on } })); } catch { /* ignore */ }
}

/** @param {boolean} [enabled] */
export function applyFeedBetaDocumentClass(enabled = readFeedBetaEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.documentElement?.classList.toggle('feed-beta-enabled', enabled === true);
}

/** @param {boolean} [enabled] */
export function applyFeedBetaNavLabelsToDom(enabled = readFeedBetaEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.querySelectorAll('[data-feed-nav="feed"]').forEach((el) => { el.textContent = 'Feed'; });
	document.querySelectorAll('[data-feed-nav="home"]').forEach((el) => { el.textContent = 'Home'; });
	applyFeedBetaDocumentClass(enabled);
}

if (typeof window !== 'undefined') {
	applyFeedBetaDocumentClass();
}
