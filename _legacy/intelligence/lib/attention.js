/**
 * Attention scoring for creations.
 * Comments, remixes, and shares weigh more than likes.
 */

const WEIGHTS = {
	likes: 1,
	comments: 4,
	remixes: 7,
	shares: 8
};

/**
 * @param {{ likes?: number, comments?: number, remixes?: number, shares?: number, views?: number|null }} c
 * @returns {{ attention_score: number, attention_rate: number|null }}
 */
export function computeAttention(c) {
	const likes = Number(c.likes ?? 0) || 0;
	const comments = Number(c.comments ?? 0) || 0;
	const remixes = Number(c.remixes ?? 0) || 0;
	const shares = Number(c.shares ?? 0) || 0;
	const views = c.views != null ? Number(c.views) : null;

	const attention_score =
		likes * WEIGHTS.likes +
		comments * WEIGHTS.comments +
		remixes * WEIGHTS.remixes +
		shares * WEIGHTS.shares;

	let attention_rate = null;
	if (views != null && Number.isFinite(views) && views > 0) {
		attention_rate = attention_score / views;
	}

	return { attention_score, attention_rate };
}

export { WEIGHTS };
