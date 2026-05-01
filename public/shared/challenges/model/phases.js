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
 * Human-readable phase label for hero and timeline badges.
 * @param {string} phase
 */
export function challengePhaseDisplayLabel(phase) {
	if (phase === 'submit_and_vote') return 'Open for submissions & voting';
	const s = String(phase || '').replace(/_/g, ' ');
	return s || '—';
}

/**
 * @param {object | null} cfg
 * @param {number} nowMs
 */
export function deriveChallengePhase(cfg, nowMs) {
	if (!cfg) return 'empty';
	const subStart =
		parseIso(cfg.submission_start_at) ??
		parseIso(cfg.start_at) ??
		parseIso(cfg.submissionStartAt) ??
		parseIso(cfg.startAt);
	const subEnd =
		parseIso(cfg.submission_end_at) ??
		parseIso(cfg.submissionEndAt);
	const voteStart =
		parseIso(cfg.voting_start_at) ??
		parseIso(cfg.votingStartAt);
	const voteEnd =
		parseIso(cfg.voting_end_at) ??
		parseIso(cfg.votingEndAt) ??
		parseIso(cfg.end_at) ??
		parseIso(cfg.endAt);

	const submissionOpen =
		(subStart == null || nowMs >= subStart) && (subEnd == null || nowMs <= subEnd);

	if (voteEnd != null && nowMs > voteEnd) return 'results';

	const votingOpen =
		voteEnd != null &&
		nowMs <= voteEnd &&
		(voteStart != null
			? nowMs >= voteStart
			: subEnd != null
				? nowMs > subEnd
				: false);
	if (votingOpen && submissionOpen) return 'submit_and_vote';
	if (votingOpen) return 'voting';

	if (voteStart != null && nowMs < voteStart) {
		const pastSubmission = subEnd != null && nowMs > subEnd;
		if (pastSubmission) return 'between';
		if (subStart != null && nowMs < subStart) return 'pre_submit';
		return 'submitting';
	}

	if (subStart != null && nowMs < subStart) return 'pre_submit';

	const inSubmissionOnly =
		(subStart == null || nowMs >= subStart) && (subEnd == null || nowMs <= subEnd);
	if (inSubmissionOnly) return 'submitting';

	if (subEnd != null && nowMs > subEnd && voteStart == null && voteEnd == null) return 'results';

	return 'unknown';
}
