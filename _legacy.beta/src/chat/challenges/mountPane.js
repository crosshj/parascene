import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { rankedSubmissionsForPeerVoting } from './model/participantSlice.js';
import {
	renderEmptyParticipantPane,
	renderNextChallengeSection,
	renderPastChallengesSection
} from './views/emptyParticipantView.js';
import { renderHeroSection, renderHeroStats } from './views/heroView.js';
import { participantHeroViewModel } from './views/presentParticipantHero.js';
import { renderChallengeCountdowns } from './views/countdownView.js';
import { renderChallengeHeroImage, renderDetailsAndReward } from './views/detailsRewardView.js';
import { renderChallengeVoteHeroCta, renderSubmissionsSection } from './views/submissionsView.js';
import {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} from '../../shared/userText.js';
import { hydrateChallengeHistoryThumbnails } from '../../shared/challengeHistoryThumb.js';
import { createChallengeVoteModal, buildVoteSlidesNewestFirst } from './challengeVoteModal.js';
import { challengeTrackListRank, pickChallengeTrack } from './model/tracks.js';
import {
	challengesDetailsHref,
	isChallengesDetailsPathname,
	parseChallengesDetailsPath
} from './model/detailsRoute.js';
import { esc } from './constants.js';

function assetQuery() {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim();
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

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
	const previewFromMeta =
		typeof data.meta?.challenge_hero_preview_url === 'string'
			? data.meta.challenge_hero_preview_url.trim()
			: '';
	if (previewFromMeta) return previewFromMeta;
	const url = typeof data.url === 'string' ? data.url.trim() : '';
	const thumb =
		typeof data.thumbnail_url === 'string' ? data.thumbnail_url.trim() : '';
	if (mediaType === 'video') {
		return thumb || url || null;
	}
	// Prefer dedicated 16:9 hero preview; otherwise full-quality media URL.
	return url || thumb || null;
}

/**
 * Resolve challenge hero ref (creation/share URL or image URL) inside `.challenge-pane-root`.
 * @param {Element | null | undefined} rootEl
 */
async function hydrateChallengeHeroImage(rootEl) {
	const wraps = rootEl?.querySelectorAll?.('[data-challenge-hero-pending]');
	if (!wraps?.length) return;

	await Promise.all(
		[...wraps].map(async (wrap) => {
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

			let src = wrap.getAttribute('data-challenge-hero-preview-url') || '';
			src = src.trim() || null;
			const challengeId = wrap.getAttribute('data-challenge-id') || '';
			const challengeOpts = challengeId ? { challengeId } : null;
			if (!src) {
				const cref = parseHeroCreationOrShareRef(raw);
				if (cref?.kind === 'creation') {
					const data = await fetchCreationEmbedPayload(
						cref.creationId,
						cref.shareOpts,
						challengeOpts
					);
					src = imageUrlFromCreationPayload(data);
				} else {
					src = parseHeroDirectMediaUrl(raw);
				}
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
		})
	);
}

function consumeAutoOpenVoteIntentFromUrl() {
	try {
		const u = new URL(window.location.href);
		const open = String(u.searchParams.get('open') || '').trim().toLowerCase();
		const action = String(u.searchParams.get('challenge_action') || '').trim().toLowerCase();
		const challengeIdParam = String(u.searchParams.get('challenge_id') || '').trim();
		const shouldOpen = open === 'vote' || action === 'vote';
		if (!shouldOpen) return { open: false, challengeId: '' };
		u.searchParams.delete('open');
		u.searchParams.delete('challenge_action');
		u.searchParams.delete('challenge_id');
		const next = `${u.pathname}${u.search}${u.hash}`;
		history.replaceState(history.state, '', next);
		return { open: true, challengeId: challengeIdParam };
	} catch {
		return { open: false, challengeId: '' };
	}
}

/**
 * Deep-link: `/challenges/details/:challengeId` (or legacy `?challenge_id=…`)
 * opens that track’s detail when multiple challenges are live.
 * Vote intents use query params and are handled above.
 * @returns {string}
 */
function consumeFocusChallengeIdFromUrl() {
	try {
		const u = new URL(window.location.href);
		const open = String(u.searchParams.get('open') || '').trim().toLowerCase();
		const action = String(u.searchParams.get('challenge_action') || '').trim().toLowerCase();
		if (open === 'vote' || action === 'vote') return '';

		const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
		const fromPath = parseChallengesDetailsPath(path);
		if (fromPath?.challengeId) return fromPath.challengeId;

		const challengeIdParam = String(u.searchParams.get('challenge_id') || '').trim();
		if (!challengeIdParam) return '';

		// Legacy query deep-link → path form.
		u.pathname = challengesDetailsHref(challengeIdParam);
		u.searchParams.delete('challenge_id');
		const next = `${u.pathname}${u.search}${u.hash}`;
		history.replaceState(history.state, '', next);
		return challengeIdParam;
	} catch {
		return '';
	}
}

/**
 * @param {ReturnType<typeof buildChallengesChannelModel>} model
 */
function liveChallengeItems(model) {
	const activeChallenges = Array.isArray(model.participant?.activeChallenges)
		? model.participant.activeChallenges
		: [];
	const focusConfig = model.participant.latestConfig;
	const focusPhase = model.participant.phase;
	const focusId =
		focusConfig && focusConfig.challenge_id != null
			? String(focusConfig.challenge_id).trim()
			: '';

	if (activeChallenges.length > 0) return activeChallenges;
	if (
		focusConfig &&
		(focusPhase === 'submitting' ||
			focusPhase === 'voting' ||
			focusPhase === 'submit_and_vote')
	) {
		return [
			{
				challengeId: focusId,
				latestConfig: focusConfig,
				phase: focusPhase,
				rankedSubmissions: model.participant.rankedSubmissions || []
			}
		];
	}
	return [];
}

function renderOrganizeEntryCta() {
	return `<section class="challenge-pane-section challenge-pane-organize-entry">
	<a href="/challenges/organize" class="challenge-pane-organize-entry-btn" data-chat-challenges-organizer-open>
		<span class="challenge-pane-organize-entry-btn-label">Organize</span>
	</a>
</section>`;
}

/**
 * Legacy single-challenge pane: full hero / vote / details / submissions (no summary board).
 * @param {object} item
 * @param {{ viewerId: number | null, nowMs: number, showOrganize?: boolean }} opts
 */
function renderLegacySingleChallengePane(item, opts) {
	const latestConfig = item.latestConfig;
	const phase = item.phase;
	const rankedSubmissions = item.rankedSubmissions || [];
	const challengeId =
		latestConfig && latestConfig.challenge_id != null
			? String(latestConfig.challenge_id).trim()
			: item.challengeId || '';
	const heroVm = participantHeroViewModel(latestConfig, rankedSubmissions);
	const track = pickChallengeTrack(latestConfig);
	let html = `<div class="challenge-pane-active-list">`;
	html += `<section class="challenge-pane-active-card" data-challenge-id="${esc(challengeId)}">`;
	html += renderHeroSection({
		title: heroVm.title,
		phase,
		track,
		countdownHtml: renderChallengeCountdowns(latestConfig, phase, opts.nowMs)
	});
	html += renderChallengeHeroImage(latestConfig, heroVm.title);
	html += renderHeroStats(heroVm.stats, track);
	html += renderChallengeVoteHeroCta({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions,
		challengeId
	});
	if (opts.showOrganize) {
		html += renderOrganizeEntryCta();
	}
	html += renderDetailsAndReward(latestConfig);
	html += renderSubmissionsSection({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions
	});
	html += `</section></div>`;
	return html;
}

/**
 * Full detail view for one challenge when drilling in from the multi-track stack.
 * @param {object} item
 * @param {{ viewerId: number | null, nowMs: number }} opts
 */
function renderChallengeDetailView(item, opts) {
	const latestConfig = item.latestConfig;
	const phase = item.phase;
	const rankedSubmissions = item.rankedSubmissions || [];
	const challengeId =
		latestConfig && latestConfig.challenge_id != null
			? String(latestConfig.challenge_id).trim()
			: item.challengeId || '';
	const heroVm = participantHeroViewModel(latestConfig, rankedSubmissions);
	const track = pickChallengeTrack(latestConfig);

	let html = `<div class="challenge-pane-detail" data-challenge-detail data-challenge-id="${esc(challengeId)}">`;
	html += `<section class="challenge-pane-active-card" data-challenge-id="${esc(challengeId)}">`;
	html += renderHeroSection({
		title: heroVm.title,
		phase,
		track,
		countdownHtml: renderChallengeCountdowns(latestConfig, phase, opts.nowMs),
		omitTitle: true
	});
	html += renderChallengeHeroImage(latestConfig, heroVm.title);
	html += renderHeroStats(heroVm.stats, track);
	html += renderChallengeVoteHeroCta({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions,
		challengeId
	});
	html += renderDetailsAndReward(latestConfig);
	html += renderSubmissionsSection({
		phase,
		viewerId: opts.viewerId ?? null,
		ranked: rankedSubmissions
	});
	html += `</section></div>`;
	return html;
}

/**
 * Stacked-card actions: same purple Vote hero CTA as full detail, then muted More Info.
 * @param {{
 *   phase: string,
 *   challengeId: string,
 *   viewerId: number | null,
 *   ranked: object[]
 * }} opts
 */
function renderStackedChallengeActions(opts) {
	const phase = String(opts.phase || '');
	const challengeId = String(opts.challengeId || '').trim();
	const viewerId = opts.viewerId ?? null;
	const ranked = Array.isArray(opts.ranked) ? opts.ranked : [];

	let html = '';
	html += renderChallengeVoteHeroCta({
		phase,
		viewerId,
		ranked,
		forceHeroBadge: true,
		challengeId
	});
	html += `<section class="challenge-pane-section challenge-pane-stack-more-info">
		<a class="challenge-pane-stack-details-btn" href="${esc(challengesDetailsHref(challengeId))}" data-chat-challenge-details-open>More Info</a>
	</section>`;
	return html;
}

/**
 * Multi-track: stacked pared-down cards (hero + image + Vote/More Info).
 * Full rewards / how-to / submissions live in the detail drill-in. Monthly first.
 * @param {object[]} liveItems
 * @param {{ viewerId: number | null, nowMs: number, showOrganize?: boolean }} opts
 */
function renderStackedChallengePane(liveItems, opts) {
	const items = [...(Array.isArray(liveItems) ? liveItems : [])].sort((a, b) => {
		const ta = challengeTrackListRank(pickChallengeTrack(a?.latestConfig));
		const tb = challengeTrackListRank(pickChallengeTrack(b?.latestConfig));
		if (ta !== tb) return ta - tb;
		return String(a?.challengeId || '').localeCompare(String(b?.challengeId || ''));
	});

	let html = '';
	if (opts.showOrganize) {
		html += renderOrganizeEntryCta();
	}
	html += `<div class="challenge-pane-active-list challenge-pane-active-list--stacked">`;
	for (const item of items) {
		const latestConfig = item.latestConfig;
		const phase = item.phase;
		const rankedSubmissions = item.rankedSubmissions || [];
		const challengeId =
			latestConfig && latestConfig.challenge_id != null
				? String(latestConfig.challenge_id).trim()
				: String(item.challengeId || '').trim();
		const heroVm = participantHeroViewModel(latestConfig, rankedSubmissions);
		const track = pickChallengeTrack(latestConfig);
		html += `<section class="challenge-pane-active-card" data-challenge-id="${esc(challengeId)}">`;
		html += renderHeroSection({
			title: heroVm.title,
			phase,
			track,
			countdownHtml: renderChallengeCountdowns(latestConfig, phase, opts.nowMs)
		});
		html += renderChallengeHeroImage(latestConfig, heroVm.title);
		html += renderHeroStats(heroVm.stats, track);
		html += renderStackedChallengeActions({
			phase,
			challengeId,
			viewerId: opts.viewerId ?? null,
			ranked: rankedSubmissions
		});
		html += `</section>`;
	}
	html += `</div>`;
	return html;
}

/**
 * @param {ReturnType<typeof buildChallengesChannelModel>} model
 * @param {{
 *   viewerId: number | null,
 *   showOrganizeEntry?: boolean,
 *   detailChallengeId?: string | null
 * }} opts
 */
export function renderChallengesPaneHtml(model, opts) {
	let html = '<div class="challenge-pane">';
	const showOrganize = Boolean(opts?.showOrganizeEntry);
	const live = liveChallengeItems(model);
	const detailId =
		typeof opts?.detailChallengeId === 'string' ? opts.detailChallengeId.trim() : '';

	if (!live.length) {
		if (showOrganize) {
			html += renderOrganizeEntryCta();
		}
		html += renderEmptyParticipantPane(model.raw.configs);
		html += '</div>';
		return html;
	}

	const excludeIds = live
		.map((x) =>
			x.latestConfig?.challenge_id != null
				? String(x.latestConfig.challenge_id).trim()
				: String(x.challengeId || '').trim()
		)
		.filter(Boolean);

	// One active challenge → legacy full card.
	if (live.length === 1) {
		html += renderLegacySingleChallengePane(live[0], {
			viewerId: opts.viewerId ?? null,
			nowMs: model.nowMs,
			showOrganize
		});
		html += renderNextChallengeSection(model.raw.configs, {
			excludeChallengeIds: excludeIds
		});
		html += renderPastChallengesSection(model.raw.configs, {
			excludeChallengeIds: excludeIds
		});
		html += '</div>';
		return html;
	}

	// Detail drill-in from stacked card.
	if (detailId) {
		const detailItem =
			live.find((x) => {
				const cid =
					x.latestConfig?.challenge_id != null
						? String(x.latestConfig.challenge_id).trim()
						: String(x.challengeId || '').trim();
				return cid === detailId;
			}) || null;
		if (detailItem) {
			html += renderChallengeDetailView(detailItem, {
				viewerId: opts.viewerId ?? null,
				nowMs: model.nowMs
			});
			html += '</div>';
			return html;
		}
	}

	// 2+ active → stacked pared cards (monthly first).
	html += renderStackedChallengePane(live, {
		viewerId: opts.viewerId ?? null,
		nowMs: model.nowMs,
		showOrganize
	});
	html += renderNextChallengeSection(model.raw.configs, {
		excludeChallengeIds: excludeIds
	});
	html += renderPastChallengesSection(model.raw.configs, {
		excludeChallengeIds: excludeIds
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

/**
 * Card / detail root for one challenge. Nested `[data-challenge-id]` (hero thumb, Vote
 * button) must not win. Missing cards must not fall through to `root` — on a detail
 * page only one challenge is in the DOM, and painting from `root` would stamp every
 * other live track's unvoted count onto that badge.
 * @param {Element} root
 * @param {string} challengeId
 * @returns {Element | null}
 */
function resolveVoteChromeScope(root, challengeId) {
	const cid = String(challengeId || '').trim();
	if (!cid || !(root instanceof Element)) return null;
	const esc = CSS.escape(cid);
	return (
		root.querySelector(`[data-challenge-detail][data-challenge-id="${esc}"]`) ||
		root.querySelector(`.challenge-pane-summary-card[data-challenge-id="${esc}"]`) ||
		root.querySelector(`.challenge-pane-active-card[data-challenge-id="${esc}"]`) ||
		null
	);
}

/**
 * Sync vote badge chrome scoped to a challenge card / detail root.
 * @param {Element} scope
 * @param {object[]} rankedPeers
 * @param {number | null} viewerId
 * @param {string} phase
 */
function syncVoteTabChrome(scope, rankedPeers, viewerId, phase) {
	if (!phaseUsesModalVoteOnly(phase)) return;
	if (!(scope instanceof Element)) return;

	const voteTab = scope.querySelector('[data-challenge-action-tab="vote"]');
	const badges = scope.querySelectorAll('[data-challenge-vote-tab-badge]');
	const openBtn = scope.querySelector('[data-challenge-vote-open]');
	const hasVoteTab = voteTab instanceof HTMLButtonElement;
	const ariaHost =
		hasVoteTab && voteTab instanceof HTMLElement
			? voteTab
			: openBtn instanceof HTMLButtonElement
				? openBtn
				: null;

	const submissionRows = rankedPeers.filter((r) => r.messageId);
	const total = submissionRows.length;
	const unvoted = countUnvotedSubmissions(rankedPeers, viewerId);
	const vid = Number(viewerId);
	const allDone = total > 0 && unvoted === 0 && Number.isFinite(vid) && vid > 0;

	if (hasVoteTab) {
		voteTab.classList.toggle('challenge-pane-action-tab--vote-queue', unvoted > 1);
		voteTab.classList.toggle('challenge-pane-action-tab--vote-done', allDone);
	}

	if (openBtn instanceof HTMLButtonElement) {
		// Stacked board keeps the filled purple Vote CTA (same as full-detail active).
		const stackedBoard =
			Boolean(scope.closest?.('.challenge-pane-active-list--stacked')) &&
			!scope.closest?.('[data-challenge-detail]');
		if (stackedBoard) {
			openBtn.classList.remove('challenge-pane-vote-hero-btn--inactive');
		} else {
			openBtn.classList.toggle('challenge-pane-vote-hero-btn--inactive', allDone);
		}
		if (!hasVoteTab) {
			openBtn.classList.toggle('challenge-pane-vote-hero-btn--queue', unvoted > 1);
		}
	}

	const showBadge = unvoted > 0;
	const label = showBadge
		? unvoted === 1
			? '1 submission not scored'
			: `${unvoted} submissions not scored`
		: '';
	for (const badge of badges) {
		if (!(badge instanceof HTMLElement)) continue;
		if (showBadge) {
			badge.hidden = false;
			badge.removeAttribute('aria-hidden');
			badge.textContent = String(unvoted);
			badge.title = label;
		} else {
			badge.hidden = true;
			badge.setAttribute('aria-hidden', 'true');
			badge.textContent = '';
			badge.removeAttribute('title');
		}
	}
	if (ariaHost instanceof HTMLElement) {
		if (showBadge) ariaHost.setAttribute('aria-description', label);
		else ariaHost.removeAttribute('aria-description');
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
 *   toggleReaction: (messageId: number, emojiKey: string, opts?: { op?: 'add' | 'remove' }) => Promise<{ ok?: boolean, data?: { added?: boolean } }>,
 *   reactionIconHtml: (key: string, className?: string) => string,
 *   showOrganizeEntry?: boolean,
 *   onDetailsChrome?: (info: { challengeId: string, title: string } | null) => void,
 * }} opts
 */
export async function mountChallengesPane(opts) {
	const { root, viewerId, messages, toggleReaction, threadId } = opts;
	const onDetailsChrome =
		typeof opts.onDetailsChrome === 'function' ? opts.onDetailsChrome : null;

	const model = buildChallengesChannelModel(messages, {
		viewerId,
		nowMs: Date.now()
	});

	const live = liveChallengeItems(model);
	const isMultiTrack = live.length > 1;

	/** @type {string} */
	let detailChallengeId = '';

	const findLiveItem = (challengeId) => {
		const cid = String(challengeId || '').trim();
		if (!cid) return null;
		return (
			live.find((x) => {
				const id =
					x.latestConfig?.challenge_id != null
						? String(x.latestConfig.challenge_id).trim()
						: String(x.challengeId || '').trim();
				return id === cid;
			}) || null
		);
	};

	const focusFromUrl = consumeFocusChallengeIdFromUrl();
	if (isMultiTrack && focusFromUrl && findLiveItem(focusFromUrl)) {
		detailChallengeId = focusFromUrl;
	} else if (
		typeof window !== 'undefined' &&
		isChallengesDetailsPathname(window.location?.pathname) &&
		(!focusFromUrl || !findLiveItem(focusFromUrl))
	) {
		// Missing / unknown challenge on details route → fall back to the board.
		try {
			const u = new URL(window.location.href);
			u.pathname = '/challenges';
			u.searchParams.delete('challenge_id');
			history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
		} catch {
			// ignore
		}
	}

	const syncDetailsChrome = () => {
		if (!onDetailsChrome) return;
		const onDetailsPath =
			typeof window !== 'undefined' && isChallengesDetailsPathname(window.location?.pathname);
		if (!onDetailsPath) {
			onDetailsChrome(null);
			return;
		}
		const cid = detailChallengeId || focusFromUrl;
		const item = findLiveItem(cid) || (live.length === 1 ? live[0] : null);
		if (!item) {
			onDetailsChrome(null);
			return;
		}
		const itemId =
			item.latestConfig?.challenge_id != null
				? String(item.latestConfig.challenge_id).trim()
				: String(item.challengeId || '').trim();
		const peers = rankedSubmissionsForPeerVoting(item.rankedSubmissions || [], viewerId);
		const title = item.latestConfig
			? participantHeroViewModel(item.latestConfig, peers).title
			: '';
		onDetailsChrome({ challengeId: itemId, title });
	};

	const focusChallengeId =
		!detailChallengeId && focusFromUrl && findLiveItem(focusFromUrl) ? focusFromUrl : '';

	const render = () => {
		const effectiveDetailId = isMultiTrack ? detailChallengeId : '';
		root.innerHTML = renderChallengesPaneHtml(model, {
			viewerId,
			showOrganizeEntry: Boolean(opts.showOrganizeEntry),
			detailChallengeId: effectiveDetailId
		});
		syncDetailsChrome();
		void hydrateChallengeHeroImage(root);
		void hydrateChallengeHistoryThumbnails(root);

		for (const item of live) {
			const cid =
				item.latestConfig?.challenge_id != null
					? String(item.latestConfig.challenge_id).trim()
					: String(item.challengeId || '').trim();
			if (!cid) continue;
			const scope = resolveVoteChromeScope(root, cid);
			const peers = rankedSubmissionsForPeerVoting(
				item.rankedSubmissions || [],
				viewerId
			);
			syncVoteTabChrome(scope, peers, viewerId, item.phase);
		}

		if (!effectiveDetailId && focusChallengeId) {
			const card = root.querySelector(
				`.challenge-pane-active-card[data-challenge-id="${CSS.escape(focusChallengeId)}"]`
			);
			if (card instanceof HTMLElement) {
				card.classList.add('is-focused');
				try {
					card.scrollIntoView({ behavior: 'smooth', block: 'start' });
				} catch {
					card.scrollIntoView();
				}
			}
		}
	};

	const voteModal = createChallengeVoteModal({
		toggleReaction,
		onAfterVote: () => {
			if (detailChallengeId) {
				const item = findLiveItem(detailChallengeId);
				if (item) {
					syncVoteTabChrome(
						resolveVoteChromeScope(root, detailChallengeId),
						rankedSubmissionsForPeerVoting(item.rankedSubmissions || [], viewerId),
						viewerId,
						item.phase
					);
				}
				return;
			}
			for (const item of live) {
				const cid =
					item.latestConfig?.challenge_id != null
						? String(item.latestConfig.challenge_id).trim()
						: String(item.challengeId || '').trim();
				if (!cid) continue;
				syncVoteTabChrome(
					resolveVoteChromeScope(root, cid),
					rankedSubmissionsForPeerVoting(item.rankedSubmissions || [], viewerId),
					viewerId,
					item.phase
				);
			}
		}
	});

	const tryOpenVoteModalForChallenge = (challengeId) => {
		const item = findLiveItem(challengeId) || (live.length === 1 ? live[0] : null);
		if (!item) return false;
		if (!phaseUsesModalVoteOnly(item.phase)) return false;
		const peers = rankedSubmissionsForPeerVoting(item.rankedSubmissions || [], viewerId);
		const slides = buildVoteSlidesNewestFirst(peers);
		const challengeTitle = item.latestConfig
			? participantHeroViewModel(item.latestConfig, peers).title
			: '';
		voteModal.open(slides, {
			challengeTitle,
			track: pickChallengeTrack(item.latestConfig)
		});
		return true;
	};

	const captureSubmitContext = async (challengeId) => {
		const cid = String(challengeId || '').trim();
		const tid = Number(threadId);
		try {
			const mod = await import(`/shared/challengeSubmitContext.js${assetQuery()}`);
			mod.captureChallengeSubmitThread?.(tid, cid || undefined);
		} catch {
			// ignore
		}
	};

	render();

	const onRootClick = async (e) => {
		const voteOpen = e.target?.closest?.('[data-challenge-vote-open]');
		if (voteOpen instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const cid =
				voteOpen.getAttribute('data-challenge-id') ||
				voteOpen.closest?.('[data-challenge-id]')?.getAttribute('data-challenge-id') ||
				detailChallengeId ||
				'';
			tryOpenVoteModalForChallenge(cid);
			return;
		}

		const submitCta = e.target?.closest?.('[data-challenge-submit-cta]');
		if (submitCta instanceof HTMLElement) {
			const cid =
				submitCta.getAttribute('data-challenge-id') ||
				submitCta.closest?.('[data-challenge-id]')?.getAttribute('data-challenge-id') ||
				'';
			await captureSubmitContext(cid);
			return;
		}

		const tabBtn = e.target?.closest?.('[data-challenge-action-tab]');
		if (tabBtn instanceof HTMLButtonElement) {
			if (tabBtn.disabled) return;
			const id = tabBtn.getAttribute('data-challenge-action-tab');
			if (id !== 'submit' && id !== 'vote') return;
			const detailRoot = tabBtn.closest('[data-challenge-detail]') || tabBtn.closest('[data-challenge-id]') || root;
			for (const t of detailRoot.querySelectorAll('[data-challenge-action-tab]')) {
				if (!(t instanceof HTMLButtonElement)) continue;
				const tid = t.getAttribute('data-challenge-action-tab');
				const sel = tid === id;
				t.setAttribute('aria-selected', sel ? 'true' : 'false');
				t.classList.toggle('is-active', sel);
			}
			for (const p of detailRoot.querySelectorAll('[data-challenge-action-panel]')) {
				if (!(p instanceof HTMLElement)) continue;
				const pid = p.getAttribute('data-challenge-action-panel');
				const show = pid === id;
				p.hidden = !show;
				p.classList.toggle('is-active', show);
			}
		}
	};

	root.addEventListener('click', onRootClick);

	const voteIntent = consumeAutoOpenVoteIntentFromUrl();
	if (voteIntent.open) {
		tryOpenVoteModalForChallenge(voteIntent.challengeId || live[0]?.challengeId || '');
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
 * Prefer an explicit challengeId when provided; otherwise focus challenge.
 * @param {{
 *   messages: object[],
 *   viewerId: number | null,
 *   challengeId?: string | null,
 *   toggleReaction: (messageId: number, emojiKey: string, opts?: { op?: 'add' | 'remove' }) => Promise<{ ok?: boolean, data?: { added?: boolean } }>,
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
	const live = liveChallengeItems(model);
	const wantId = typeof opts?.challengeId === 'string' ? opts.challengeId.trim() : '';
	const item =
		(wantId
			? live.find((x) => {
					const id =
						x.latestConfig?.challenge_id != null
							? String(x.latestConfig.challenge_id).trim()
							: String(x.challengeId || '').trim();
					return id === wantId;
				})
			: null) ||
		live[0] ||
		null;

	const ranked =
		item?.rankedSubmissions || model.participant.rankedSubmissions || [];
	const phase = item?.phase || model.participant.phase;
	const rankedPeers = rankedSubmissionsForPeerVoting(ranked, viewerId);
	if (!phaseUsesModalVoteOnly(phase)) return false;
	const slides = buildVoteSlidesNewestFirst(rankedPeers);

	const challengeTitle = (item?.latestConfig || model.participant.latestConfig)
		? participantHeroViewModel(
				item?.latestConfig || model.participant.latestConfig,
				rankedPeers
			).title
		: '';
	const voteModal = createChallengeVoteModal({
		toggleReaction,
		onAfterVote: () => {
			if (typeof opts?.onAfterVote === 'function') {
				opts.onAfterVote();
			}
		}
	});
	const cfg = item?.latestConfig || model.participant.latestConfig;
	voteModal.open(slides, {
		challengeTitle,
		track: pickChallengeTrack(cfg)
	});
	return true;
}
