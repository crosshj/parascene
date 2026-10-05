/**
 * Challenge score reactions must be exclusive: one score key per voter per submission.
 */

import { CHALLENGE_SCORE_REACTION_KEYS } from '../constants.js';

/**
 * Remove `userId` from every challenge-score reaction bucket except optional `keepKey`.
 * Mutates `bucket` in place.
 *
 * @param {Record<string, number[]>} bucket emoji_key → user ids
 * @param {unknown} userId
 * @param {{ keepKey?: string | null }} [opts]
 * @returns {boolean} whether any bucket changed
 */
export function stripUserFromChallengeScoreReactions(bucket, userId, opts = {}) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0 || !bucket || typeof bucket !== 'object') return false;
	const keepKey =
		typeof opts.keepKey === 'string' && opts.keepKey.trim() ? opts.keepKey.trim() : null;
	let changed = false;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		if (keepKey && key === keepKey) continue;
		const arr = Array.isArray(bucket[key]) ? bucket[key].map((x) => Number(x)) : [];
		const next = arr.filter((n) => Number.isFinite(n) && n > 0 && n !== uid);
		if (next.length === arr.length) continue;
		changed = true;
		if (next.length === 0) delete bucket[key];
		else bucket[key] = [...new Set(next)];
	}
	return changed;
}

/**
 * Whether `emojiKey` is one of the reserved challenge score reaction keys.
 * @param {unknown} emojiKey
 */
export function isChallengeScoreReactionKey(emojiKey) {
	return CHALLENGE_SCORE_REACTION_KEYS.includes(String(emojiKey || '').trim());
}
