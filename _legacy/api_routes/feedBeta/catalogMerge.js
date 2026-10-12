import { feedRowCreationIdKey } from './rowMedia.js';

/**
 * Dedupe catalog rows by creation id (newest row wins).
 * @param {object[][]} groups
 * @returns {object[]}
 */
export function mergeCatalogRowsById(...groups) {
	const byId = new Map();
	for (const group of groups) {
		for (const row of Array.isArray(group) ? group : []) {
			if (!row || typeof row !== 'object') continue;
			const key = feedRowCreationIdKey(row);
			if (!key) continue;
			if (!byId.has(key)) byId.set(key, row);
		}
	}
	return [...byId.values()];
}
