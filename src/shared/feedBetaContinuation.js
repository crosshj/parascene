/** Matches api `feed_cursor.after_image_created_at` for beta page tokens (not chronological). */
export const FEED_BETA_CURSOR_SENTINEL_AT = '1970-01-01T00:00:00.000Z';

/**
 * @param {object|null|undefined} apiCursor
 * @returns {boolean}
 */
export function isFeedBetaPageTokenCursor(apiCursor) {
	if (!apiCursor || typeof apiCursor !== 'object') return false;
	const at =
		apiCursor.after_image_created_at != null
			? String(apiCursor.after_image_created_at).trim()
			: '';
	const id = Number.parseInt(String(apiCursor.after_image_id ?? ''), 10);
	return at === FEED_BETA_CURSOR_SENTINEL_AT && Number.isFinite(id) && id > 0;
}

/**
 * Build `feed_beta_ack` query value from the last `feed_beta` response (opaque to UI).
 * @param {object|null|undefined} feedBeta
 * @returns {string|null}
 */
export function encodeFeedBetaAck(feedBeta) {
	if (!feedBeta || typeof feedBeta !== 'object') return null;
	const completed = Number(feedBeta.completed_page);
	if (!Number.isFinite(completed) || completed < 1) return null;
	const payload = {
		v: 1,
		completed_page: completed,
		page_filled: feedBeta.page_filled === true,
		served_count: Number(feedBeta.served_count) || 0
	};
	try {
		const json = JSON.stringify(payload);
		if (typeof btoa === 'function') {
			return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
export function decodeFeedBetaAck(raw) {
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
			served_count: Math.max(0, Number(data?.served_count) || 0)
		};
	} catch {
		return null;
	}
}
