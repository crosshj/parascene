/**
 * Shared “#2” layer for pseudo-channels: paged API → ordered column items + merge/dedupe + busy flags.
 * Callers own fetch shape (cursor vs offset); each page must arrive in API order (newest first).
 *
 * `columnOrder`:
 * - `chat` (default): stored `items` are oldest → newest (newest at bottom). `loadOlder` prepends older pages.
 * - `feed`: stored `items` match the API (newest first). `loadOlder` appends the next page (older items), same idea as `app-route-feed`.
 *
 * @template T
 * @param {{
 *   getItemKey: (item: T) => string,
 *   fetchPage: (ctx: { initial: boolean, items: T[] }) => Promise<{ pageItems: T[]; hasMore: boolean }>,
 *   columnOrder?: 'chat' | 'feed',
 * }} opts
 */
export function createPseudoColumnPager(opts) {
	const getItemKey = opts.getItemKey;
	const fetchPage = opts.fetchPage;
	const columnOrder = opts.columnOrder === 'feed' ? 'feed' : 'chat';

	/** @type {T[]} */
	let items = [];
	let hasMore = false;
	let initialBusy = false;
	let olderBusy = false;

	function reset() {
		items = [];
		hasMore = false;
	}

	/**
	 * @param {T[]} pageItems — API order (newest first within this page)
	 * @param {boolean} prepend — true when loading older history (prepend to column)
	 * @returns {T[]} the slice actually merged (oldest → newest within the new batch)
	 */
	function applyApiPage(pageItems, prepend) {
		const slice = [...(Array.isArray(pageItems) ? pageItems : [])].reverse();
		const keySet = new Set();
		for (const x of items) {
			const k = getItemKey(x);
			if (k) keySet.add(k);
		}
		const filtered = [];
		for (const it of slice) {
			const k = getItemKey(it);
			if (k) {
				if (keySet.has(k)) continue;
				keySet.add(k);
			}
			filtered.push(it);
		}
		if (prepend) {
			items = [...filtered, ...items];
		} else {
			items = filtered;
		}
		return filtered;
	}

	function applyFeedInitialPage(pageItems) {
		const raw = Array.isArray(pageItems) ? pageItems : [];
		const keySet = new Set();
		const filtered = [];
		for (const it of raw) {
			const k = getItemKey(it);
			if (k) {
				if (keySet.has(k)) continue;
				keySet.add(k);
			}
			filtered.push(it);
		}
		items = filtered;
		return filtered;
	}

	function applyFeedAppendPage(pageItems) {
		const raw = Array.isArray(pageItems) ? pageItems : [];
		const keySet = new Set();
		for (const x of items) {
			const k = getItemKey(x);
			if (k) keySet.add(k);
		}
		const filtered = [];
		for (const it of raw) {
			const k = getItemKey(it);
			if (k) {
				if (keySet.has(k)) continue;
				keySet.add(k);
			}
			filtered.push(it);
		}
		items = [...items, ...filtered];
		return filtered;
	}

	async function loadInitial() {
		if (initialBusy) {
			return { ok: false, reason: 'busy' };
		}
		initialBusy = true;
		try {
			items = [];
			const { pageItems, hasMore: hm } = await fetchPage({ initial: true, items: [] });
			hasMore = Boolean(hm);
			if (columnOrder === 'feed') {
				const prepended = applyFeedInitialPage(pageItems);
				return { ok: true, items: [...items], hasMore, prepended };
			}
			const prepended = applyApiPage(pageItems, false);
			return { ok: true, items: [...items], hasMore, prepended };
		} catch (error) {
			return { ok: false, error };
		} finally {
			initialBusy = false;
		}
	}

	async function loadOlder() {
		if (olderBusy || !hasMore || items.length === 0) {
			return { ok: false, reason: 'skip' };
		}
		olderBusy = true;
		try {
			const { pageItems, hasMore: hm } = await fetchPage({ initial: false, items: [...items] });
			hasMore = Boolean(hm);
			if (columnOrder === 'feed') {
				const appended = applyFeedAppendPage(pageItems);
				return { ok: true, prepended: [], appended, items: [...items], hasMore };
			}
			const prepended = applyApiPage(pageItems, true);
			return { ok: true, prepended, appended: [], items: [...items], hasMore };
		} catch (error) {
			return { ok: false, error };
		} finally {
			olderBusy = false;
		}
	}

	return {
		reset,
		loadInitial,
		loadOlder,
		getItems: () => [...items],
		getHasMore: () => hasMore,
		isInitialBusy: () => initialBusy,
		isOlderBusy: () => olderBusy,
	};
}
