/** Matches api `feed_cursor.after_image_created_at` for page tokens (not chronological). */
export const FEED_CURSOR_SENTINEL_AT = '1970-01-01T00:00:00.000Z';

/**
 * @param {object|null|undefined} apiCursor
 * @returns {boolean}
 */
export function isFeedPageTokenCursor(apiCursor) {
	if (!apiCursor || typeof apiCursor !== 'object') return false;
	const at =
		apiCursor.after_image_created_at != null
			? String(apiCursor.after_image_created_at).trim()
			: '';
	const id = Number.parseInt(String(apiCursor.after_image_id ?? ''), 10);
	return at === FEED_CURSOR_SENTINEL_AT && Number.isFinite(id) && id > 0;
}

/**
 * Build `feed_ack` query value from the last `feed_continuation` response (opaque to UI).
 * @param {object|null|undefined} feed
 * @returns {string|null}
 */
export function encodeFeedAck(feed) {
	if (!feed || typeof feed !== 'object') return null;
	const completed = Number(feed.completed_page);
	if (!Number.isFinite(completed) || completed < 1) return null;
	const payload = {
		v: 1,
		completed_page: completed,
		page_filled: feed.page_filled === true,
		served_count: Number(feed.served_count) || 0,
		...(typeof feed.session_id === 'string' && feed.session_id
			? { session_id: feed.session_id }
			: {}),
	};
	try {
		const json = JSON.stringify(payload);
		if (typeof btoa === 'function') {
			return btoa(json)
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
		}
		return Buffer.from(json, 'utf8').toString('base64url');
	} catch {
		return null;
	}
}

/**
 * @param {string|null|undefined} raw
 * @returns {{ v: number, completed_page: number, page_filled: boolean, served_count: number } | null}
 */
export function decodeFeedAck(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	try {
		let json;
		if (typeof atob === 'function') {
			const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
			const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
			json = atob(b64);
		} else {
			json = Buffer.from(s, 'base64url').toString('utf8');
		}
		const data = JSON.parse(json);
		const completed = Number(data?.completed_page);
		if (!Number.isFinite(completed) || completed < 1) return null;
		return {
			v: Number(data?.v) || 1,
			completed_page: completed,
			page_filled: data?.page_filled === true,
			served_count: Math.max(0, Number(data?.served_count) || 0),
			...(typeof data?.session_id === 'string' && data.session_id
				? { session_id: data.session_id }
				: {}),
		};
	} catch {
		return null;
	}
}
