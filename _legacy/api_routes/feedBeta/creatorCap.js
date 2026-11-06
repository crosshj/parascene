import { feedRowCreationIdKey } from './rowMedia.js';

/**
 * @param {object|null|undefined} row
 * @returns {number}
 */
export function rowEngagementScore(row) {
	const dev = row?.feed_beta_why?.developer;
	if (dev && typeof dev.engagement === 'number' && Number.isFinite(dev.engagement)) {
		return dev.engagement;
	}
	const likes = Number(row?.like_count ?? 0);
	const comments = Number(row?.comment_count ?? 0);
	return Math.log1p(Math.max(0, likes) * 2 + Math.max(0, comments) * 3);
}

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
 * Before per-page cap: keep up to `maxPerCreator` rows per author with the highest engagement.
 * Original list order is preserved among survivors (e.g. chronological bands stay stable).
 *
 * @param {object[]} rows
 * @param {number} maxPerCreator
 * @returns {object[]}
 */
export function pickTopEngagedPerAuthor(rows, maxPerCreator) {
	const cap = Math.max(1, Number(maxPerCreator) || 2);
	const list = Array.isArray(rows) ? rows : [];
	const byAuthor = new Map();
	const keepIndices = new Set();

	for (let i = 0; i < list.length; i += 1) {
		const row = list[i];
		const uid = String(row.user_id ?? '');
		if (!uid) {
			keepIndices.add(i);
			continue;
		}
		if (!byAuthor.has(uid)) byAuthor.set(uid, []);
		byAuthor.get(uid).push({
			row,
			index: i,
			score: rowEngagementScore(row)
		});
	}

	for (const entries of byAuthor.values()) {
		entries.sort((a, b) => b.score - a.score || a.index - b.index);
		for (const entry of entries.slice(0, cap)) {
			keepIndices.add(entry.index);
		}
	}

	return list.filter((_, i) => keepIndices.has(i));
}

/**
 * Limit how many creations from the same author appear on one feed page.
 * Primary rows are pre-filtered to each author's top engaged picks; spare backfill prefers engagement too.
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

	const primary = pickTopEngagedPerAuthor(rows, cap);
	for (const row of primary) {
		if (out.length >= safeLimit) break;
		tryTake(row);
	}

	const spareSorted = (Array.isArray(spareRows) ? spareRows : [])
		.slice()
		.sort((a, b) => rowEngagementScore(b) - rowEngagementScore(a));

	for (const row of spareSorted) {
		if (out.length >= safeLimit) break;
		tryTake(row);
	}

	return out;
}
