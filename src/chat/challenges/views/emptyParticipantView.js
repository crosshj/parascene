import { esc } from '../constants.js';
import { summarizeLatestChallengeConfigs } from '../model/organizerSummaries.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl
} from '../challengeAdmin.js';
import { deriveChallengePhase } from '../model/phases.js';
import { ACTIVE_PARTICIPANT_PHASES } from '../model/participantSlice.js';
import { parseHeroCreationOrShareRef } from '../../../shared/userText.js';
import { renderChallengeHistoryThumbWrapHtml } from '../../../shared/challengeHistoryThumb.js';

/**
 * @param {string} raw results_creation_url value
 * @returns {string | null} in-app navigation href
 */
function resolveChallengeResultsNavigationHref(raw) {
	const cref = parseHeroCreationOrShareRef(raw);
	if (cref?.kind === 'creation') {
		return `/creations/${encodeURIComponent(String(cref.creationId))}`;
	}
	return null;
}

/**
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {object} summaryPayload
 * @param {string} challengeId
 */
function effectiveChallengePayload(configEntries, summaryPayload, challengeId) {
	const merged = mergeFullChallengeConfigForChallenge(configEntries, challengeId);
	return { ...summaryPayload, ...merged };
}

/**
 * @param {object} payload merged challenge_config
 * @param {number} nowMs
 * @returns {{ stateLabel: string, stateClass: string, resultsHref: string | null }}
 */
function challengeHistoryCardMeta(payload, nowMs) {
	const phase = deriveChallengePhase(payload, nowMs);
	const resultsHref = resolveChallengeResultsNavigationHref(
		typeof payload.results_creation_url === 'string' ? payload.results_creation_url : ''
	);
	if (phase === 'results' && resultsHref) {
		return { stateLabel: 'View results', stateClass: 'results', resultsHref };
	}
	if (phase === 'results') {
		return { stateLabel: 'Winners announced', stateClass: 'results', resultsHref: null };
	}
	if (phase === 'finalizing') {
		return { stateLabel: 'Finalizing', stateClass: 'finalizing', resultsHref: null };
	}
	if (phase === 'submit_and_vote' || phase === 'submitting') {
		return { stateLabel: 'Open', stateClass: 'active', resultsHref: null };
	}
	if (phase === 'voting') {
		return { stateLabel: 'Voting', stateClass: 'active', resultsHref: null };
	}
	if (phase === 'between') {
		return { stateLabel: 'Between rounds', stateClass: 'between', resultsHref: null };
	}
	return { stateLabel: 'Ended', stateClass: 'ended', resultsHref: null };
}

function renderChallengeHistoryCardInner({
	title,
	activeRange,
	heroRef,
	challengeId,
	stateLabel,
	stateClass
}) {
	return `${renderChallengeHistoryThumbWrapHtml(heroRef, challengeId, esc)}
				<div class="challenge-pane-history-card-content">
					<h3 class="challenge-pane-history-card-title">${esc(title)}</h3>
					<p class="challenge-pane-history-card-range">${esc(activeRange)}</p>
				</div>
				<div class="challenge-pane-history-card-state challenge-pane-history-card-state--${esc(stateClass)}" aria-label="Challenge state">${esc(stateLabel)}</div>`;
}

function formatShortDateTime(isoLike) {
	const raw = typeof isoLike === 'string' ? isoLike.trim() : '';
	if (!raw) return '';
	const parsed = Date.parse(raw);
	if (!Number.isFinite(parsed)) return '';
	return new Date(parsed).toLocaleString([], {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

function challengeActiveRangeLabel(payload) {
	const start = pickChallengeConfigTimestamp(payload, 'submission_start_at');
	const end = pickChallengeConfigTimestamp(payload, 'voting_end_at');
	const startLabel = formatShortDateTime(start);
	const endLabel = formatShortDateTime(end);
	if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
	if (startLabel) return `Started ${startLabel}`;
	if (endLabel) return `Ended ${endLabel}`;
	return 'Schedule unavailable';
}

function challengeHistoryThumbnailRef(payload) {
	return pickChallengeHeroImageUrl(payload);
}


function challengeStartsAtMs(payload) {
	const start = pickChallengeConfigTimestamp(payload, 'submission_start_at');
	const ms = Date.parse(String(start || '').trim());
	return Number.isFinite(ms) ? ms : null;
}

function pickNextChallengeSummary(configs = [], opts = {}) {
	const excludeChallengeId =
		typeof opts.excludeChallengeId === 'string' ? opts.excludeChallengeId.trim() : '';
	const upcoming = summarizeLatestChallengeConfigs(configs).filter((s) => {
		const cid = typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		if (excludeChallengeId && cid === excludeChallengeId) return false;
		const phase = deriveChallengePhase(s.payload, Date.now());
		return phase === 'pre_submit';
	});
	if (!upcoming.length) return null;
	upcoming.sort((a, b) => {
		const aStart = challengeStartsAtMs(a.payload);
		const bStart = challengeStartsAtMs(b.payload);
		if (aStart == null && bStart == null) return b.sortKey - a.sortKey;
		if (aStart == null) return 1;
		if (bStart == null) return -1;
		return aStart - bStart;
	});
	return upcoming[0] || null;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 * @param {{ excludeChallengeId?: string }} [opts]
 */
function renderChallengeHistoryCards(configs = [], opts = {}) {
	const excludeChallengeId =
		typeof opts.excludeChallengeId === 'string' ? opts.excludeChallengeId.trim() : '';
	const summaries = summarizeLatestChallengeConfigs(configs).filter((s) => {
		const cid = typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		if (excludeChallengeId) return cid !== excludeChallengeId;
		return true;
	}).filter((s) => {
		const challengeId =
			typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		const effectivePayload = effectiveChallengePayload(configs, s.payload, challengeId);
		const phase = deriveChallengePhase(effectivePayload, Date.now());
		if (phase === 'pre_submit') return false;
		if (ACTIVE_PARTICIPANT_PHASES.has(phase)) return false;
		return true;
	}).sort((a, b) => {
		const aPayload = effectiveChallengePayload(configs, a.payload, a.challenge_id);
		const bPayload = effectiveChallengePayload(configs, b.payload, b.challenge_id);
		const aEnd = Date.parse(String(pickChallengeConfigTimestamp(aPayload, 'voting_end_at') || ''));
		const bEnd = Date.parse(String(pickChallengeConfigTimestamp(bPayload, 'voting_end_at') || ''));
		if (!Number.isFinite(aEnd) && !Number.isFinite(bEnd)) return b.sortKey - a.sortKey;
		if (!Number.isFinite(aEnd)) return 1;
		if (!Number.isFinite(bEnd)) return -1;
		return bEnd - aEnd;
	});
	if (!summaries.length) {
		return `<p class="challenge-pane-muted">No challenges have been posted yet.</p>`;
	}
	const cards = summaries
		.map((summary) => {
			const title = summary.title && summary.title.trim()
				? summary.title.trim()
				: `Challenge ${summary.challenge_id}`;
			const challengeId =
				typeof summary.challenge_id === 'string' ? summary.challenge_id.trim() : '';
			const effectivePayload = effectiveChallengePayload(configs, summary.payload, challengeId);
			const activeRange = challengeActiveRangeLabel(effectivePayload);
			const heroRef = challengeHistoryThumbnailRef(effectivePayload);
			const { stateLabel, stateClass, resultsHref } = challengeHistoryCardMeta(
				effectivePayload,
				Date.now()
			);
			const inner = renderChallengeHistoryCardInner({
				title,
				activeRange,
				heroRef,
				challengeId,
				stateLabel,
				stateClass
			});
			if (resultsHref) {
				return `<li class="challenge-pane-card challenge-pane-history-card challenge-pane-history-card--has-link">
				<a class="challenge-pane-history-card-link" href="${esc(resultsHref)}">${inner}</a>
			</li>`;
			}
			return `<li class="challenge-pane-card challenge-pane-history-card">${inner}</li>`;
		})
		.join('');
	return `<ul class="challenge-pane-history-list">${cards}</ul>`;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 * @param {{ excludeChallengeId?: string }} [opts]
 */
export function renderNextChallengeSection(configs = [], opts = {}) {
	const summary = pickNextChallengeSummary(configs, opts);
	if (!summary) return '';
	const title = summary.title && summary.title.trim()
		? summary.title.trim()
		: `Challenge ${summary.challenge_id}`;
	const challengeId =
		typeof summary.challenge_id === 'string' ? summary.challenge_id.trim() : '';
	const effectivePayload = effectiveChallengePayload(configs, summary.payload, challengeId);
	const activeRange = challengeActiveRangeLabel(effectivePayload);
	const heroRef = challengeHistoryThumbnailRef(effectivePayload);
	return `<section class="challenge-pane-section challenge-pane-next-section">
			<h3 class="challenge-pane-section-label">Next challenge</h3>
			<ul class="challenge-pane-history-list">
				<li class="challenge-pane-card challenge-pane-history-card">
					${renderChallengeHistoryThumbWrapHtml(heroRef, challengeId, esc)}
					<div class="challenge-pane-history-card-content">
						<h3 class="challenge-pane-history-card-title">${esc(title)}</h3>
						<p class="challenge-pane-history-card-range">${esc(activeRange)}</p>
					</div>
					<div class="challenge-pane-history-card-state challenge-pane-history-card-state--upcoming" aria-label="Challenge state">Upcoming</div>
				</li>
			</ul>
		</section>`;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 * @param {{ excludeChallengeId?: string }} [opts]
 */
export function renderPastChallengesSection(configs = [], opts = {}) {
	const listHtml = renderChallengeHistoryCards(configs, opts);
	return `<section class="challenge-pane-section challenge-pane-history-section">
			<h3 class="challenge-pane-section-label">Previous challenges</h3>
			${listHtml}
		</section>`;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 */
export function renderEmptyParticipantPane(configs = []) {
	return `<div class="challenge-pane-empty route-empty-image-grid">
			<section class="challenge-pane-section challenge-pane-inactive-note" aria-label="No active challenge">
				<h2 class="challenge-pane-inactive-note-title">No active challenge right now</h2>
				<p class="challenge-pane-inactive-note-text">There is currently no active challenge. Review previous challenges below — published results open your highlights creation when configured.</p>
			</section>
			${renderNextChallengeSection(configs)}
			${renderPastChallengesSection(configs)}
		</div>`;
}
