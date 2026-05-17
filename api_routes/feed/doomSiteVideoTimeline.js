/**
 * Shared ordering helpers for site-wide doom video timeline queries.
 */

export function feedRowIsStrictlyOlderThan(row, cursorAt, cursorId) {
	const ra = String(row?.created_at ?? "");
	const ca = String(cursorAt ?? "");
	if (ra < ca) return true;
	if (ra > ca) return false;
	const rid = Number(row?.created_image_id ?? row?.id);
	const cid = Number(cursorId);
	if (!Number.isFinite(rid) || !Number.isFinite(cid)) {
		return ra === ca && String(row?.created_image_id ?? row?.id) < String(cursorId);
	}
	return rid < cid;
}

/**
 * Anchor row plus videos strictly older on the global (created_at DESC, created_image_id DESC) timeline.
 * @param {object[]} rows — newest first
 * @param {number} anchorId — created_image_id
 */
export function doomSiteVideosFromAnchor(rows, anchorId) {
	const aid = Number(anchorId);
	if (!Number.isFinite(aid) || aid <= 0) return [];
	const list = Array.isArray(rows) ? rows : [];
	const anchor = list.find((row) => Number(row?.created_image_id ?? row?.id) === aid);
	if (!anchor) return [];
	const anchorAt = anchor.created_at;
	return list.filter((row) => {
		const rid = Number(row?.created_image_id ?? row?.id);
		if (rid === aid) return true;
		return feedRowIsStrictlyOlderThan(row, anchorAt, aid);
	});
}

/**
 * Mount page: anchor must be slide 0; drop anything newer than anchor if present.
 * @param {object[]} rows
 * @param {number} startCreationId
 */
export function putAnchorCreationFirst(rows, startCreationId) {
	const anchorId = Number(startCreationId);
	const list = Array.isArray(rows) ? rows.slice() : [];
	const idx = list.findIndex((row) => Number(row?.created_image_id ?? row?.id) === anchorId);
	if (idx < 0) return list;
	if (idx === 0) return list;
	return [list[idx], ...list.slice(idx + 1)];
}
