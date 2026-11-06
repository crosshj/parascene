/**
 * Pure helpers for batched feed impression queue (storage layer uses sessionStorage in beacon).
 */

export const QUEUE_STORAGE_KEY = 'prsn-feed-impression-queue-v1';
export const SENT_STORAGE_KEY = 'prsn-feed-impression-sent-v1';
export const SENT_STORAGE_CAP = 500;
export const FLUSH_INTERVAL_MS = 8000;
export const FLUSH_MAX_ITEMS = 20;

/**
 * @param {unknown} raw
 * @returns {object[]}
 */
export function parseStoredImpressionQueue(raw) {
	if (!raw || typeof raw !== 'string') return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * @param {unknown} raw
 * @returns {Set<string>}
 */
export function parseStoredSentCreationIds(raw) {
	if (!raw || typeof raw !== 'string') return new Set();
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.map((id) => String(id)).filter(Boolean));
	} catch {
		return new Set();
	}
}

/**
 * @param {Set<string>} sentIds
 * @returns {string[]}
 */
export function serializeSentCreationIds(sentIds) {
	return [...sentIds].slice(-SENT_STORAGE_CAP);
}

/**
 * @param {object[]} queue
 * @param {object} entry
 * @returns {object[]}
 */
export function mergeImpressionIntoQueue(queue, entry) {
	const id = String(entry?.creation_id ?? '').trim();
	if (!id) return queue;
	const next = Array.isArray(queue) ? queue.slice() : [];
	const idx = next.findIndex((row) => String(row?.creation_id) === id);
	if (idx === -1) {
		next.push(entry);
		return next;
	}
	const existing = next[idx];
	const trigger =
		entry.trigger === 'click' || existing.trigger === 'click' ? 'click' : 'dwell';
	next[idx] = {
		...existing,
		...entry,
		creation_id: Number(existing.creation_id) || Number(entry.creation_id),
		trigger
	};
	return next;
}

/**
 * @param {Set<string>} sentIds
 * @param {object[]} queue
 * @param {number|string} creationId
 * @param {'dwell'|'click'} trigger
 */
export function shouldSkipImpressionEnqueue(sentIds, queue, creationId, trigger) {
	const id = String(creationId);
	if (trigger === 'click') return false;
	if (sentIds.has(id)) return true;
	return queue.some((row) => String(row?.creation_id) === id);
}

/**
 * Coalesce queue to at most one row per creation_id (click wins).
 * @param {object[]} queue
 * @returns {object[]}
 */
export function coalesceImpressionQueue(queue) {
	const byId = new Map();
	for (const row of Array.isArray(queue) ? queue : []) {
		const id = String(row?.creation_id ?? '').trim();
		if (!id) continue;
		const prev = byId.get(id);
		if (!prev) {
			byId.set(id, row);
			continue;
		}
		byId.set(
			id,
			mergeImpressionIntoQueue([prev], row).find((r) => String(r.creation_id) === id) ?? row
		);
	}
	return [...byId.values()];
}
