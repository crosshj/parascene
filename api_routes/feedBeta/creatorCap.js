import { feedRowCreationIdKey } from './rowMedia.js';

/**
 * @param {object[]} rows
 * @returns {Map<string, number>}
 */
export function authorCountsFromRows(rows) {
	const counts = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const uid = String(row.user_id ?? '');
		if (!uid) continue;
		counts.set(uid, (counts.get(uid) || 0) + 1);
	}
	return counts;
}

/**
 * Limit how many creations from the same author appear on one feed page.
 * Skipped primary rows are replaced from `spareRows` (newest-first pool leftovers).
 *
 * @param {object[]} rows — page order
 * @param {object} opts
 * @param {number} opts.limit
 * @param {object[]} [opts.spareRows]
 * @param {number} [opts.maxPerCreator]
 * @param {Map<string, number>} [opts.seedAuthorCounts] — authors already on page (slot-pack head)
 * @returns {object[]}
 */
export function enforceCreatorCapOnPage(rows, {
	limit,
	spareRows = [],
	maxPerCreator = 2,
	seedAuthorCounts = null
}) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const cap = Math.max(1, Number(maxPerCreator) || 2);
	const counts =
		seedAuthorCounts instanceof Map ? new Map(seedAuthorCounts) : new Map();
	const used = new Set();
	const out = [];

	function tryTake(row) {
		const key = feedRowCreationIdKey(row);
		if (!key || used.has(key)) return false;
		const uid = String(row.user_id ?? '');
		if (uid) {
			const n = counts.get(uid) || 0;
			if (n >= cap) return false;
			counts.set(uid, n + 1);
		}
		used.add(key);
		out.push(row);
		return true;
	}

	for (const row of Array.isArray(rows) ? rows : []) {
		if (out.length >= safeLimit) break;
		tryTake(row);
	}

	for (const row of Array.isArray(spareRows) ? spareRows : []) {
		if (out.length >= safeLimit) break;
		tryTake(row);
	}

	return out;
}
