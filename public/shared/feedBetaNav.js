/**
 * Feed [beta] nav chrome — sync read from head boot / localStorage; DOM label helpers.
 */

const STORAGE_KEY = 'prsn-feed-beta-enabled';

/** @param {string} base @param {boolean} [enabled] */
export function feedNavLabel(base, enabled = readFeedBetaEnabledSync()) {
	const text = String(base ?? '').trim();
	if (!enabled) return text;
	if (!text || /\[beta\]/i.test(text)) return text;
	return `${text} [beta]`;
}

/** @returns {boolean} */
export function readFeedBetaEnabledSync() {
	if (typeof window === 'undefined') return false;
	if (window.__PRSN_FEED_BETA_ENABLED__ === true) return true;
	if (window.__PRSN_FEED_BETA_ENABLED__ === false) return false;
	try {
		const stored = window.localStorage?.getItem(STORAGE_KEY);
		if (stored === '1') return true;
		if (stored === '0') return false;
	} catch {
		// ignore
	}
	return false;
}

/** @param {boolean} enabled */
export function setFeedBetaEnabledClient(enabled) {
	if (typeof window === 'undefined') return;
	const on = enabled === true;
	window.__PRSN_FEED_BETA_ENABLED__ = on;
	try {
		window.localStorage?.setItem(STORAGE_KEY, on ? '1' : '0');
	} catch {
		// ignore
	}
	applyFeedBetaDocumentClass(on);
	applyFeedBetaNavLabelsToDom(on);
	try {
		document.dispatchEvent(new CustomEvent('feed-beta-changed', { detail: { enabled: on } }));
	} catch {
		// ignore
	}
}

/** @param {boolean} [enabled] */
export function applyFeedBetaDocumentClass(enabled = readFeedBetaEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.documentElement?.classList.toggle('feed-beta-enabled', enabled === true);
}

/** @param {boolean} [enabled] */
export function applyFeedBetaNavLabelsToDom(enabled = readFeedBetaEnabledSync()) {
	if (typeof document === 'undefined') return;
	document.querySelectorAll('[data-feed-nav="feed"]').forEach((el) => {
		el.textContent = feedNavLabel('Feed', enabled);
	});
	document.querySelectorAll('[data-feed-nav="home"]').forEach((el) => {
		el.textContent = feedNavLabel('Home', enabled);
	});
	applyFeedBetaDocumentClass(enabled);
}

if (typeof window !== 'undefined') {
	applyFeedBetaDocumentClass();
}
