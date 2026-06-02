import { esc } from '../constants.js';
import { summarizeLatestChallengeConfigs } from '../model/organizerSummaries.js';
import { pickChallengeConfigTimestamp, pickChallengeHeroImageUrl } from '../challengeAdmin.js';
import { deriveChallengePhase } from '../model/phases.js';

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
	const fromPrimary = pickChallengeHeroImageUrl(payload);
	if (fromPrimary) return fromPrimary;
	const p = payload && typeof payload === 'object' ? payload : {};
	const candidates = [
		p.hero_image,
		p.hero_media_url,
		p.hero_media,
		p.hero_ref,
		p.hero_url,
		p.cover,
		p.cover_url,
		p.cover_image,
		p.image,
		p.image_ref,
		p.image_path,
		p.thumbnail_url,
		p.creation_url
	];
	for (const raw of candidates) {
		const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (value) return value;
	}
	return '';
}

function challengeHistoryStateLabel(payload) {
	const phase = deriveChallengePhase(payload, Date.now());
	if (phase === 'finalizing') return 'Finalizing';
	return 'Ended';
}

function challengeStateClassFromLabel(label) {
	const raw = typeof label === 'string' ? label.trim().toLowerCase() : '';
	if (raw === 'upcoming') return 'upcoming';
	if (raw === 'finalizing') return 'finalizing';
	return 'ended';
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
		if (!excludeChallengeId) return true;
		return cid !== excludeChallengeId;
	}).filter((s) => {
		const phase = deriveChallengePhase(s.payload, Date.now());
		return phase !== 'pre_submit';
	});
	if (!summaries.length) {
		return `<p class="challenge-pane-muted">No challenges have been posted yet.</p>`;
	}
	const cards = summaries
		.map((summary) => {
			const title = summary.title && summary.title.trim()
				? summary.title.trim()
				: `Challenge ${summary.challenge_id}`;
			const activeRange = challengeActiveRangeLabel(summary.payload);
			const heroRef = challengeHistoryThumbnailRef(summary.payload);
			const stateLabel = challengeHistoryStateLabel(summary.payload);
			const stateClass = challengeStateClassFromLabel(stateLabel);
			return `<li class="challenge-pane-card challenge-pane-history-card">
				<div class="challenge-pane-history-card-thumb-wrap" data-challenge-history-thumb-pending data-challenge-history-thumb-ref="${esc(heroRef)}">
					<img class="challenge-pane-history-card-thumb" alt="" loading="lazy" hidden data-challenge-history-thumb-img />
					<div class="challenge-pane-history-card-thumb-fallback" aria-hidden="true" data-challenge-history-thumb-fallback></div>
				</div>
				<div class="challenge-pane-history-card-content">
					<h3 class="challenge-pane-history-card-title">${esc(title)}</h3>
					<p class="challenge-pane-history-card-range">${esc(activeRange)}</p>
				</div>
				<div class="challenge-pane-history-card-state challenge-pane-history-card-state--${esc(stateClass)}" aria-label="Challenge state">${esc(stateLabel)}</div>
			</li>`;
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
	const activeRange = challengeActiveRangeLabel(summary.payload);
	const heroRef = challengeHistoryThumbnailRef(summary.payload);
	return `<section class="challenge-pane-section challenge-pane-next-section">
			<h3 class="challenge-pane-section-label">Next challenge</h3>
			<ul class="challenge-pane-history-list">
				<li class="challenge-pane-card challenge-pane-history-card">
					<div class="challenge-pane-history-card-thumb-wrap" data-challenge-history-thumb-pending data-challenge-history-thumb-ref="${esc(heroRef)}">
						<img class="challenge-pane-history-card-thumb" alt="" loading="lazy" hidden data-challenge-history-thumb-img />
						<div class="challenge-pane-history-card-thumb-fallback" aria-hidden="true" data-challenge-history-thumb-fallback></div>
					</div>
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
				<p class="challenge-pane-inactive-note-text">There is currently no active challenge. Review previous challenges below and check back for upcoming challenges.</p>
			</section>
			${renderNextChallengeSection(configs)}
			${renderPastChallengesSection(configs)}
		</div>`;
}
