import { esc } from './htmlEscape.js';
import {
	challengeRewardPrefillsForOrganizerForm,
	isoToDatetimeLocalInput,
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl
} from '../challengeAdmin.js';

function renderDatetimeFieldsHtml(values) {
	const v = values || {};
	return `<div class="challenge-pane-admin-datetimes">
				<p class="challenge-pane-muted challenge-pane-admin-datetimes-label">Timeline (optional — stored from your local time)</p>
				<label class="challenge-pane-label">Submission opens
					<input type="datetime-local" name="submission_start_at" class="challenge-pane-input" value="${esc(v.submission_start_at || '')}" />
				</label>
				<label class="challenge-pane-label">Submission closes
					<input type="datetime-local" name="submission_end_at" class="challenge-pane-input" value="${esc(v.submission_end_at || '')}" />
				</label>
				<label class="challenge-pane-label">Voting opens
					<input type="datetime-local" name="voting_start_at" class="challenge-pane-input" value="${esc(v.voting_start_at || '')}" />
				</label>
				<label class="challenge-pane-label">Voting closes
					<input type="datetime-local" name="voting_end_at" class="challenge-pane-input" value="${esc(v.voting_end_at || '')}" />
				</label>
			</div>`;
}

/**
 * Pre-fill map for datetime-local inputs from stored challenge_config.
 * @param {object} cfg
 */
export function challengeConfigDatetimeLocals(cfg) {
	return {
		submission_start_at: isoToDatetimeLocalInput(
			pickChallengeConfigTimestamp(cfg, 'submission_start_at')
		),
		submission_end_at: isoToDatetimeLocalInput(
			pickChallengeConfigTimestamp(cfg, 'submission_end_at')
		),
		voting_start_at: isoToDatetimeLocalInput(pickChallengeConfigTimestamp(cfg, 'voting_start_at')),
		voting_end_at: isoToDatetimeLocalInput(pickChallengeConfigTimestamp(cfg, 'voting_end_at'))
	};
}

const MODAL_FORM_LEAD = `<p class="challenge-pane-muted challenge-pane-admin-lead challenge-pane-organizer-modal-lead">Uses JSON <code>challenge_config</code> on the thread. <strong>New challenge</strong> posts a message; <strong>save changes</strong> updates that challenge’s existing message.</p>`;

/**
 * @param {object} prefills — reward_* strings from {@link challengeRewardPrefillsForOrganizerForm}
 */
function renderOrganizerRewardsSection(prefills) {
	const p = prefills || {};
	const rf = esc(String(p.reward_first ?? ''));
	const rs = esc(String(p.reward_second ?? ''));
	const rt = esc(String(p.reward_third ?? ''));
	const rp = esc(String(p.reward_participation ?? ''));
	const rc = esc(String(p.reward_custom ?? ''));
	return `<div class="challenge-pane-admin-rewards-group" role="group" aria-label="Rewards">
			<p class="challenge-pane-admin-rewards-legend">Rewards</p>
			<p class="challenge-pane-muted challenge-pane-admin-rewards-lead">Optional placement prizes. Each filled row appears on the challenge card with a medal-style graphic. Leave blank to hide.</p>
			<label class="challenge-pane-label">1st place
				<input type="text" name="reward_first" class="challenge-pane-input" maxlength="400"
					placeholder="e.g. Featured spotlight + $50 credits" value="${rf}" autocomplete="off" />
			</label>
			<label class="challenge-pane-label">2nd place
				<input type="text" name="reward_second" class="challenge-pane-input" maxlength="400"
					placeholder="e.g. $25 credits" value="${rs}" autocomplete="off" />
			</label>
			<label class="challenge-pane-label">3rd place
				<input type="text" name="reward_third" class="challenge-pane-input" maxlength="400"
					placeholder="e.g. $10 credits" value="${rt}" autocomplete="off" />
			</label>
			<label class="challenge-pane-label">Participation
				<input type="text" name="reward_participation" class="challenge-pane-input" maxlength="400"
					placeholder="Everyone who enters — e.g. badge, wallpaper pack" value="${rp}" autocomplete="off" />
			</label>
			<label class="challenge-pane-label">Custom
				<input type="text" name="reward_custom" class="challenge-pane-input" maxlength="400"
					placeholder="Anything else — sponsor perk, raffle, honorable mention…" value="${rc}" autocomplete="off" />
			</label>
		</div>`;
}

/**
 * @param {object} latest — challenge_config payload
 * @param {number | null | undefined} configMessageId — chat message id to PATCH (organizer sidebar)
 */
export function renderChallengeOrganizerEditFormHtml(latest, configMessageId) {
	const cid =
		latest.challenge_id != null ? String(latest.challenge_id).trim() : '';
	const mid =
		typeof configMessageId === 'number' &&
			Number.isFinite(configMessageId) &&
			configMessageId > 0
			? configMessageId
			: null;
	const hiddenMsg =
		mid != null
			? `<input type="hidden" name="config_message_id" value="${esc(String(mid))}" />`
			: '';
	const title = typeof latest.title === 'string' ? latest.title : '';
	const details =
		latest.details == null
			? ''
			: typeof latest.details === 'string'
				? latest.details
				: String(latest.details);
	const rewardPrefills = challengeRewardPrefillsForOrganizerForm(latest);
	const dt = challengeConfigDatetimeLocals(latest);
	const heroUrl = pickChallengeHeroImageUrl(latest);

	return `<p class="challenge-pane-muted challenge-pane-admin-sublead">Challenge ID stays the same so submissions stay linked.</p>
		<form class="challenge-pane-admin-config-form" data-challenge-admin-config-form data-challenge-admin-form="edit">
			${hiddenMsg}
			<label class="challenge-pane-label">Challenge ID
				<input type="text" name="challenge_id" class="challenge-pane-input challenge-pane-admin-readonly" readonly
					value="${esc(cid)}" />
			</label>
			<label class="challenge-pane-label">Title
				<input type="text" name="title" class="challenge-pane-input" required maxlength="200" value="${esc(title)}" />
			</label>
			<label class="challenge-pane-label">Challenge image (optional)
				<input type="text" name="hero_image_url" class="challenge-pane-input" maxlength="2000"
					placeholder="/creations/123, share link, or image URL" autocomplete="off" value="${esc(heroUrl)}" />
			</label>
			<p class="challenge-pane-muted challenge-pane-organizer-image-hint">Creation detail link, Parascene share link, or direct image URL.</p>
			<label class="challenge-pane-label challenge-pane-organizer-details-field">Details
				<textarea name="details" class="challenge-pane-input challenge-pane-admin-textarea challenge-pane-organizer-details-textarea" rows="8" maxlength="8000" placeholder="Rules, theme, etc.">${esc(details)}</textarea>
			</label>
			${renderOrganizerRewardsSection(rewardPrefills)}
			${renderDatetimeFieldsHtml(dt)}
			<button type="submit" class="btn-primary challenge-pane-admin-submit">Save changes</button>
			<div class="challenge-pane-form-error challenge-pane-admin-error" data-challenge-admin-error hidden role="alert"></div>
		</form>`;
}

/**
 * @param {string} [submitLabel]
 */
export function renderChallengeOrganizerCreateFormHtml(
	submitLabel = 'Publish challenge'
) {
	return `<form class="challenge-pane-admin-config-form" data-challenge-admin-config-form data-challenge-admin-form="create">
			<label class="challenge-pane-label">Challenge ID
				<input type="text" name="challenge_id" class="challenge-pane-input" required
					maxlength="120" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
					title="Letters, numbers, dot, underscore, hyphen"
					placeholder="e.g. may-2026-portraits" autocomplete="off" />
			</label>
			<label class="challenge-pane-label">Title
				<input type="text" name="title" class="challenge-pane-input" required maxlength="200" placeholder="Challenge title" />
			</label>
			<label class="challenge-pane-label">Challenge image (optional)
				<input type="text" name="hero_image_url" class="challenge-pane-input" maxlength="2000"
					placeholder="/creations/123, share link, or image URL" autocomplete="off" />
			</label>
			<p class="challenge-pane-muted challenge-pane-organizer-image-hint">Creation detail link, Parascene share link, or direct image URL — same idea as chat.</p>
			<label class="challenge-pane-label challenge-pane-organizer-details-field">Details
				<textarea name="details" class="challenge-pane-input challenge-pane-admin-textarea challenge-pane-organizer-details-textarea" rows="8" maxlength="8000" placeholder="Rules, theme, etc."></textarea>
			</label>
			${renderOrganizerRewardsSection({})}
			${renderDatetimeFieldsHtml({})}
			<button type="submit" class="btn-primary challenge-pane-admin-submit">${esc(submitLabel)}</button>
			<div class="challenge-pane-form-error challenge-pane-admin-error" data-challenge-admin-error hidden role="alert"></div>
		</form>`;
}

/**
 * Edit + create forms (no outer chrome). Legacy composite for embeds/tests.
 * @param {{ latestConfig?: object | null }} vm
 */
export function renderChallengeOrganizerFormsHtml(vm) {
	const latest =
		vm.latestConfig && typeof vm.latestConfig === 'object' ? vm.latestConfig : null;

	let html = `<div class="challenge-pane-organizer-forms">${MODAL_FORM_LEAD}`;

	if (latest) {
		html += `<h4 class="challenge-pane-admin-subh">Edit current challenge</h4>`;
		html += renderChallengeOrganizerEditFormHtml(latest);
		html += `<div class="challenge-pane-admin-divider" role="presentation"></div>
			<h4 class="challenge-pane-admin-subh">Create new challenge</h4>`;
	}

	html += renderChallengeOrganizerCreateFormHtml(
		latest ? 'Publish new challenge' : 'Publish challenge'
	);
	html += `</div>`;

	return html;
}

/**
 * @param {{ challenge_id: string, title: string }[]} rows
 * @param {string} gearIconSvg — trusted markup from app icon helper
 */
export function renderChallengeOrganizerTableHtml(rows, gearIconSvg) {
	const bodyRows = (rows || [])
		.map((r) => {
			const title =
				r.title && String(r.title).trim()
					? esc(String(r.title).trim())
					: `<span class="challenge-pane-organizer-table-untitled">(untitled)</span>`;
			const cid = esc(r.challenge_id);
			return `<tr class="challenge-pane-organizer-table-row">
				<td class="challenge-pane-organizer-table-main">
					<div class="challenge-pane-organizer-table-title">${title}</div>
					<div class="challenge-pane-organizer-table-id">${cid}</div>
				</td>
				<td class="challenge-pane-organizer-table-actions">
					<button type="button" class="challenge-pane-organizer-gear" data-challenges-organizer-edit="${cid}"
						aria-label="Edit challenge">${gearIconSvg}</button>
				</td>
			</tr>`;
		})
		.join('');

	return `<div class="challenge-pane-organizer-table-wrap">
			<table class="challenge-pane-organizer-table">
				<thead>
					<tr>
						<th scope="col">Challenge</th>
						<th scope="col" class="challenge-pane-organizer-table-actions-head"><span class="challenge-pane-organizer-sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					${bodyRows}
					<tr class="challenge-pane-organizer-table-ghost" data-challenges-organizer-add-row tabindex="0" role="button">
						<td colspan="2" class="challenge-pane-organizer-table-ghost-cell">
							<span class="challenge-pane-organizer-table-ghost-label">Add challenge</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>`;
}

/**
 * @param {'create' | 'edit'} mode
 * @param {object | null} [editPayload] — challenge_config shape when mode is edit
 * @param {number | null | undefined} [configMessageId] — message row to update when editing
 */
export function renderChallengeOrganizerModalInnerHtml(mode, editPayload, configMessageId) {
	const lead = MODAL_FORM_LEAD;
	if (mode === 'edit' && editPayload && typeof editPayload === 'object') {
		return `${lead}${renderChallengeOrganizerEditFormHtml(editPayload, configMessageId)}`;
	}
	return `${lead}${renderChallengeOrganizerCreateFormHtml()}`;
}

function renderChallengeOrganizerModalHtml() {
	return `<div class="modal-overlay chat-page-chat-modal" data-challenges-organizer-modal aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="challenges-organizer-modal-title">
		<div class="modal modal-medium chat-page-chat-modal-panel chat-page-challenges-organizer-modal-panel">
			<div class="modal-header">
				<h3 id="challenges-organizer-modal-title" data-challenges-organizer-modal-title>New challenge</h3>
				<button type="button" class="modal-close chat-page-chat-modal-close" data-challenges-organizer-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
			</div>
			<div class="modal-body user-text challenge-pane-organizer-modal-body" data-challenges-organizer-modal-body></div>
		</div>
	</div>`;
}

/**
 * @param {{ rows: { challenge_id: string, title: string }[], gearIconSvg: string }} vm
 */
export function renderChallengeOrganizerSidebarMarkup(vm) {
	const rows = vm.rows || [];
	const gearSvg = vm.gearIconSvg || '';
	const table = renderChallengeOrganizerTableHtml(rows, gearSvg);
	const modal = renderChallengeOrganizerModalHtml();
	return `<div class="chat-page-challenges-organizer-sidebar-inner">
			<div class="chat-page-canvas-panel-body">
				<div class="chat-page-canvas-panel-head chat-page-challenges-organizer-head">
					<div class="chat-page-canvas-panel-title-row">
						<h2 class="chat-page-canvas-panel-title">Organizer</h2>
						<div class="chat-page-canvas-panel-head-actions">
							<button type="button" class="chat-page-canvas-close" data-chat-challenges-organizer-close
								aria-label="Close organizer tools">×</button>
						</div>
					</div>
				</div>
				<div class="chat-page-canvas-panel-scroll">
					<div class="challenge-pane-organizer-sidebar-body user-text">${table}</div>
				</div>
			</div>
			${modal}
		</div>`;
}
