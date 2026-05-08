import { esc } from '../constants.js';
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
 * @param {{ gearIconSvg: string, statsIconSvg: string, plusIconSvg: string }} icons — trusted markup from app icon helpers
 */
export function renderChallengeOrganizerTableHtml(rows, icons) {
	const gearIconSvg = icons?.gearIconSvg || '';
	const statsIconSvg = icons?.statsIconSvg || '';
	const plusIconSvg = icons?.plusIconSvg || '';
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
					<div class="challenge-pane-organizer-table-actions-inner">
						<button type="button" class="challenge-pane-organizer-stats-trigger" data-challenges-organizer-stats="${cid}"
							aria-label="View challenge stats">${statsIconSvg}</button>
						<button type="button" class="challenge-pane-organizer-gear" data-challenges-organizer-edit="${cid}"
							aria-label="Edit challenge">${gearIconSvg}</button>
					</div>
				</td>
			</tr>`;
		})
		.join('');

	return `<div class="challenge-pane-organizer-table-shell">
			<div class="challenge-pane-organizer-table-wrap">
				<table class="challenge-pane-organizer-table">
					<thead>
						<tr>
							<th scope="col">Challenge</th>
							<th scope="col" class="challenge-pane-organizer-table-actions-head"><span class="challenge-pane-organizer-sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						${bodyRows}
					</tbody>
				</table>
			</div>
			<div class="challenge-pane-organizer-add-strip" data-challenges-organizer-add-row tabindex="0" role="button">
				<span class="challenge-pane-organizer-add-strip-inner">
					<span class="challenge-pane-organizer-add-strip-plus" aria-hidden="true">${plusIconSvg}</span>
					<span class="challenge-pane-organizer-add-strip-label">Add challenge</span>
				</span>
			</div>
		</div>`;
}

/**
 * @param {{
 *   challengeTitle?: string,
 *   topCreations?: {
 *     creationId: number | null,
 *     messageId: number | null,
 *     voteValue: number,
 *     voteCount: number,
 *     creatorUserId: number | null,
 *     creatorUserName: string | null,
 *   }[],
 *   topSubmitters?: { userId: number, submissionCount: number, userName: string | null }[],
 *   topVoters?: { userId: number, voteCount: number, userName: string | null }[],
 *   excludedUserNames?: string[],
 *   loading?: boolean,
 *   error?: string | null,
 * }} vm
 */
export function renderChallengeOrganizerStatsModalInnerHtml(vm) {
	const loading = vm?.loading === true;
	const error = typeof vm?.error === 'string' ? vm.error.trim() : '';
	if (loading) {
		return `<p class="challenge-pane-muted">Loading stats…</p>`;
	}
	if (error) {
		return `<p class="challenge-pane-form-error challenge-pane-organizer-stats-error" role="alert">${esc(error)}</p>`;
	}
	const challengeTitle =
		typeof vm?.challengeTitle === 'string' && vm.challengeTitle.trim()
			? vm.challengeTitle.trim()
			: 'Challenge';
	const excludedUserNames = Array.isArray(vm?.excludedUserNames)
		? vm.excludedUserNames
		: [];
	const excludedSet = new Set(
		excludedUserNames
			.map((name) => String(name || '').trim().replace(/^@+/, '').toLowerCase())
			.filter(Boolean)
	);
	const excludedDisplayValue = excludedUserNames.join(', ');
	const topCreations = Array.isArray(vm?.topCreations) ? vm.topCreations : [];
	const filteredTopCreations = topCreations.filter((row) => {
		const creatorUserName =
			row?.creatorUserName != null ? String(row.creatorUserName).trim().toLowerCase() : '';
		return !creatorUserName || !excludedSet.has(creatorUserName);
	});
	const sortedTopCreations = [...filteredTopCreations].sort((a, b) => {
		const aVoteValue = Number.isFinite(Number(a?.voteValue))
			? Math.max(0, Math.floor(Number(a.voteValue)))
			: 0;
		const bVoteValue = Number.isFinite(Number(b?.voteValue))
			? Math.max(0, Math.floor(Number(b.voteValue)))
			: 0;
		const aVoteCount = Number.isFinite(Number(a?.voteCount))
			? Math.max(0, Math.floor(Number(a.voteCount)))
			: 0;
		const bVoteCount = Number.isFinite(Number(b?.voteCount))
			? Math.max(0, Math.floor(Number(b.voteCount)))
			: 0;
		const aAverageVote = aVoteCount > 0 ? aVoteValue / aVoteCount : 0;
		const bAverageVote = bVoteCount > 0 ? bVoteValue / bVoteCount : 0;
		if (bAverageVote !== aAverageVote) {
			return bAverageVote - aAverageVote;
		}
		if (bVoteValue !== aVoteValue) {
			return bVoteValue - aVoteValue;
		}
		return bVoteCount - aVoteCount;
	});
	const rowsHtml = sortedTopCreations
		.slice(0, 10)
		.map((row, i) => {
			const rank = i + 1;
			const cid =
				Number.isFinite(Number(row?.creationId)) && Number(row.creationId) > 0
					? Number(row.creationId)
					: null;
			const voteValue = Number.isFinite(Number(row?.voteValue))
				? Math.max(0, Math.floor(Number(row.voteValue)))
				: 0;
			const voteCount = Number.isFinite(Number(row?.voteCount))
				? Math.max(0, Math.floor(Number(row.voteCount)))
				: 0;
			const averageVote = voteCount > 0 ? voteValue / voteCount : 0;
			const averageVoteDisplay = Number.isFinite(averageVote) ? averageVote.toFixed(2) : '0.00';
			const messageId =
				Number.isFinite(Number(row?.messageId)) && Number(row.messageId) > 0
					? Math.floor(Number(row.messageId))
					: null;
			const midAttr =
				messageId != null ? ` data-challenge-message-id="${esc(String(messageId))}"` : '';
			const thumbBlock = cid
				? `<span class="challenge-pane-organizer-stats-thumb-slot" data-challenge-stats-thumb-slot="" data-creation-id="${esc(String(cid))}"${midAttr}>
					<span class="challenge-pane-organizer-stats-thumb challenge-pane-organizer-stats-thumb--placeholder" aria-hidden="true"></span>
				</span>`
				: `<span class="challenge-pane-organizer-stats-thumb challenge-pane-organizer-stats-thumb--placeholder" aria-hidden="true"></span>`;
			const creatorUid =
				Number.isFinite(Number(row?.creatorUserId)) && Number(row.creatorUserId) > 0
					? Math.floor(Number(row.creatorUserId))
					: null;
			const creatorUnRaw =
				row?.creatorUserName != null && String(row.creatorUserName).trim()
					? String(row.creatorUserName).trim()
					: '';
			const creatorCell =
				creatorUnRaw && creatorUid != null
					? `<a class="challenge-pane-organizer-stats-voter-link" href="/p/${encodeURIComponent(creatorUnRaw.toLowerCase())}">@${esc(creatorUnRaw)}</a>`
					: creatorUid != null
						? `<span class="challenge-pane-muted">User ${esc(String(creatorUid))}</span>`
						: '<span class="challenge-pane-muted">Unknown</span>';
			const creationCell = cid
				? `<a class="challenge-pane-organizer-stats-creation" href="/creations/${encodeURIComponent(
						String(cid)
					)}" aria-label="View creation ${esc(String(cid))}">
					${thumbBlock}
				</a>`
				: '<span class="challenge-pane-muted">Unknown creation</span>';
			return `<tr>
				<td>${esc(String(rank))}</td>
				<td>${creationCell}</td>
				<td>${creatorCell}</td>
				<td>${esc(String(voteValue))}</td>
				<td>${esc(String(voteCount))}</td>
				<td>${esc(averageVoteDisplay)}</td>
			</tr>`;
		})
		.join('');
	const bodyTable = rowsHtml
		? `<table class="challenge-pane-organizer-stats-table">
			<thead>
				<tr>
					<th scope="col">#</th>
					<th scope="col">Creation</th>
					<th scope="col">Creator</th>
					<th scope="col">Vote value</th>
					<th scope="col">Votes</th>
					<th scope="col">Average vote</th>
				</tr>
			</thead>
			<tbody>${rowsHtml}</tbody>
		</table>`
		: `<p class="challenge-pane-muted challenge-pane-organizer-stats-empty">No submissions with votes yet.</p>`;

	const topSubmitters = Array.isArray(vm?.topSubmitters) ? vm.topSubmitters : [];
	const filteredTopSubmitters = topSubmitters.filter((row) => {
		const userName = row?.userName != null ? String(row.userName).trim().toLowerCase() : '';
		return !userName || !excludedSet.has(userName);
	});
	const submitterRowsHtml = filteredTopSubmitters
		.slice(0, 10)
		.map((row, i) => {
			const rank = i + 1;
			const uid = Number.isFinite(Number(row?.userId)) ? Math.floor(Number(row.userId)) : null;
			const submissionCount = Number.isFinite(Number(row?.submissionCount))
				? Math.max(0, Math.floor(Number(row.submissionCount)))
				: 0;
			const unRaw =
				row?.userName != null && String(row.userName).trim()
					? String(row.userName).trim()
					: '';
			const userCell =
				unRaw && uid != null
					? `<a class="challenge-pane-organizer-stats-voter-link" href="/p/${encodeURIComponent(unRaw.toLowerCase())}">@${esc(unRaw)}</a>`
					: uid != null
						? `<span class="challenge-pane-muted">User ${esc(String(uid))}</span>`
						: '<span class="challenge-pane-muted">Unknown</span>';
			return `<tr>
				<td>${esc(String(rank))}</td>
				<td>${userCell}</td>
				<td>${esc(String(submissionCount))}</td>
			</tr>`;
		})
		.join('');
	const submittersTable = submitterRowsHtml
		? `<table class="challenge-pane-organizer-stats-table challenge-pane-organizer-stats-table--submitters">
			<thead>
				<tr>
					<th scope="col">#</th>
					<th scope="col">Entrant</th>
					<th scope="col">Submissions</th>
				</tr>
			</thead>
			<tbody>${submitterRowsHtml}</tbody>
		</table>`
		: `<p class="challenge-pane-muted challenge-pane-organizer-stats-empty">No submissions yet.</p>`;

	const topVoters = Array.isArray(vm?.topVoters) ? vm.topVoters : [];
	const filteredTopVoters = topVoters.filter((row) => {
		const userName = row?.userName != null ? String(row.userName).trim().toLowerCase() : '';
		return !userName || !excludedSet.has(userName);
	});
	const voterRowsHtml = filteredTopVoters
		.slice(0, 10)
		.map((row, i) => {
			const rank = i + 1;
			const uid = Number.isFinite(Number(row?.userId)) ? Math.floor(Number(row.userId)) : null;
			const voteCount = Number.isFinite(Number(row?.voteCount))
				? Math.max(0, Math.floor(Number(row.voteCount)))
				: 0;
			const unRaw =
				row?.userName != null && String(row.userName).trim()
					? String(row.userName).trim()
					: '';
			const voterCell =
				unRaw && uid != null
					? `<a class="challenge-pane-organizer-stats-voter-link" href="/p/${encodeURIComponent(unRaw.toLowerCase())}">@${esc(unRaw)}</a>`
					: uid != null
						? `<span class="challenge-pane-muted">User ${esc(String(uid))}</span>`
						: '<span class="challenge-pane-muted">Unknown</span>';
			return `<tr>
				<td>${esc(String(rank))}</td>
				<td>${voterCell}</td>
				<td>${esc(String(voteCount))}</td>
			</tr>`;
		})
		.join('');
	const votersTable = voterRowsHtml
		? `<table class="challenge-pane-organizer-stats-table challenge-pane-organizer-stats-table--voters">
			<thead>
				<tr>
					<th scope="col">#</th>
					<th scope="col">Voter</th>
					<th scope="col">Votes</th>
				</tr>
			</thead>
			<tbody>${voterRowsHtml}</tbody>
		</table>`
		: `<p class="challenge-pane-muted challenge-pane-organizer-stats-empty">No votes cast yet.</p>`;

	return `<section class="challenge-pane-organizer-stats-view">
		<p class="challenge-pane-organizer-stats-kicker">${esc(challengeTitle)}</p>
		<h4 class="challenge-pane-organizer-stats-subhead">Top 10 creations by average vote</h4>
		<form class="challenge-pane-organizer-stats-filter" data-challenge-stats-filter-form>
			<label class="challenge-pane-organizer-stats-filter-label" for="challenge-stats-excluded-usernames">Exclude usernames</label>
			<input id="challenge-stats-excluded-usernames" type="text" class="challenge-pane-input challenge-pane-organizer-stats-filter-input" data-challenge-stats-filter-input name="excluded_usernames" value="${esc(excludedDisplayValue)}" placeholder="organizer, user2" autocomplete="off" />
			<button type="submit" class="btn-outlined challenge-pane-organizer-stats-filter-apply">Apply</button>
		</form>
		<div class="challenge-pane-organizer-stats-table-wrap">${bodyTable}</div>
		<h4 class="challenge-pane-organizer-stats-subhead challenge-pane-organizer-stats-subhead--secondary">Top 10 entrants by submissions</h4>
		<div class="challenge-pane-organizer-stats-table-wrap">${submittersTable}</div>
		<h4 class="challenge-pane-organizer-stats-subhead challenge-pane-organizer-stats-subhead--secondary">Top 10 voters by votes cast</h4>
		<div class="challenge-pane-organizer-stats-table-wrap">${votersTable}</div>
	</section>`;
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
 * @param {{
 *   rows: { challenge_id: string, title: string }[],
 *   gearIconSvg: string,
 *   statsIconSvg: string,
 *   plusIconSvg: string,
 * }} vm
 */
export function renderChallengeOrganizerSidebarMarkup(vm) {
	const rows = vm.rows || [];
	const table = renderChallengeOrganizerTableHtml(rows, {
		gearIconSvg: vm.gearIconSvg || '',
		statsIconSvg: vm.statsIconSvg || '',
		plusIconSvg: vm.plusIconSvg || ''
	});
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
