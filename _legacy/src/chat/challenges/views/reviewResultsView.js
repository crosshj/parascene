/**
 * Payout tab — prize ledger + save order / finalize.
 *
 * Rank # | username | amount | undo (if customized) / paid-at
 * Customized rows use a subtle row background (no badge).
 *
 * No `name` attributes — may live inside a form elsewhere.
 */

import { esc } from '../constants.js';
import { undoIcon } from '/icons/svg-strings.js';

/** @param {number | null | undefined} n */
function fmtCredits(n) {
	const v = Number(n) || 0;
	return `${v.toLocaleString()} credit${v === 1 ? '' : 's'}`;
}

/** @param {string | null | undefined} iso */
function fmtPaidAt(iso) {
	const s = iso != null ? String(iso).trim() : '';
	if (!s) return '';
	const d = new Date(s);
	if (!Number.isFinite(d.getTime())) return s;
	return d.toLocaleString(undefined, {
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

/** @param {string | null | undefined} iso */
function fmtPaidAtFull(iso) {
	const s = iso != null ? String(iso).trim() : '';
	if (!s) return '';
	const d = new Date(s);
	return Number.isFinite(d.getTime()) ? d.toLocaleString() : s;
}

const SECTION_META = {
	main: { title: 'Places' },
	top_submitters: { title: 'Top submitters' },
	top_voters: { title: 'Top voters' }
};

/**
 * @param {{
 *   kind?: string,
 *   place?: number | null,
 *   partIndex?: number | null,
 *   label?: string,
 * }} row
 */
function rankNumber(row) {
	if (row?.place != null && Number(row.place) > 0) return String(Math.floor(Number(row.place)));
	if (row?.partIndex != null && Number.isFinite(Number(row.partIndex))) {
		return String(Math.floor(Number(row.partIndex)) + 1);
	}
	const label = String(row?.label || '');
	const place = label.match(/^(\d)(?:st|nd|rd|th) place$/i);
	if (place) return place[1];
	const top = label.match(/^Top\s+(\d+)/i);
	if (top) return top[1];
	const any = label.match(/(\d+)/);
	return any ? any[1] : '—';
}

export function renderResultsPanelLoadingHtml() {
	return `<p class="challenge-pane-muted">Loading payouts…</p>`;
}

/** @param {string} msg */
export function renderResultsPanelErrorHtml(msg) {
	return `<p class="challenge-pane-form-error" role="alert">${esc(msg)}</p>`;
}

/**
 * @param {{
 *   rows: {
 *     key: string,
 *     kind?: 'main' | 'top_submitters' | 'top_voters' | string,
 *     place?: number | null,
 *     partIndex?: number | null,
 *     label: string,
 *     userId: number | null,
 *     userName: string | null,
 *     amount: number,
 *     paidAt: string | null,
 *     payoutIndex: number | null,
 *     candidates: { userId: number, userName: string }[],
 *     editable: boolean,
 *     customized?: boolean,
 *     defaultUserName?: string | null,
 *   }[],
 *   busyKey?: string | null,
 *   saveBusy?: boolean,
 *   canSave?: boolean,
 *   canPay?: boolean,
 *   payBusy?: boolean,
 *   unpaidCount?: number,
 *   unpaidTotal?: number,
 *   canFinalize?: boolean,
 *   finalized?: boolean,
 *   finalizeBusy?: boolean,
 * }} vm
 */
export function renderResultsPayoutLedgerHtml(vm) {
	const rows = Array.isArray(vm.rows) ? vm.rows : [];
	const busyKey = vm.busyKey || null;
	const finalized = Boolean(vm.finalized);
	const canFinalize = Boolean(vm.canFinalize);
	const canSave = Boolean(vm.canSave) && !finalized;
	const canPay = Boolean(vm.canPay) && !finalized;
	const saveBusy = Boolean(vm.saveBusy);
	const payBusy = Boolean(vm.payBusy);
	const unpaidCount = Number(vm.unpaidCount) || 0;
	const unpaidTotal = Number(vm.unpaidTotal) || 0;
	const undoSvg = undoIcon('challenge-results-undo-svg');
	const anyBusy = Boolean(busyKey);
	const rowKind = (row) => {
		if (row?.kind === 'main' || row?.kind === 'top_submitters' || row?.kind === 'top_voters') {
			return row.kind;
		}
		const label = String(row?.label || '').toLowerCase();
		if (label.includes('submitter')) return 'top_submitters';
		if (label.includes('voter')) return 'top_voters';
		return 'main';
	};

	const rowHtml = (row) => {
		const paid = Boolean(row.paidAt);
		const customized = Boolean(row.customized) && !paid;
		const rank = rankNumber(row);
		const ariaRank = row.label || rank;
		const defaultLabel = row.defaultUserName ? `@${row.defaultUserName}` : 'ranked default';

		let userCell;
		if (paid || !row.editable) {
			const un = row.userName ? String(row.userName).trim() : '';
			userCell = un
				? `<a class="challenge-pane-organizer-stats-voter-link" href="/p/${encodeURIComponent(un.toLowerCase())}">@${esc(un)}</a>`
				: `<span class="challenge-pane-muted">User ${esc(String(row.userId ?? '—'))}</span>`;
		} else {
			const opts = (row.candidates || [])
				.map((c) => {
					const selected = Number(c.userId) === Number(row.userId) ? ' selected' : '';
					const label = c.userName ? `@${c.userName}` : `User ${c.userId}`;
					return `<option value="${esc(String(c.userId))}"${selected}>${esc(label)}</option>`;
				})
				.join('');
			userCell = `<select class="challenge-pane-input challenge-results-user-select" data-results-user-select data-slot-key="${esc(row.key)}" aria-label="Recipient for ${esc(ariaRank)}">${opts || `<option value="">—</option>`}</select>`;
		}

		let actionCell;
		if (paid) {
			const full = fmtPaidAtFull(row.paidAt);
			actionCell = `<span class="challenge-results-paid-at" title="${esc(full)}"><span class="challenge-results-paid-label">Paid</span> ${esc(fmtPaidAt(row.paidAt))}</span>`;
		} else if (customized) {
			actionCell = `<button type="button" class="challenge-results-undo-btn" data-results-revert data-slot-key="${esc(row.key)}" aria-label="Revert to ${esc(defaultLabel)}" title="Revert to ${esc(defaultLabel)}"${busyKey ? ' disabled' : ''}>${undoSvg}</button>`;
		} else {
			actionCell = '';
		}

		const rowClass = [customized ? 'is-customized' : '', paid ? 'is-paid' : ''].filter(Boolean).join(' ');
		return `<tr data-results-slot="${esc(row.key)}"${rowClass ? ` class="${rowClass}"` : ''}>
			<td class="challenge-results-rank">${esc(rank)}</td>
			<td class="challenge-results-user">${userCell}</td>
			<td class="challenge-results-amount">${esc(fmtCredits(row.amount))}</td>
			<td class="challenge-results-action">${actionCell}</td>
		</tr>`;
	};

	const sectionOrder = ['main', 'top_submitters', 'top_voters'];
	const sections = sectionOrder
		.map((kind) => {
			const sectionRows = rows.filter((r) => rowKind(r) === kind);
			if (!sectionRows.length) return '';
			const title = SECTION_META[kind]?.title || kind;
			return `<div class="challenge-pane-organizer-stats-table-wrap challenge-results-ledger-section">
			<h4 class="challenge-pane-organizer-stats-subhead challenge-results-section-title">${esc(title)}</h4>
			<table class="challenge-pane-organizer-stats-table challenge-results-ledger-table">
				<tbody>${sectionRows.map(rowHtml).join('')}</tbody>
			</table>
		</div>`;
		})
		.filter(Boolean)
		.join('');

	const saveBtn = canSave
		? `<button type="button" class="btn-outlined challenge-results-save-btn" data-results-save${anyBusy ? ' disabled' : ''}>${saveBusy ? 'Saving…' : 'Save order'}</button>`
		: '';
	const payLabel =
		unpaidCount > 0
			? `Pay ${unpaidCount} unpaid (${unpaidTotal.toLocaleString()} credits)`
			: 'Pay unpaid';
	const payBtn = canPay
		? `<button type="button" class="btn-primary challenge-results-pay-all-btn" data-results-pay-all${anyBusy ? ' disabled' : ''}>${payBusy ? 'Paying…' : payLabel}</button>`
		: '';
	const finalizeBtn = canFinalize
		? `<button type="button" class="btn-outlined challenge-results-confirm" data-results-finalize${vm.finalizeBusy || anyBusy ? ' disabled' : ''}>${vm.finalizeBusy ? 'Finalizing…' : 'Finalize challenge'}</button>`
		: '';

	let footerNote = '';
	if (finalized) {
		footerNote = `<p class="challenge-pane-muted challenge-results-finalize-note">Challenge finalized.</p>`;
	} else if (canFinalize) {
		footerNote = `<p class="challenge-results-total">All prizes paid.</p>`;
	} else if (unpaidCount > 0) {
		footerNote = `<p class="challenge-pane-muted challenge-results-finalize-note">${unpaidCount} unpaid</p>`;
	}

	const footerActions = saveBtn || payBtn || finalizeBtn
		? `<div class="challenge-results-footer-actions">${finalizeBtn}${saveBtn}${payBtn}</div>`
		: '';

	return `<section class="challenge-results-ledger" data-results-ledger>
		${sections || `<p class="challenge-pane-muted">No prizes configured for this challenge.</p>`}
		<div class="challenge-results-footer">
			${footerNote}
			${footerActions}
		</div>
		<p class="challenge-pane-form-error" data-results-error hidden role="alert"></p>
	</section>`;
}
