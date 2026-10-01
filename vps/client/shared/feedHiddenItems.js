/**
 * Client-only hidden feed IDs (localStorage). Kept separate from `feedCardBuild.js` so Node scripts
 * and tests can import feed helpers without pulling rollup `/icons/...` imports.
 */

export function getHiddenFeedItems() {
	try {
		if (typeof localStorage === 'undefined') return [];
		const stored = localStorage.getItem('hiddenFeedItems');
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

export function addHiddenFeedItem(itemId) {
	try {
		const hidden = getHiddenFeedItems();
		if (!hidden.includes(itemId)) {
			hidden.push(itemId);
			localStorage.setItem('hiddenFeedItems', JSON.stringify(hidden));
		}
	} catch {
		// Ignore localStorage errors
	}
}
