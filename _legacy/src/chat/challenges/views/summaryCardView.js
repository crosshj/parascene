import { esc } from '../constants.js';
import { challengePhaseDisplayLabel } from '../model/phases.js';
import { CHALLENGE_TRACK_LABELS, pickChallengeTrack } from '../model/tracks.js';
import { rankedSubmissionsForPeerVoting } from '../model/participantSlice.js';
import { participantHeroViewModel } from './presentParticipantHero.js';
import { renderChallengeCountdowns } from './countdownView.js';
import { pickChallengeHeroImageUrl, pickChallengeHeroPreviewUrl } from '../challengeAdmin.js';

/**
 * Compact summary card for the /challenges board (one per active challenge).
 *
 * @param {{
 *   challengeId: string,
 *   latestConfig: object,
 *   phase: string,
 *   rankedSubmissions: object[],
 *   viewerId: number | null,
 *   nowMs: number
 * }} item
 */
export function renderChallengeSummaryCard(item) {
	const challengeId = String(item.challengeId || '').trim();
	const cfg = item.latestConfig || {};
	const phase = String(item.phase || '');
	const ranked = Array.isArray(item.rankedSubmissions) ? item.rankedSubmissions : [];
	const heroVm = participantHeroViewModel(cfg, ranked);
	const track = pickChallengeTrack(cfg);
	const trackLabel = CHALLENGE_TRACK_LABELS[track] || 'Challenge';
	const phaseLabel = challengePhaseDisplayLabel(phase);
	const countdownHtml = renderChallengeCountdowns(cfg, phase, item.nowMs);
	const heroRef = pickChallengeHeroImageUrl(cfg) || '';
	const heroPreview = pickChallengeHeroPreviewUrl(cfg);
	const previewAttr = heroPreview ? ` data-challenge-hero-preview-url="${esc(heroPreview)}"` : '';
	const peerRanked = rankedSubmissionsForPeerVoting(ranked, item.viewerId ?? null);
	const canVote = (phase === 'voting' || phase === 'submit_and_vote') && peerRanked.length > 0;
	const canSubmit = phase === 'submitting' || phase === 'submit_and_vote';
	const stats = Array.isArray(heroVm.stats) ? heroVm.stats : [];
	const statsLine = stats
		.map((s) => `${s.value} ${s.label}`)
		.filter(Boolean)
		.join(' · ');

	const thumb = heroRef
		? `<div class="challenge-pane-summary-thumb challenge-pane-hero-image-wrap challenge-pane-hero-image-wrap--pending" data-challenge-hero-pending data-challenge-hero-ref="${esc(heroRef)}" data-challenge-id="${esc(challengeId)}"${previewAttr}>
			<span class="challenge-pane-hero-image-placeholder" data-challenge-hero-placeholder aria-hidden="true"></span>
			<img class="challenge-pane-summary-thumb-img" data-challenge-hero-img alt="" hidden loading="lazy" decoding="async" />
			<span class="challenge-pane-hero-image-fallback" data-challenge-hero-fallback hidden></span>
		</div>`
		: `<div class="challenge-pane-summary-thumb challenge-pane-summary-thumb--empty" aria-hidden="true"></div>`;

	const voteBtn = canVote
		? `<button type="button" class="challenge-pane-summary-action challenge-pane-summary-action--primary" data-challenge-vote-open data-challenge-id="${esc(challengeId)}">
			<span class="challenge-pane-vote-open-inner">
				<span>Vote</span>
				<span class="challenge-pane-vote-tab-badge" hidden data-challenge-vote-tab-badge aria-hidden="true"></span>
			</span>
		</button>`
		: '';
	const submitBtn = canSubmit
		? `<a class="challenge-pane-summary-action${canVote ? '' : ' challenge-pane-summary-action--primary'}" href="/create" data-challenge-submit-cta data-challenge-id="${esc(challengeId)}">Submit</a>`
		: '';

	return `<article class="challenge-pane-summary-card" data-challenge-id="${esc(challengeId)}" data-challenge-summary-open="${esc(challengeId)}" role="button" tabindex="0">
		${thumb}
		<div class="challenge-pane-summary-body">
			<div class="challenge-pane-summary-head">
				<span class="challenge-track-pill challenge-track-pill--${esc(track)}">${esc(trackLabel)}</span>
				<span class="challenge-pane-summary-phase">${esc(phaseLabel)}</span>
			</div>
			<h3 class="challenge-pane-summary-title">${esc(heroVm.title)}</h3>
			${countdownHtml ? `<div class="challenge-pane-summary-countdown">${countdownHtml}</div>` : ''}
			${statsLine ? `<p class="challenge-pane-summary-stats">${esc(statsLine)}</p>` : ''}
			<div class="challenge-pane-summary-actions" data-challenge-summary-actions>
				${voteBtn}
				${submitBtn}
				<span class="challenge-pane-summary-open-hint">Details</span>
			</div>
		</div>
	</article>`;
}

/**
 * @param {object[]} liveItems — active challenge items from the model
 * @param {{ viewerId: number | null, nowMs: number }} opts
 */
export function renderChallengeSummaryBoard(liveItems, opts) {
	const items = Array.isArray(liveItems) ? liveItems : [];
	if (!items.length) return '';
	const cards = items
		.map((item) => {
			const challengeId =
				item.latestConfig?.challenge_id != null
					? String(item.latestConfig.challenge_id).trim()
					: String(item.challengeId || '').trim();
			return renderChallengeSummaryCard({
				challengeId,
				latestConfig: item.latestConfig,
				phase: item.phase,
				rankedSubmissions: item.rankedSubmissions || [],
				viewerId: opts.viewerId ?? null,
				nowMs: opts.nowMs || Date.now()
			});
		})
		.join('');
	return `<div class="challenge-pane-summary-board" data-challenge-summary-board>${cards}</div>`;
}
