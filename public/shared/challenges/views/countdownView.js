import { pickChallengeConfigTimestamp } from '../challengeAdmin.js';
import { esc } from '../constants.js';
import { parseIso } from '../model/phases.js';

/**
 * @param {number | null} endMs
 * @param {number} nowMs
 * @returns {number | null} whole days remaining (ceil), or null if no deadline / already passed
 */
export function wholeDaysUntil(endMs, nowMs) {
	if (endMs == null || !(nowMs < endMs)) return null;
	const d = Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000));
	return d >= 1 ? d : null;
}

/**
 * @param {object} cfg challenge_config
 * @param {string} phase from deriveChallengePhase
 * @param {number} nowMs
 */
export function renderChallengeCountdowns(cfg, phase, nowMs) {
	const submitPhase =
		phase === 'submitting' || phase === 'submit_and_vote';
	const votePhase = phase === 'voting' || phase === 'submit_and_vote';

	const submitEndMs = submitPhase ? parseIso(pickChallengeConfigTimestamp(cfg, 'submission_end_at')) : null;
	const voteEndMs = votePhase ? parseIso(pickChallengeConfigTimestamp(cfg, 'voting_end_at')) : null;

	const submitDays =
		submitPhase && submitEndMs != null ? wholeDaysUntil(submitEndMs, nowMs) : null;
	const voteDays =
		votePhase && voteEndMs != null ? wholeDaysUntil(voteEndMs, nowMs) : null;

	const collapseToSingle =
		submitPhase &&
		votePhase &&
		submitDays != null &&
		voteDays != null &&
		submitDays === voteDays;

	if (collapseToSingle) {
		const d = submitDays;
		const inner =
			d === 1
				? '<strong>1</strong> day left'
				: `<strong>${esc(String(d))}</strong> days left`;
		return `<div class="challenge-pane-countdown-strip" role="status"><p class="challenge-pane-countdown">${inner}</p></div>`;
	}

	let submitHtml = '';
	if (submitPhase && submitDays != null) {
		submitHtml =
			submitDays === 1
				? '<strong>1</strong> day left to submit'
				: `<strong>${esc(String(submitDays))}</strong> days left to submit`;
	}

	let voteHtml = '';
	if (votePhase && voteDays != null) {
		voteHtml =
			voteDays === 1
				? '<strong>1</strong> day left to vote'
				: `<strong>${esc(String(voteDays))}</strong> days left to vote`;
	}

	if (!submitHtml && !voteHtml) return '';

	const inner =
		submitHtml && voteHtml
			? `${submitHtml}<span class="challenge-pane-countdown-sep" aria-hidden="true"> · </span>${voteHtml}`
			: submitHtml || voteHtml;

	const cls =
		submitHtml && voteHtml
			? 'challenge-pane-countdown challenge-pane-countdown--dual'
			: submitHtml
				? 'challenge-pane-countdown challenge-pane-countdown--submit'
				: 'challenge-pane-countdown challenge-pane-countdown--vote';

	return `<div class="challenge-pane-countdown-strip" role="status"><p class="${cls}">${inner}</p></div>`;
}
