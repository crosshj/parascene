/**
 * Challenge scoring reactions and small shared helpers.
 */

/**
 * @param {unknown} ms
 * @returns {number | null}
 */
export function parseIso(ms) {
	if (ms == null) return null;
	const t = Date.parse(String(ms));
	return Number.isFinite(t) ? t : null;
}

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

/**
 * Weighted vote total from reaction counts (valid when each voter uses at most one score reaction).
 * @param {Record<string, unknown>} reactions
 */
export function weightedScoreFromReactions(reactions) {
	if (!reactions || typeof reactions !== 'object') return 0;
	let sum = 0;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const w = challengeReactionKeyToScore(key);
		if (w == null) continue;
		const raw = reactions[key];
		const n =
			typeof raw === 'number' && Number.isFinite(raw)
				? Math.max(0, Math.floor(raw))
				: 0;
		sum += n * w;
	}
	return sum;
}

/**
 * How many challenge-score reactions exist on one message (count aggregates or user-id arrays).
 * @param {Record<string, unknown>} reactions
 */
export function totalVoteCountFromChallengeReactions(reactions) {
	if (!reactions || typeof reactions !== 'object') return 0;
	let sum = 0;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const raw = reactions[key];
		if (Array.isArray(raw)) {
			sum += raw.length;
		} else if (typeof raw === 'number' && Number.isFinite(raw)) {
			sum += Math.max(0, Math.floor(raw));
		}
	}
	return sum;
}

/** HTML attribute escape for challenge view templates (was a separate file). */
export function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
