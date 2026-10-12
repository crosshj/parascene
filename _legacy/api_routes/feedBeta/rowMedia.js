/**
 * @param {object|null|undefined} row
 * @returns {object|null}
 */
function parseRowMeta(row) {
	if (!row || typeof row !== 'object') return null;
	let meta = row.meta;
	if (typeof meta === 'string' && meta) {
		try {
			meta = JSON.parse(meta);
		} catch {
			return null;
		}
	}
	return meta && typeof meta === 'object' ? meta : null;
}

/**
 * Ensure `media_type` / `video_url` are set for {@link transformFeedCreationRow} and client spotlight checks.
 * @param {object|null|undefined} row
 * @returns {object|null|undefined}
 */
export function normalizeFeedBetaMediaFields(row) {
	if (!row || typeof row !== 'object') return row;
	const meta = parseRowMeta(row);
	const mediaType =
		typeof row.media_type === 'string'
			? row.media_type.trim().toLowerCase()
			: meta && typeof meta.media_type === 'string'
				? meta.media_type.trim().toLowerCase()
				: 'image';
	const videoMeta = meta && typeof meta === 'object' ? meta.video : null;
	const videoUrl =
		typeof row.video_url === 'string' && row.video_url.trim()
			? row.video_url.trim()
			: videoMeta && typeof videoMeta.file_path === 'string' && videoMeta.file_path.trim()
				? videoMeta.file_path.trim()
				: null;
	return {
		...row,
		meta: meta ?? row.meta,
		media_type: mediaType,
		video_url: videoUrl
	};
}

/**
 * @param {object|null|undefined} row — raw DB / hydrated row before transform
 * @returns {boolean}
 */
export function feedRowIsVideoThread(row) {
	const norm = normalizeFeedBetaMediaFields(row);
	if (!norm) return false;
	return norm.media_type === 'video' && Boolean(norm.video_url);
}

/**
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function feedRowIsOtherThread(row) {
	if (!row || typeof row !== 'object') return false;
	const cid = Number(row.created_image_id ?? row.id);
	if (!Number.isFinite(cid) || cid <= 0) return false;
	return !feedRowIsVideoThread(row);
}

/**
 * @param {object|null|undefined} row
 * @returns {string|null}
 */
export function feedRowCreationIdKey(row) {
	const cid = Number(row?.created_image_id ?? row?.id);
	if (!Number.isFinite(cid) || cid <= 0) return null;
	return String(cid);
}
