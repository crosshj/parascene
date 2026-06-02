import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { rankedSubmissionsForPeerVoting } from './model/participantSlice.js';
import {
	renderEmptyParticipantPane,
	renderNextChallengeSection,
	renderPastChallengesSection
} from './views/emptyParticipantView.js';
import { renderHeroSection } from './views/heroView.js';
import { participantHeroViewModel } from './views/presentParticipantHero.js';
import { renderChallengeCountdowns } from './views/countdownView.js';
import { renderChallengeHeroImage, renderDetailsAndReward } from './views/detailsRewardView.js';
import { renderChallengeVoteHeroCta, renderSubmissionsSection } from './views/submissionsView.js';
import {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} from '../../shared/userText.js';
import { createChallengeVoteModal, buildVoteSlidesNewestFirst } from './challengeVoteModal.js';

/**
 * @param {object | null} data — GET /api/create/images/:id
 * @returns {string | null}
 */
function imageUrlFromCreationPayload(data) {
	if (!data || data._error) return null;
	const statusRaw =
		typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'completed';
	if (statusRaw !== 'completed') return null;
	const mediaType = typeof data.media_type === 'string' ? data.media_type : 'image';
	const url = typeof data.url === 'string' ? data.url.trim() : '';
	const thumb =
		typeof data.thumbnail_url === 'string' ? data.thumbnail_url.trim() : '';
	if (mediaType === 'video') {
		return thumb || url || null;
	}
	return url || thumb || null;
}

/**
 * Resolve challenge hero ref (creation/share URL or image URL) inside `.challenge-pane-root`.
 * @param {Element | null | undefined} rootEl
 */
async function hydrateChallengeHeroImage(rootEl) {
	const wrap = rootEl?.querySelector?.('[data-challenge-hero-pending]');
	if (!(wrap instanceof HTMLElement)) return;

	const raw = wrap.getAttribute('data-challenge-hero-ref') || '';
	const img = wrap.querySelector('[data-challenge-hero-img]');
	const fallback = wrap.querySelector('[data-challenge-hero-fallback]');
	const placeholder = wrap.querySelector('[data-challenge-hero-placeholder]');

	const showFallback = (message) => {
		wrap.removeAttribute('data-challenge-hero-pending');
		wrap.classList.remove(
			'challenge-pane-hero-image-wrap--pending',
			'challenge-pane-hero-image-wrap--loading'
		);
		wrap.classList.add('challenge-pane-hero-image-wrap--error');
		if (img instanceof HTMLImageElement) {
			img.removeAttribute('src');
			img.hidden = true;
		}
		if (placeholder instanceof HTMLElement) placeholder.hidden = true;
		if (fallback instanceof HTMLElement) {
			fallback.hidden = false;
			fallback.textContent = message;
		}
	};

	let src = null;
	const cref = parseHeroCreationOrShareRef(raw);
	if (cref?.kind === 'creation') {
		const data = await fetchCreationEmbedPayload(cref.creationId, cref.shareOpts);
		src = imageUrlFromCreationPayload(data);
	} else {
		src = parseHeroDirectMediaUrl(raw);
	}

	if (!src || !(img instanceof HTMLImageElement)) {
		showFallback('Could not load challenge image.');
		return;
	}

	wrap.classList.add('challenge-pane-hero-image-wrap--loading');
	if (fallback instanceof HTMLElement) fallback.hidden = true;

	const revealLoaded = () => {
		wrap.removeAttribute('data-challenge-hero-pending');
		wrap.classList.remove(
			'challenge-pane-hero-image-wrap--pending',
			'challenge-pane-hero-image-wrap--loading',
			'challenge-pane-hero-image-wrap--error'
		);
		wrap.classList.add('challenge-pane-hero-image-wrap--loaded');
		if (placeholder instanceof HTMLElement) placeholder.hidden = true;
		img.hidden = false;
	};

	img.addEventListener(
		'load',
		() => {
			if (img.naturalWidth > 0) revealLoaded();
		},
		{ once: true }
	);
	img.addEventListener(
		'error',
		() => {
			showFallback('Could not load challenge image.');
		},
		{ once: true }
	);
	img.src = src;
	if (img.complete && img.naturalWidth > 0) {
		revealLoaded();
	}
}

/**
 * Resolve challenge history card media refs inside `.challenge-pane-root`.
 * @param {Element | null | undefined} rootEl
 */
async function hydrateChallengeHistoryThumbnails(rootEl) {
	const wraps = Array.from(
		rootEl?.querySelectorAll?.('[data-challenge-history-thumb-pending]') || []
	);
	for (const wrap of wraps) {
		if (!(wrap instanceof HTMLElement)) continue;
		const raw = wrap.getAttribute('data-challenge-history-thumb-ref') || '';
		const img = wrap.querySelector('[data-challenge-history-thumb-img]');
		const fallback = wrap.querySelector('[data-challenge-history-thumb-fallback]');

		const showFallback = () => {
			wrap.removeAttribute('data-challenge-history-thumb-pending');
			if (img instanceof HTMLImageElement) {
				img.removeAttribute('src');
				img.hidden = true;
			}
			if (fallback instanceof HTMLElement) {
				fallback.hidden = false;
			}
		};

		if (!(img instanceof HTMLImageElement)) {
			showFallback();
			continue;
		}

		let src = null;
		const cref = parseHeroCreationOrShareRef(raw);
		if (cref?.kind === 'creation') {
			const data = await fetchCreationEmbedPayload(cref.creationId, cref.shareOpts);
			src = imageUrlFromCreationPayload(data);
		} else {
			src = parseHeroDirectMediaUrl(raw);
		}

		if (!src) {
			showFallback();
			continue;
		}

		if (fallback instanceof HTMLElement) fallback.hidden = true;
		// Reveal immediately once a resolvable source exists; if load fails, error handler restores fallback.
		wrap.removeAttribute('data-challenge-history-thumb-pending');
		img.hidden = false;
		img.addEventListener(
			'error',
			() => {
				showFallback();
			},
			{ once: true }
		);
		img.addEventListener(
			'load',
			() => {
				if (img.naturalWidth > 0) {
					wrap.removeAttribute('data-challenge-history-thumb-pending');
					img.hidden = false;
				}
			},
			{ once: true }
		);
		img.src = src;
		if (img.complete && img.naturalWidth > 0) {
			wrap.removeAttribute('data-challenge-history-thumb-pending');
			img.hidden = false;
		}
	}
}

function consumeAutoOpenVoteIntentFromUrl() {
	try {
		const u = new URL(window.location.href);
		const open = String(u.searchParams.get('open') || '').trim().toLowerCase();
		const action = String(u.searchParams.get('challenge_action') || '').trim().toLowerCase();
		const shouldOpen = open === 'vote' || action === 'vote';
		if (!shouldOpen) return false;
		u.searchParams.delete('open');
		u.searchParams.delete('challenge_action');
		const next = `${u.pathname}${u.search}${u.hash}`;
		history.replaceState(history.state, '', next);
		return true;
	} catch {
		return false;
	}
}

/**
 * @param {ReturnType<typeof buildChallengesChannelModel>} model
 * @param {{
 *   viewerId: number | null,
 * }} opts
 */
export function renderChallengesPaneHtml(model, opts) {
	let html = '<div class="challenge-pane">';
	const { latestConfig, phase, rankedSubmissions } = model.participant;
	const challengeId =
		latestConfig && latestConfig.challenge_id != null
			? String(latestConfig.challenge_id).trim()
			: '';
	const isActiveChallenge =
		phase === 'submitting' || phase === 'voting' || phase === 'submit_and_vote';

	if (!latestConfig) {
		html += renderEmptyParticipantPane(model.raw.configs);
		html += '</div>';
		return html;
	}

	if (!isActiveChallenge) {
		html += renderEmptyParticipantPane(model.raw.configs);
		html += '</div>';
		return html;
	}

	const heroVm = participantHeroViewModel(latestConfig, rankedSubmissions);
	html += renderHeroSection({
		title: heroVm.title,
		phase,
		stats: heroVm.stats,
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

	html += renderNextChallengeSection(model.raw.configs, {
		excludeChallengeId: challengeId
	});

	html += renderPastChallengesSection(model.raw.configs, {
		excludeChallengeId: challengeId
	});

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
export async function mountChallengesPane(opts) {
	const { root, viewerId, messages, reload, toggleReaction } = opts;

	const model = buildChallengesChannelModel(messages, {
		viewerId,
		nowMs: Date.now()
	});

	const ranked = model.participant.rankedSubmissions;
	const rankedPeers = rankedSubmissionsForPeerVoting(ranked, viewerId);
	const phase = model.participant.phase;

	root.innerHTML = renderChallengesPaneHtml(model, {
		viewerId
	});

	void hydrateChallengeHeroImage(root);
	void hydrateChallengeHistoryThumbnails(root);

	const voteModal = createChallengeVoteModal({
		toggleReaction,
		onAfterVote: () => {
			syncVoteTabChrome(root, rankedPeers, viewerId, phase);
		}
	});

	const tryOpenVoteModal = () => {
		if (!phaseUsesModalVoteOnly(phase)) return;
		const slides = buildVoteSlidesNewestFirst(rankedPeers);
		const challengeTitle = model.participant.latestConfig
			? participantHeroViewModel(model.participant.latestConfig, rankedPeers).title
			: '';
		voteModal.open(slides, { challengeTitle });
	};

	syncVoteTabChrome(root, rankedPeers, viewerId, phase);

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
			tryOpenVoteModal();
		}
	};

	root.addEventListener('click', onRootClick);
	if (consumeAutoOpenVoteIntentFromUrl()) {
		tryOpenVoteModal();
	}

	return {
		destroy: () => {
			voteModal.destroy();
			root.removeEventListener('click', onRootClick);
			root.innerHTML = '';
		}
	};
}

/**
 * Open vote modal without mounting the full Challenges pane (used by feed CTA).
 * @param {{
 *   messages: object[],
 *   viewerId: number | null,
 *   toggleReaction: (messageId: number, emojiKey: string) => Promise<{ ok?: boolean, data?: { added?: boolean } }>,
 *   onAfterVote?: () => void,
 * }} opts
 * @returns {boolean} whether modal opened
 */
export function openChallengeVoteModalFromMessages(opts) {
	const messages = Array.isArray(opts?.messages) ? opts.messages : [];
	const viewerId = Number.isFinite(Number(opts?.viewerId)) ? Number(opts.viewerId) : null;
	const toggleReaction = opts?.toggleReaction;
	if (typeof toggleReaction !== 'function' || messages.length === 0) return false;

	const model = buildChallengesChannelModel(messages, {
		viewerId,
		nowMs: Date.now()
	});
	const rankedPeers = rankedSubmissionsForPeerVoting(model.participant.rankedSubmissions, viewerId);
	const phase = model.participant.phase;
	if (!phaseUsesModalVoteOnly(phase)) return false;
	const slides = buildVoteSlidesNewestFirst(rankedPeers);

	const challengeTitle = model.participant.latestConfig
		? participantHeroViewModel(model.participant.latestConfig, rankedPeers).title
		: '';
	const voteModal = createChallengeVoteModal({
		toggleReaction,
		onAfterVote: () => {
			if (typeof opts?.onAfterVote === 'function') {
				opts.onAfterVote();
			}
		}
	});
	voteModal.open(slides, { challengeTitle });
	return true;
}
