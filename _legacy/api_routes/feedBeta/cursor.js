import { FEED_BETA_CURSOR_SENTINEL_AT } from '../../src/shared/feedBetaContinuation.js';

export { FEED_BETA_CURSOR_SENTINEL_AT };

/**
 * @param {string|undefined|null} afterAt
 * @param {number} afterIdNum
 * @returns {boolean}
 */
export function isFeedBetaPageCursor(afterAt, afterIdNum) {
	return (
		String(afterAt ?? '').trim() === FEED_BETA_CURSOR_SENTINEL_AT &&
		Number.isFinite(afterIdNum) &&
		afterIdNum > 0
	);
}

/**
 * Client echoes `after_image_id` = last completed page; serve the next page.
 * @param {number} completedPage — from `feed_after_image_id`
 * @returns {number}
 */
export function pageIndexAfterBetaCursor(completedPage) {
	const n = Number(completedPage);
	if (!Number.isFinite(n) || n < 1) return 1;
	return n + 1;
}

/**
 * @param {number} completedPage — pages delivered so far (1 = page 1 done)
 * @returns {{ created_at: string, created_image_id: number }}
 */
export function buildBetaPageFeedCursor(completedPage) {
	const page = Math.max(1, Math.floor(Number(completedPage) || 1));
	return {
		created_at: FEED_BETA_CURSOR_SENTINEL_AT,
		created_image_id: page
	};
}
