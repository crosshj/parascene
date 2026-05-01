/**
 * True when this creation has been submitted to at least one challenge (see meta.challenge_submissions).
 * @param {unknown} meta
 */
export function creationMetaHasChallengeSubmission(meta) {
	return Array.isArray(meta?.challenge_submissions) && meta.challenge_submissions.length > 0;
}
