import { CHALLENGE_SCORE_REACTION_KEYS, challengeReactionKeyToScore } from './constants.js';

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
