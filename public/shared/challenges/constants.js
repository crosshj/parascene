/**
 * Challenge scoring reactions + helpers + `?v=` for dynamic imports (plain ESM: avoid extra micro-files).
 */

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
 * Query suffix for dynamic `import()` (`?v=…`). Matches `meta[name="asset-version"]` / chat `getImportQuery`.
 */
export function getChallengesImportQuery() {
	try {
		if (typeof document === 'undefined') return '';
		const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
		return v ? `?v=${encodeURIComponent(v)}` : '';
	} catch {
		return '';
	}
}

/** HTML attribute escape for challenge view templates (was a separate file). */
export function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
