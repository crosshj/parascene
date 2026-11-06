/**
 * Shared “who liked / commented / reacted” label lists for API responses.
 * Shape: ["@alice", "@bob", 3] — up to MAX names, optional trailing others count.
 */

export const MAX_WHO_IN_RESPONSE = 5;

/** Cap rows fetched per batch so viral posts don’t blow up feed payloads. */
const MAX_LIKER_ROWS_FETCH = 400;
const MAX_COMMENTER_ROWS_FETCH = 800;

export function formatWhoLabel(userName, displayName) {
	const un = (userName || displayName || "").trim();
	return un ? `@${un}` : "";
}

/**
 * @param {{ user_name?: string|null, display_name?: string|null }[]} rows
 * @param {number} [total] - if omitted, uses rows.length
 * @returns {(string|number)[]}
 */
export function buildWhoListFromProfileRows(rows, total) {
	const list = Array.isArray(rows) ? rows : [];
	const strings = list
		.slice(0, MAX_WHO_IN_RESPONSE)
		.map((r) => formatWhoLabel(r?.user_name, r?.display_name))
		.filter(Boolean);
	const tot = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : list.length;
	const others = Math.max(0, tot - strings.length);
	return others > 0 ? [...strings, others] : strings;
}

/**
 * Batch liker profile rows for creations. Map: creationId -> row[]
 * @param {object} queries
 * @param {number[]} creationIds
 */
export async function getLikerRowsForCreationIds(queries, creationIds) {
	const out = new Map();
	const ids = (Array.isArray(creationIds) ? creationIds : [])
		.map((id) => Number(id))
		.filter((n) => Number.isFinite(n) && n > 0);
	for (const id of ids) out.set(id, []);
	if (ids.length === 0 || typeof queries?.selectCreatedImageLikersByImageIds?.all !== "function") {
		return out;
	}
	const rows = await queries.selectCreatedImageLikersByImageIds.all(ids, {
		limit: Math.min(MAX_LIKER_ROWS_FETCH, Math.max(ids.length * (MAX_WHO_IN_RESPONSE + 2), 40))
	});
	for (const row of rows ?? []) {
		const cid = Number(row?.created_image_id);
		if (!Number.isFinite(cid) || !out.has(cid)) continue;
		const list = out.get(cid);
		if (list.length >= MAX_WHO_IN_RESPONSE + 5) continue;
		list.push(row);
	}
	return out;
}

/**
 * Batch unique commenter rows for creations. Map: creationId -> row[]
 * @param {object} queries
 * @param {number[]} creationIds
 */
export async function getCommenterRowsForCreationIds(queries, creationIds) {
	const out = new Map();
	const ids = (Array.isArray(creationIds) ? creationIds : [])
		.map((id) => Number(id))
		.filter((n) => Number.isFinite(n) && n > 0);
	for (const id of ids) out.set(id, []);
	if (ids.length === 0 || typeof queries?.selectCreatedImageCommentersByImageIds?.all !== "function") {
		return out;
	}
	const rows = await queries.selectCreatedImageCommentersByImageIds.all(ids, {
		limit: Math.min(MAX_COMMENTER_ROWS_FETCH, Math.max(ids.length * 40, 80))
	});
	for (const row of rows ?? []) {
		const cid = Number(row?.created_image_id);
		if (!Number.isFinite(cid) || !out.has(cid)) continue;
		out.get(cid).push(row);
	}
	return out;
}

/**
 * @param {object} queries
 * @param {number[]} creationIds
 * @returns {Promise<Map<number, (string|number)[]>>}
 */
export async function getLikedByForCreationIds(queries, creationIds) {
	const rowsMap = await getLikerRowsForCreationIds(queries, creationIds);
	const out = new Map();
	for (const [cid, list] of rowsMap) {
		out.set(cid, buildWhoListFromProfileRows(list, list.length));
	}
	return out;
}

/**
 * @param {object} queries
 * @param {number[]} creationIds
 * @returns {Promise<Map<number, (string|number)[]>>}
 */
export async function getCommentedByForCreationIds(queries, creationIds) {
	const rowsMap = await getCommenterRowsForCreationIds(queries, creationIds);
	const out = new Map();
	for (const [cid, list] of rowsMap) {
		out.set(cid, buildWhoListFromProfileRows(list, list.length));
	}
	return out;
}

/**
 * Stamp liked_by + commented_by on rows that have created_image_id (or id).
 * Uses like_count for liked_by overflow when available.
 * @param {object} queries
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
export async function stampWhoMetaOnCreationRows(queries, rows) {
	if (!Array.isArray(rows) || rows.length === 0) return rows;
	const ids = [
		...new Set(
			rows
				.map((row) => Number(row?.created_image_id ?? row?.id))
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	];
	if (ids.length === 0) {
		return rows.map((row) => ({
			...row,
			liked_by: Array.isArray(row?.liked_by) ? row.liked_by : [],
			commented_by: Array.isArray(row?.commented_by) ? row.commented_by : []
		}));
	}
	const [likedRowsMap, commenterRowsMap] = await Promise.all([
		getLikerRowsForCreationIds(queries, ids),
		getCommenterRowsForCreationIds(queries, ids)
	]);
	return rows.map((row) => {
		const cid = Number(row?.created_image_id ?? row?.id);
		if (!Number.isFinite(cid) || cid <= 0) {
			return {
				...row,
				liked_by: Array.isArray(row?.liked_by) ? row.liked_by : [],
				commented_by: Array.isArray(row?.commented_by) ? row.commented_by : []
			};
		}
		const likers = likedRowsMap.get(cid) ?? [];
		const commenters = commenterRowsMap.get(cid) ?? [];
		const likeTotal = Math.max(Number(row?.like_count) || 0, likers.length);
		// Unique commenters: use fetched unique count (may undercount if truncated).
		const commenterTotal = commenters.length;
		return {
			...row,
			liked_by: buildWhoListFromProfileRows(likers, likeTotal),
			commented_by: buildWhoListFromProfileRows(commenters, commenterTotal)
		};
	});
}

/**
 * Single-creation who meta for like endpoints / detail.
 * @param {object} queries
 * @param {number} creationId
 * @param {{ like_count?: number }} [opts]
 */
export async function getWhoMetaForCreation(queries, creationId, opts = {}) {
	const cid = Number(creationId);
	if (!Number.isFinite(cid) || cid <= 0) {
		return { liked_by: [], commented_by: [] };
	}
	const [likedRowsMap, commenterRowsMap] = await Promise.all([
		getLikerRowsForCreationIds(queries, [cid]),
		getCommenterRowsForCreationIds(queries, [cid])
	]);
	const likers = likedRowsMap.get(cid) ?? [];
	const commenters = commenterRowsMap.get(cid) ?? [];
	const likeTotal = Math.max(Number(opts?.like_count) || 0, likers.length);
	return {
		liked_by: buildWhoListFromProfileRows(likers, likeTotal),
		commented_by: buildWhoListFromProfileRows(commenters, commenters.length)
	};
}
