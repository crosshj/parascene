import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { hydrateChallengeHeroImage } from './heroHydrate.js';
import { createChallengeVoteModal, buildVoteSlidesNewestFirst } from './challengeVoteModal.js';
import { renderEmptyParticipantPane } from './views/emptyParticipantView.js';
import { renderHeroSection } from './views/heroView.js';
import { participantHeroViewModel } from './views/presentParticipantHero.js';
import { renderChallengeCountdowns } from './views/countdownView.js';
import { renderChallengeHeroImage, renderDetailsAndReward } from './views/detailsRewardView.js';
import { renderChallengeVoteHeroCta, renderSubmissionsSection } from './views/submissionsView.js';
import { renderResultsSection } from './views/resultsView.js';

/**
 * @param {ReturnType<typeof buildChallengesChannelModel>} model
 * @param {{
 *   viewerId: number | null,
 * }} opts
 */
export function renderChallengesPaneHtml(model, opts) {
	let html = '<div class="challenge-pane">';
	const { latestConfig, phase, rankedSubmissions } = model.participant;

	if (!latestConfig) {
		html += renderEmptyParticipantPane();
		html += '</div>';
		return html;
	}

	const heroVm = participantHeroViewModel(latestConfig);
	html += renderHeroSection({
		title: heroVm.title,
		phase,
		countdownHtml: renderChallengeCountdowns(latestConfig, phase, model.nowMs)
	});

	html += renderChallengeHeroImage(latestConfig, heroVm.title);
	html += renderChallengeVoteHeroCta({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions
	});
	html += renderDetailsAndReward(latestConfig);

	html += renderSubmissionsSection({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions
	});

	if (phase === 'results') {
		html += renderResultsSection({ ranked: rankedSubmissions });
	}

	html += '</div>';
	return html;
}

function phaseUsesModalVoteOnly(phase) {
	return phase === 'voting' || phase === 'submit_and_vote';
}

function countUnvotedSubmissions(ranked, viewerId) {
	const vid = Number(viewerId);
	if (!Number.isFinite(vid) || vid <= 0) return 0;
	return ranked.filter((r) => r.messageId && !r.viewerVote).length;
}

function syncVoteTabChrome(root, ranked, viewerId, phase) {
	if (!phaseUsesModalVoteOnly(phase)) return;

	const voteTab = root.querySelector('[data-challenge-action-tab="vote"]');
	const badge = root.querySelector('[data-challenge-vote-tab-badge]');
	const openBtn = root.querySelector('[data-challenge-vote-open]');
	const hasVoteTab = voteTab instanceof HTMLButtonElement;
	const ariaHost =
		hasVoteTab && voteTab instanceof HTMLElement ? voteTab : openBtn instanceof HTMLButtonElement ? openBtn : null;

	const submissionRows = ranked.filter((r) => r.messageId);
	const total = submissionRows.length;
	const unvoted = countUnvotedSubmissions(ranked, viewerId);
	const vid = Number(viewerId);
	const allDone = total > 0 && unvoted === 0 && Number.isFinite(vid) && vid > 0;

	if (hasVoteTab) {
		voteTab.classList.toggle('challenge-pane-action-tab--vote-queue', unvoted > 1);
		voteTab.classList.toggle('challenge-pane-action-tab--vote-done', allDone);
	}

	if (openBtn instanceof HTMLButtonElement) {
		openBtn.classList.toggle('challenge-pane-vote-hero-btn--inactive', allDone);
		if (!hasVoteTab) {
			openBtn.classList.toggle('challenge-pane-vote-hero-btn--queue', unvoted > 1);
		}
	}

	if (badge instanceof HTMLElement) {
		if (unvoted > 1) {
			badge.hidden = false;
			badge.removeAttribute('aria-hidden');
			badge.textContent = String(unvoted);
			const label = `${unvoted} submissions not scored`;
			badge.title = label;
			if (ariaHost instanceof HTMLElement) ariaHost.setAttribute('aria-description', label);
		} else {
			badge.hidden = true;
			badge.setAttribute('aria-hidden', 'true');
			badge.textContent = '';
			badge.removeAttribute('title');
			if (ariaHost instanceof HTMLElement) ariaHost.removeAttribute('aria-description');
		}
	}
}

/**
 * @param {{
 *   root: HTMLElement,
 *   threadId: number,
 *   viewerId: number | null,
 *   messages: object[],
 *   reload: () => Promise<void>,
 *   postMessage: (body: string) => Promise<{ ok: boolean, error?: string }>,
 *   toggleReaction: (messageId: number, emojiKey: string) => Promise<{ ok?: boolean, data?: { added?: boolean } }>,
 *   reactionIconHtml: (key: string, className?: string) => string,
 * }} opts
 */
export function mountChallengesPane(opts) {
	const { root, viewerId, messages, reload, toggleReaction } = opts;

	const model = buildChallengesChannelModel(messages, {
		viewerId,
		nowMs: Date.now()
	});

	const ranked = model.participant.rankedSubmissions;
	const phase = model.participant.phase;

	root.innerHTML = renderChallengesPaneHtml(model, {
		viewerId
	});

	void hydrateChallengeHeroImage(root);

	const voteModal = createChallengeVoteModal({
		toggleReaction,
		onAfterVote: () => {
			syncVoteTabChrome(root, ranked, viewerId, phase);
		}
	});

	syncVoteTabChrome(root, ranked, viewerId, phase);

	const onRootClick = async (e) => {
		const tabBtn = e.target?.closest?.('[data-challenge-action-tab]');
		if (tabBtn instanceof HTMLButtonElement) {
			if (tabBtn.disabled) return;
			const id = tabBtn.getAttribute('data-challenge-action-tab');
			if (id !== 'submit' && id !== 'vote') return;
			for (const t of root.querySelectorAll('[data-challenge-action-tab]')) {
				if (!(t instanceof HTMLButtonElement)) continue;
				const tid = t.getAttribute('data-challenge-action-tab');
				const sel = tid === id;
				t.setAttribute('aria-selected', sel ? 'true' : 'false');
				t.classList.toggle('is-active', sel);
			}
			for (const p of root.querySelectorAll('[data-challenge-action-panel]')) {
				if (!(p instanceof HTMLElement)) continue;
				const pid = p.getAttribute('data-challenge-action-panel');
				const show = pid === id;
				p.hidden = !show;
				p.classList.toggle('is-active', show);
			}
			return;
		}

		const voteOpen = e.target?.closest?.('[data-challenge-vote-open]');
		if (voteOpen instanceof HTMLButtonElement) {
			if (!phaseUsesModalVoteOnly(phase)) return;
			const slides = buildVoteSlidesNewestFirst(ranked);
			if (!slides.length) return;
			const challengeTitle = model.participant.latestConfig
				? participantHeroViewModel(model.participant.latestConfig).title
				: '';
			voteModal.open(slides, { challengeTitle });
		}
	};

	root.addEventListener('click', onRootClick);

	return {
		destroy: () => {
			voteModal.destroy();
			root.removeEventListener('click', onRootClick);
			root.innerHTML = '';
		}
	};
}
