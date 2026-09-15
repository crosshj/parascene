import { PARASCENE_BLUE_SERVER_ID } from './generationDefaults.js';

/**
 * Occupancy peek from Blue / Parascene query. Missing `idle` means the server
 * does not speak occupancy yet — callers skip the dialog.
 */

export function parseGpuOccupancy(raw) {
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.idle !== 'boolean') return null;
	const aheadRaw = Number(raw.ahead);
	const etaRaw = Number(raw.eta_s);
	const runningRaw = raw.running;
	let running = null;
	if (runningRaw && typeof runningRaw === 'object') {
		const kind = runningRaw.kind === 'video' ? 'video' : 'still';
		const family =
			typeof runningRaw.family === 'string' && runningRaw.family.trim()
				? runningRaw.family.trim()
				: '';
		running = family ? { kind, family } : { kind };
	}
	const cost = Number(raw.cost);
	return {
		idle: raw.idle,
		running,
		ahead: Number.isFinite(aheadRaw) && aheadRaw > 0 ? Math.floor(aheadRaw) : 0,
		eta_s: Number.isFinite(etaRaw) && etaRaw > 0 ? Math.round(etaRaw) : 0,
		cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
		supported: raw.supported === true || raw.supported === 'true'
	};
}

export function occupancyIsBusy(occupancy) {
	return Boolean(occupancy && occupancy.idle === false);
}

export function formatOccupancyEta(seconds) {
	const s = Number(seconds);
	if (!Number.isFinite(s) || s <= 0) return 'a moment';
	if (s < 45) return 'under a minute';
	const mins = Math.max(1, Math.round(s / 60));
	return mins === 1 ? 'about 1 min' : `about ${mins} min`;
}

function ordinal(n) {
	const v = Math.floor(Number(n) || 0);
	const mod100 = v % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
	switch (v % 10) {
		case 1:
			return `${v}st`;
		case 2:
			return `${v}nd`;
		case 3:
			return `${v}rd`;
		default:
			return `${v}th`;
	}
}

function kindLabel(kind) {
	return kind === 'video' ? 'Video' : 'Still';
}

function familyLabel(family) {
	if (!family) return '';
	return family.replace(/[_-]+/g, ' ');
}

function runningLabel(running) {
	if (!running) return 'Waiting to start';
	const fam = familyLabel(running.family);
	return fam ? `${kindLabel(running.kind)} · ${fam}` : kindLabel(running.kind);
}

export function occupancyDialogModel(occupancy, { lane = 'product' } = {}) {
	const place = (occupancy?.ahead || 0) + 1;
	const wait = formatOccupancyEta(occupancy?.eta_s);
	const title = lane === 'direct' ? 'Blue is busy' : 'This server is busy';
	const placeLine =
		place <= 1 ? "You'll be next." : `You'll be ${ordinal(place)} in line.`;
	const message = `${placeLine} ${wait[0].toUpperCase()}${wait.slice(1)} until generating starts.`;
	const stats = [
		{ label: 'Running', value: runningLabel(occupancy?.running) },
		{
			label: 'Ahead',
			value: occupancy?.ahead ? String(occupancy.ahead) : 'None'
		},
		{ label: 'Wait', value: wait }
	];
	if (lane !== 'direct' && occupancy?.cost > 0) {
		const c = occupancy.cost;
		stats.push({
			label: 'Credits',
			value: c === 1 ? '1' : String(c)
		});
	}
	return {
		title,
		message,
		stats,
		confirmLabel: 'Generate',
		cancelLabel: 'Cancel'
	};
}

function escapeText(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function showOccupancyConfirm(occupancy, opts = {}) {
	const model = occupancyDialogModel(occupancy, opts);
	return new Promise((resolve) => {
		const existing = document.querySelector('[data-occupancy-dialog]');
		existing?.remove();

		const root = document.createElement('div');
		root.className = 'occupancy-dialog-backdrop';
		root.setAttribute('data-occupancy-dialog', '');
		root.setAttribute('role', 'presentation');
		root.innerHTML = `
			<div class="occupancy-dialog" role="alertdialog" aria-modal="true"
				aria-labelledby="occupancy-dialog-title" aria-describedby="occupancy-dialog-message">
				<h2 id="occupancy-dialog-title">${escapeText(model.title)}</h2>
				<p id="occupancy-dialog-message" class="occupancy-dialog-lede">${escapeText(model.message)}</p>
				<dl class="occupancy-stats">
					${model.stats
						.map(
							(row) => `
						<div class="occupancy-stat">
							<dt>${escapeText(row.label)}</dt>
							<dd>${escapeText(row.value)}</dd>
						</div>`
						)
						.join('')}
				</dl>
				<div class="occupancy-dialog-actions">
					<button type="button" class="btn-secondary" data-occupancy-cancel>${escapeText(model.cancelLabel)}</button>
					<button type="button" class="btn-primary" data-occupancy-confirm autofocus>${escapeText(model.confirmLabel)}</button>
				</div>
			</div>
		`;

		const finish = (value) => {
			window.removeEventListener('keydown', onKey);
			root.remove();
			resolve(value);
		};
		const onKey = (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				finish(false);
			}
		};
		root.addEventListener('click', (e) => {
			if (e.target === root) finish(false);
		});
		root.querySelector('[data-occupancy-cancel]')?.addEventListener('click', () => finish(false));
		root.querySelector('[data-occupancy-confirm]')?.addEventListener('click', () => finish(true));
		window.addEventListener('keydown', onKey);
		document.body.appendChild(root);
		root.querySelector('[data-occupancy-confirm]')?.focus();
	});
}

export async function queryCreateOccupancy({ serverId, method, args } = {}) {
	const sid = Number(serverId);
	const methodKey = typeof method === 'string' ? method.trim() : '';
	if (!Number.isFinite(sid) || sid <= 0 || !methodKey) return null;
	try {
		const res = await fetch('/api/create/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				server_id: sid,
				method: methodKey,
				args: args && typeof args === 'object' ? args : {}
			})
		});
		if (!res.ok) return null;
		return parseGpuOccupancy(await res.json().catch(() => null));
	} catch {
		return null;
	}
}

/** Peek occupancy for GPU server 6. Idle or unknown → continue. Busy → confirm. */
export async function confirmGpuOccupancyIfNeeded({
	serverId,
	method,
	args,
	lane = 'product'
} = {}) {
	if (Number(serverId) !== Number(PARASCENE_BLUE_SERVER_ID)) return true;
	const occupancy = await queryCreateOccupancy({ serverId, method, args });
	if (!occupancyIsBusy(occupancy)) return true;
	return showOccupancyConfirm(occupancy, { lane });
}
