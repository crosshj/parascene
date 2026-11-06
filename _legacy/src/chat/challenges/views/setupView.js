import { challengePhaseDisplayLabel } from '../model/phases.js';
import { esc } from '../constants.js';

function bucketTitle(label, count) {
	return `<h4 class="challenge-pane-setup-bucket-title">${esc(label)} <span class="challenge-pane-setup-count">(${count})</span></h4>`;
}

function rowTitle(payload) {
	const t =
		typeof payload?.title === 'string' && payload.title.trim()
			? payload.title.trim()
			: payload?.challenge_id != null
				? `Challenge ${String(payload.challenge_id).trim()}`
				: 'Challenge';
	return esc(t);
}

/**
 * Organizer / timeline strip: past (results), current (active phases), upcoming (pre-submit).
 * @param {{ past: object[], current: object[], upcoming: object[] }} setup
 */
export function renderSetupSection(setup) {
	const { past, current, upcoming } = setup;
	const total = past.length + current.length + upcoming.length;
	if (!total) return '';

	let html = `<section class="challenge-pane-section challenge-pane-setup" aria-label="Challenge timeline">
		<h3 class="challenge-pane-section-label">Challenges</h3>`;

	html += `<div class="challenge-pane-setup-grid">`;

	html += `<div class="challenge-pane-setup-col">${bucketTitle('Past', past.length)}`;
	if (!past.length) {
		html += `<p class="challenge-pane-muted challenge-pane-setup-empty">None completed yet.</p>`;
	} else {
		html += `<ul class="challenge-pane-setup-list">`;
		for (const row of past) {
			html += `<li class="challenge-pane-setup-item"><span class="challenge-pane-setup-item-title">${rowTitle(row.payload)}</span> <span class="challenge-pane-phase-badge challenge-pane-phase-badge--results">${esc(challengePhaseDisplayLabel(row.phase))}</span></li>`;
		}
		html += `</ul>`;
	}
	html += `</div>`;

	html += `<div class="challenge-pane-setup-col">${bucketTitle('Current', current.length)}`;
	if (!current.length) {
		html += `<p class="challenge-pane-muted challenge-pane-setup-empty">None active.</p>`;
	} else {
		html += `<ul class="challenge-pane-setup-list">`;
		for (const row of current) {
			html += `<li class="challenge-pane-setup-item"><span class="challenge-pane-setup-item-title">${rowTitle(row.payload)}</span> <span class="challenge-pane-phase-badge challenge-pane-phase-badge--${esc(row.phase)}">${esc(challengePhaseDisplayLabel(row.phase))}</span></li>`;
		}
		html += `</ul>`;
	}
	html += `</div>`;

	html += `<div class="challenge-pane-setup-col">${bucketTitle('Upcoming', upcoming.length)}`;
	if (!upcoming.length) {
		html += `<p class="challenge-pane-muted challenge-pane-setup-empty">Nothing scheduled.</p>`;
	} else {
		html += `<ul class="challenge-pane-setup-list">`;
		for (const row of upcoming) {
			html += `<li class="challenge-pane-setup-item"><span class="challenge-pane-setup-item-title">${rowTitle(row.payload)}</span> <span class="challenge-pane-phase-badge challenge-pane-phase-badge--pre_submit">${esc(row.phase)}</span></li>`;
		}
		html += `</ul>`;
	}
	html += `</div>`;

	html += `</div></section>`;
	return html;
}
