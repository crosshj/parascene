/**
 * First 10 keys from api_routes/comments.js REACTION_ORDER — must match API validation.
 * @type {readonly string[]}
 */
export const CHALLENGE_SCORE_REACTION_KEYS = Object.freeze([
	'thumbsUp',
	'thumbsDown',
	'heart',
	'joy',
	'grin',
	'openMouth',
	'sad',
	'angry',
	'clap',
	'hundred'
]);

/**
 * @param {string} key
 * @returns {number | null} score 1–10
 */
export function challengeReactionKeyToScore(key) {
	const i = CHALLENGE_SCORE_REACTION_KEYS.indexOf(key);
	return i >= 0 ? i + 1 : null;
}

/**
 * @param {number} score — 1–10
 * @returns {string | null}
 */
export function challengeScoreToReactionKey(score) {
	const n = Number(score);
	if (!Number.isFinite(n) || n < 1 || n > 10) return null;
	return CHALLENGE_SCORE_REACTION_KEYS[n - 1] ?? null;
}
