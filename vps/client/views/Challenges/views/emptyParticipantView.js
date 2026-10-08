import { esc } from '../../../shared/challenges/constants.js';
import { summarizeLatestChallengeConfigs } from '../../../shared/challenges/model/organizerSummaries.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl,
	isChallengeListedForUpcoming
} from '../../../shared/challenges/challengeAdmin.js';
import { deriveChallengePhase } from '../../../shared/challenges/model/phases.js';
import { ACTIVE_PARTICIPANT_PHASES } from '../../../shared/challenges/model/participantSlice.js';
import { renderChallengeHistoryThumbWrapHtml } from '../../../shared/challengeHistoryThumb.js';
import { challengesDetailsHref } from '../../../shared/challenges/model/detailsRoute.js';

/**
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {object} summaryPayload
 * @param {string} challengeId
 */
function effectiveChallengePayload(configEntries, summaryPayload, challengeId) {
	const merged = mergeFullChallengeConfigForChallenge(configEntries, challengeId);
	return { ...summaryPayload, ...merged };
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

function challengeEndsAtMs(payload) {
	const end =
		pickChallengeConfigTimestamp(payload, 'voting_end_at') ||
		pickChallengeConfigTimestamp(payload, 'submission_end_at');
	const ms = Date.parse(String(end || '').trim());
	return Number.isFinite(ms) ? ms : null;
}

function pickNextChallengeSummary(configs = [], opts = {}) {
	const excludeIds = new Set();
	if (typeof opts.excludeChallengeId === 'string' && opts.excludeChallengeId.trim()) {
		excludeIds.add(opts.excludeChallengeId.trim());
	}
	if (Array.isArray(opts.excludeChallengeIds)) {
		for (const id of opts.excludeChallengeIds) {
			const s = String(id || '').trim();
			if (s) excludeIds.add(s);
		}
	}
	const upcoming = summarizeLatestChallengeConfigs(configs).filter((s) => {
		const cid = typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		if (excludeIds.has(cid)) return false;
		const phase = deriveChallengePhase(s.payload, Date.now());
		if (phase !== 'pre_submit') return false;
		return isChallengeListedForUpcoming(s.payload);
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
 * Older is the challenge that finishes sooner. Newer is the one that finishes later.
 * Overlapping ranges stay in that line, so walking newer from the oldest reaches every stop.
 * Deleted, purged, and unlisted drafts are not stops on this path.
 * @param {{ msg: object, payload: object }[]} configs
 * @param {string} challengeId
 * @param {number} [nowMs]
 * @returns {{ previous: { challengeId: string, title: string } | null, next: { challengeId: string, title: string } | null }}
 */
export function challengeDetailNeighbors(configs, challengeId, nowMs = Date.now()) {
	const current = String(challengeId || '').trim();
	const rows = summarizeLatestChallengeConfigs(configs).map((summary) => {
		const id = String(summary.challenge_id || '').trim();
		const payload = effectiveChallengePayload(configs, summary.payload, id);
		return {
			challengeId: id,
			title: summary.title && summary.title.trim() ? summary.title.trim() : `Challenge ${id}`,
			phase: deriveChallengePhase(payload, nowMs),
			payload,
			startMs: challengeStartsAtMs(payload),
			endMs: challengeEndsAtMs(payload),
			sortKey: summary.sortKey
		};
	}).filter((row) => row.challengeId);
	const available = (row) => {
		if (row.phase === 'deleted' || row.phase === 'purged') return false;
		// Unlisted only hides a draft that has not started. Once a challenge is on the
		// main page — active, or already in the previous list — it stays a stop.
		if (row.phase === 'pre_submit' && !isChallengeListedForUpcoming(row.payload)) return false;
		return true;
	};
	const timeOrLast = (ms) => (ms == null ? Number.POSITIVE_INFINITY : ms);
	const byTime = (a, b) => {
		const endDelta = timeOrLast(a.endMs) - timeOrLast(b.endMs);
		if (endDelta !== 0) return endDelta;
		const startDelta = timeOrLast(a.startMs) - timeOrLast(b.startMs);
		if (startDelta !== 0) return startDelta;
		return a.sortKey - b.sortKey;
	};
	const visible = rows.filter(available).sort(byTime);
	let index = visible.findIndex((row) => row.challengeId === current);
	let sequence = visible;
	if (index < 0) {
		const self = rows.find((row) => row.challengeId === current);
		if (!self) return { previous: null, next: null };
		sequence = [...visible, self].sort(byTime);
		index = sequence.findIndex((row) => row.challengeId === current);
	}
	const stop = (row) => row ? { challengeId: row.challengeId, title: row.title } : null;
	return {
		previous: stop(sequence[index - 1]),
		next: stop(sequence[index + 1])
	};
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 * @param {{ excludeChallengeId?: string, excludeChallengeIds?: string[] }} [opts]
 */
function renderChallengeHistoryCards(configs = [], opts = {}) {
	const excludeIds = new Set();
	if (typeof opts.excludeChallengeId === 'string' && opts.excludeChallengeId.trim()) {
		excludeIds.add(opts.excludeChallengeId.trim());
	}
	if (Array.isArray(opts.excludeChallengeIds)) {
		for (const id of opts.excludeChallengeIds) {
			const s = String(id || '').trim();
			if (s) excludeIds.add(s);
		}
	}
	const summaries = summarizeLatestChallengeConfigs(configs).filter((s) => {
		const cid = typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		if (excludeIds.has(cid)) return false;
		return true;
	}).filter((s) => {
		const challengeId =
			typeof s.challenge_id === 'string' ? s.challenge_id.trim() : '';
		const effectivePayload = effectiveChallengePayload(configs, s.payload, challengeId);
		const phase = deriveChallengePhase(effectivePayload, Date.now());
		if (phase === 'pre_submit' || phase === 'deleted' || phase === 'purged') return false;
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
		return `<div class="route-empty challenge-entries-empty" data-challenge-past-empty>
			<div class="route-empty-title">No previous challenges</div>
		</div>`;
	}
	const cards = summaries
		.map((summary) => {
			const title = summary.title && summary.title.trim()
				? summary.title.trim()
				: `Challenge ${summary.challenge_id}`;
			const challengeId =
				typeof summary.challenge_id === 'string' ? summary.challenge_id.trim() : '';
			const effectivePayload = effectiveChallengePayload(configs, summary.payload, challengeId);
			const heroRef = challengeHistoryThumbnailRef(effectivePayload);
			if (!challengeId) return '';
			return `<a class="challenge-entry-card-link" href="${esc(challengesDetailsHref(challengeId))}" data-spa-link data-challenge-past-card data-challenge-id="${esc(challengeId)}">
				<div class="feed-card feed-card--image-only creation-grid__card" aria-hidden="true">
					<div class="feed-card-image">${renderChallengeHistoryThumbWrapHtml(heroRef, challengeId, esc)}</div>
				</div>
				<span class="challenge-card-kind-bar"><span class="challenge-card-kind-label"><span class="challenge-card-kind-rank">${esc(title)}</span></span></span>
			</a>`;
		})
		.join('');
	return `<div class="route-cards content-cards-image-grid creation-browse-grid challenge-entry-grid challenge-past-grid">${cards}</div>`;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 * @param {{ excludeChallengeId?: string, excludeChallengeIds?: string[] }} [opts]
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
 * @param {{ excludeChallengeId?: string, excludeChallengeIds?: string[] }} [opts]
 */
export function renderPastChallengesSection(configs = [], opts = {}) {
	const gridHtml = renderChallengeHistoryCards(configs, opts);
	return `<section class="creation-browse challenge-past-lane" data-challenge-past>
			<div class="challenge-pane-entries-head">
				<h3 class="challenge-pane-section-label">Previous challenges</h3>
			</div>
			${gridHtml}
		</section>`;
}

/**
 * @param {{ msg: object, payload: object }[]} [configs]
 */
export function renderEmptyParticipantPane(configs = []) {
	return `<div class="challenge-pane-empty route-empty-image-grid">
			<section class="challenge-pane-section challenge-pane-inactive-note" aria-label="No active challenge">
				<h2 class="challenge-pane-inactive-note-title">No active challenge right now</h2>
				<p class="challenge-pane-inactive-note-text">There is currently no active challenge. Open a previous challenge to see its entries and posts.</p>
			</section>
			${renderNextChallengeSection(configs)}
		</div>`;
}
