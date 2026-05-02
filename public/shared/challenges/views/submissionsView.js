import { esc } from '../constants.js';
import { rankedSubmissionsForPeerVoting } from '../model/participantSlice.js';

/**
 * @param {{
 *   phase: string,
 *   viewerId: number | null,
 *   ranked: object[],
 * }} vm
 */
export function renderSubmissionsList(vm) {
	if (!vm.ranked.length) {
		return `<p class="challenge-pane-muted">No submissions yet.</p>`;
	}
	let html = `<ul class="challenge-pane-submissions">`;
	for (const row of vm.ranked) {
		const cid = row.creationId;
		const href = cid ? `/creations/${encodeURIComponent(String(cid))}` : '#';
		const uname =
			typeof row.msg?.sender_user_name === 'string' && row.msg.sender_user_name.trim()
				? `@${row.msg.sender_user_name.trim()}`
				: `User ${row.senderId ?? '?'}`;
		html += `<li class="challenge-pane-card" data-challenge-submission-id="${row.messageId ?? ''}">
				<div class="challenge-pane-card-head">
					<a class="challenge-pane-creation-link" href="${esc(href)}">${cid ? `Creation #${cid}` : 'Submission'}</a>
					<span class="challenge-pane-author">${esc(uname)}</span>
					<span class="challenge-pane-score" title="Weighted reaction score">Score: ${esc(String(row.score))}</span>
				</div>`;

		html += `</li>`;
	}
	html += `</ul>`;
	return html;
}

function challengePhaseUsesSubmitVoteTabs(phase) {
	return phase === 'submitting' || phase === 'voting' || phase === 'submit_and_vote';
}

function phaseShowsVoteUiInModalOnly(phase) {
	return phase === 'voting' || phase === 'submit_and_vote';
}

/**
 * Full-width primary CTA under challenge hero image (opens blind voting modal).
 * Badge lives on this button when there is no Vote tab; otherwise the tab carries the badge.
 * @param {{
 *   phase: string,
 *   viewerId: number | null,
 *   ranked: object[],
 * }} vm
 */
export function renderChallengeVoteHeroCta(vm) {
	if (!phaseShowsVoteUiInModalOnly(vm.phase)) return '';

	const peerRanked = rankedSubmissionsForPeerVoting(vm.ranked, vm.viewerId ?? null);
	const voteDisabled = peerRanked.length === 0;
	const showSubmitTab =
		vm.phase !== 'submitting' && vm.phase !== 'submit_and_vote';
	const badgeOnHero = !showSubmitTab;

	const vid = Number(vm.viewerId);
	const signedIn = Number.isFinite(vid) && vid > 0;

	if (!signedIn) {
		return `<section class="challenge-pane-section challenge-pane-vote-hero-cta">
			<p class="challenge-pane-muted challenge-pane-vote-hero-guest">Sign in to vote on submissions.</p>
		</section>`;
	}

	if (voteDisabled) {
		return '';
	}

	const badgeHtml = badgeOnHero
		? `<span class="challenge-pane-vote-tab-badge" hidden data-challenge-vote-tab-badge aria-hidden="true"></span>`
		: '';

	return `
<section class="challenge-pane-section challenge-pane-vote-hero-cta">
	<button type="button" class="challenge-pane-vote-hero-btn" data-challenge-vote-open>
		<span class="challenge-pane-vote-open-inner">
			<span class="challenge-pane-vote-hero-btn-label">Vote</span>
			${badgeHtml}
		</span>
	</button>
</section>`;
}

/**
 * @param {{
 *   phase: string,
 *   viewerId: number | null,
 *   ranked: object[],
 * }} vm
 */
export function renderSubmissionsSection(vm) {
	const listHtml = renderSubmissionsList(vm);
	const peerRanked = rankedSubmissionsForPeerVoting(vm.ranked, vm.viewerId ?? null);
	const modalVoteOnly = phaseShowsVoteUiInModalOnly(vm.phase);

	if (!challengePhaseUsesSubmitVoteTabs(vm.phase)) {
		let html = `<section class="challenge-pane-section challenge-pane-submissions-section"><h3 class="challenge-pane-section-label">Submissions</h3>`;
		html += listHtml;
		html += `</section>`;
		return html;
	}

	const voteDisabled = peerRanked.length === 0;
	const showSubmitTab =
		vm.phase !== 'submitting' && vm.phase !== 'submit_and_vote';

	if (modalVoteOnly && !showSubmitTab) {
		if (voteDisabled) {
			const onlyOwn =
				Array.isArray(vm.ranked) &&
				vm.ranked.length > 0 &&
				peerRanked.length === 0;
			const msg = onlyOwn
				? 'No one else has submitted yet—check back to vote on other entries.'
				: 'No submissions yet.';
			return `<section class="challenge-pane-section challenge-pane-submissions-section"><p class="challenge-pane-muted">${esc(msg)}</p></section>`;
		}
		return '';
	}

	const defaultTab = showSubmitTab && voteDisabled ? 'submit' : 'vote';

	const votePanelBody = modalVoteOnly ? '' : listHtml;

	const omitSubmissionsHeading = modalVoteOnly;
	let html = `<section class="challenge-pane-section challenge-pane-submissions-section${omitSubmissionsHeading ? ' challenge-pane-submissions-section--modal-vote' : ''}">`;
	if (!omitSubmissionsHeading) {
		html += `<h3 class="challenge-pane-section-label">Submissions</h3>`;
	}

	html += `<div class="challenge-pane-action-tabs" role="tablist" aria-label="Challenge actions">`;
	if (showSubmitTab) {
		html += `<button type="button" role="tab" class="challenge-pane-action-tab${defaultTab === 'submit' ? ' is-active' : ''}" id="challenge-tab-submit" data-challenge-action-tab="submit" aria-controls="challenge-panel-submit" aria-selected="${defaultTab === 'submit' ? 'true' : 'false'}">Submit</button>`;
	}
	html += `<button type="button" role="tab" class="challenge-pane-action-tab${defaultTab === 'vote' ? ' is-active' : ''}" id="challenge-tab-vote" data-challenge-action-tab="vote" aria-controls="challenge-panel-vote" aria-selected="${defaultTab === 'vote' ? 'true' : 'false'}"${voteDisabled ? ' disabled' : ''}><span class="challenge-pane-action-tab-label">Vote</span><span class="challenge-pane-vote-tab-badge" hidden data-challenge-vote-tab-badge aria-hidden="true"></span></button>`;
	html += `</div>`;

	html += `<div class="challenge-pane-action-panel-wrap">`;

	if (showSubmitTab) {
		html += `<div class="challenge-pane-action-panel${defaultTab === 'submit' ? ' is-active' : ''}" id="challenge-panel-submit" data-challenge-action-panel="submit" role="tabpanel" aria-labelledby="challenge-tab-submit"${defaultTab !== 'submit' ? ' hidden' : ''}>`;
		html += `<p class="challenge-pane-muted">Submissions are closed.</p>`;
		html += `</div>`;
	}

	html += `<div class="challenge-pane-action-panel${defaultTab === 'vote' ? ' is-active' : ''}" id="challenge-panel-vote" data-challenge-action-panel="vote" role="tabpanel" aria-labelledby="challenge-tab-vote"${showSubmitTab && defaultTab !== 'vote' ? ' hidden' : ''}">`;
	html += votePanelBody;
	html += `</div>`;

	html += `</div>`;
	html += `</section>`;
	return html;
}
