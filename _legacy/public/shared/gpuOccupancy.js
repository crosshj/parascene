import { PARASCENE_BLUE_SERVER_ID } from './generationDefaults.js';

/**
 * Occupancy peek from Blue / Parascene query. Missing `idle` means the server
 * does not speak occupancy yet — callers skip the dialog.
 */

export const PRODUCT_MAX_CAP = 50;
export const ALWAYS_NEXT_MAX = 51;
export const PRODUCT_BOOST_STEP = 0.5;

const STICKY_IMAGE_KEY = 'parascene.gpuBoost.image';
const STICKY_VIDEO_KEY = 'parascene.gpuBoost.video';

const VIDEO_METHODS = new Set([
	'text2video',
	'image2video',
	'audio2video',
	'video2video',
	'reference2video'
]);

export function gpuMethodKind(method) {
	return VIDEO_METHODS.has(String(method || '').trim()) ? 'video' : 'image';
}

function listCost(cost) {
	return Number.isFinite(cost) && cost > 0 ? cost : 0.1;
}

function snapToHalf(n) {
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 2) / 2;
}

export function productSliderRange(cost) {
	const min = listCost(cost);
	return { min, max: Math.max(PRODUCT_MAX_CAP, min) };
}

/** Credits Boost slider: 0 at list, +0.5 steps, total clamped at the cap. */
export function productBoostRange(cost) {
	const { min: list, max: cap } = productSliderRange(cost);
	const max = Math.max(0, Math.floor((cap - list) / PRODUCT_BOOST_STEP) * PRODUCT_BOOST_STEP);
	return { min: 0, max, step: PRODUCT_BOOST_STEP };
}

export function namedPriceFromBoost(cost, boost) {
	const { min: list, max: cap } = productSliderRange(cost);
	const { max: maxBoost } = productBoostRange(list);
	const raw = Number(boost);
	const b = Number.isFinite(raw) ? Math.min(maxBoost, Math.max(0, snapToHalf(raw))) : 0;
	return Math.min(cap, Math.round((list + b) * 10) / 10);
}

export function boostFromNamedPrice(cost, named) {
	const { min: list } = productSliderRange(cost);
	const { max: maxBoost } = productBoostRange(list);
	const raw = Number(named);
	if (!Number.isFinite(raw)) return 0;
	return Math.min(maxBoost, Math.max(0, snapToHalf(raw - list)));
}

export function formatCreditsBoost(boost) {
	const snapped = snapToHalf(Number.isFinite(boost) ? boost : 0);
	if (snapped <= 0) return '0';
	return snapped % 1 === 0 ? `+${snapped}` : `+${snapped.toFixed(1)}`;
}

export function clampProductBoost(raw, cost) {
	const { max } = productBoostRange(cost);
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(max, Math.max(0, snapToHalf(n)));
}

export function clampProductMaxBid(raw, cost) {
	return namedPriceFromBoost(cost, clampProductBoost(raw, cost));
}

/** Charge list + boost. `rawMaxBid` is Credits Boost, not the job total. */
export function resolveProductNamedPrice(rawMaxBid, list) {
	const boost = clampProductBoost(rawMaxBid, list);
	return {
		ok: true,
		cost: namedPriceFromBoost(list, boost),
		max_bid: boost
	};
}

export function readStickyMax(kind) {
	try {
		const raw = localStorage.getItem(kind === 'video' ? STICKY_VIDEO_KEY : STICKY_IMAGE_KEY);
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

export function writeStickyMax(kind, value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return;
	try {
		localStorage.setItem(kind === 'video' ? STICKY_VIDEO_KEY : STICKY_IMAGE_KEY, String(n));
	} catch {
		/* ignore */
	}
}

export function initialProposedMax(occupancy, method) {
	const sticky = readStickyMax(gpuMethodKind(method));
	if (sticky == null) return 0;
	return clampProductBoost(sticky, occupancy?.cost);
}

export function applyGpuBid(args, bid, lane) {
	const next = args && typeof args === 'object' ? { ...args } : {};
	delete next.max_bid;
	delete next.always_next;
	delete next.credits_boost;
	if (!bid) return next;
	if (lane === 'direct') {
		next.always_next = bid.alwaysNext === true;
		return next;
	}
	const boost = Number(bid.maxBid);
	if (Number.isFinite(boost) && boost > 0) {
		const snapped = Math.round(boost * 2) / 2;
		next.max_bid = snapped;
		next.credits_boost = snapped;
	}
	return next;
}

function parsePending(raw) {
	if (!Array.isArray(raw)) return [];
	const rows = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const max = Number(item.boost ?? item.max);
		const eta = Number(item.eta_s);
		rows.push({
			max: Number.isFinite(max) && max > 0 ? max : 0,
			eta_s: Number.isFinite(eta) && eta > 0 ? Math.round(eta) : 0,
			kind: item.kind === 'video' ? 'video' : 'still'
		});
	}
	return rows;
}

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
	const pending = parsePending(raw.pending);
	const highestRaw = Number(raw.highest_max);
	const runningEtaRaw = Number(raw.running_eta_s);
	return {
		idle: raw.idle,
		running,
		running_eta_s:
			Number.isFinite(runningEtaRaw) && runningEtaRaw > 0 ? Math.round(runningEtaRaw) : 0,
		ahead: Number.isFinite(aheadRaw) && aheadRaw > 0 ? Math.floor(aheadRaw) : 0,
		eta_s: Number.isFinite(etaRaw) && etaRaw > 0 ? Math.round(etaRaw) : 0,
		cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
		supported: raw.supported === true || raw.supported === 'true',
		pending,
		highest_max:
			Number.isFinite(highestRaw) && highestRaw > 0
				? highestRaw
				: pending.reduce((high, p) => Math.max(high, p.max), 0)
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

export function placeAtProposedMax(occupancy, proposedMax) {
	const pending = occupancy?.pending || [];
	const bidRaw = Number(proposedMax);
	const bid = Number.isFinite(bidRaw) ? bidRaw : 0;
	const runningEta = occupancy?.running
		? occupancy.running_eta_s || occupancy.eta_s || 0
		: occupancy?.eta_s || 0;

	if (!pending.length) {
		const ahead = occupancy?.ahead || 0;
		if (ahead <= 0) {
			return { ahead: 0, eta_s: runningEta, place: 1 };
		}
		if (bid > 0) {
			return { ahead: 0, eta_s: occupancy?.running_eta_s || runningEta, place: 1 };
		}
		return { ahead, eta_s: occupancy?.eta_s || 0, place: ahead + 1 };
	}

	let ahead = 0;
	let eta = occupancy?.running ? occupancy.running_eta_s || 0 : 0;
	if (occupancy?.running && eta <= 0) {
		eta = Math.max(
			0,
			(occupancy.eta_s || 0) - pending.reduce((sum, row) => sum + row.eta_s, 0)
		);
	}
	for (const row of pending) {
		if (row.max >= bid) {
			ahead += 1;
			eta += row.eta_s;
		}
	}
	if (eta > 3 * 3600) eta = 3 * 3600;
	return { ahead, eta_s: Math.round(eta), place: ahead + 1 };
}

export function occupancySlotWorse(previous, next) {
	return next.ahead > previous.ahead || next.eta_s > previous.eta_s + 30;
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

export function occupancyDialogModel(
	occupancy,
	{ lane = 'product', proposedMax, alwaysNext = false } = {}
) {
	const proposed =
		lane === 'direct'
			? alwaysNext
				? ALWAYS_NEXT_MAX
				: 0
			: clampProductBoost(proposedMax, occupancy?.cost);
	const placed = placeAtProposedMax(occupancy, proposed);
	const wait = formatOccupancyEta(placed.eta_s);
	const title = lane === 'direct' ? 'Blue is busy' : 'This server is busy';
	const placeLine =
		placed.place <= 1 ? "You'll be next." : `You'll be ${ordinal(placed.place)} in line.`;
	let message = `${placeLine} ${wait[0].toUpperCase()}${wait.slice(1)} until generating starts.`;
	const maxBoost = productBoostRange(occupancy?.cost).max;
	const atCap =
		lane === 'product' &&
		proposed >= maxBoost &&
		maxBoost > 0 &&
		occupancy?.highest_max >= proposed &&
		placed.place > 1;
	const capNote = atCap
		? 'Others boosted the same or more. This is the max for this method.'
		: null;
	if (capNote) message = `${message} ${capNote}`;
	const stats = [{ label: 'Now running', value: runningLabel(occupancy?.running) }];
	if (lane !== 'direct') {
		const credits = namedPriceFromBoost(occupancy?.cost, proposed);
		if (credits > 0) {
			stats.push({
				label: 'Credits',
				value: credits === 1 ? '1' : String(Math.round(credits * 10) / 10)
			});
		}
	}
	return {
		title,
		message,
		stats,
		confirmLabel: 'Generate',
		cancelLabel: 'Cancel',
		capNote
	};
}

function escapeText(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function idleBid(occupancy, lane) {
	if (lane === 'direct') return { maxBid: 0, alwaysNext: false, charge: 0 };
	const list = occupancy?.cost && occupancy.cost > 0 ? occupancy.cost : 0;
	return { maxBid: 0, alwaysNext: false, charge: list };
}

export function showOccupancyConfirm(occupancy, opts = {}) {
	const lane = opts.lane || 'product';
	const method = typeof opts.method === 'string' ? opts.method : '';
	const peek = typeof opts.peek === 'function' ? opts.peek : null;
	let current = occupancy;
	let proposedMax = initialProposedMax(occupancy, method);
	let alwaysNext = false;
	let lineMoved = false;
	let confirming = false;

	return new Promise((resolve) => {
		const existing = document.querySelector('[data-occupancy-dialog]');
		existing?.remove();

		const root = document.createElement('div');
		root.className = 'occupancy-dialog-backdrop';
		root.setAttribute('data-occupancy-dialog', '');
		root.setAttribute('role', 'presentation');

		const finish = (value) => {
			window.removeEventListener('keydown', onKey);
			root.remove();
			resolve(value);
		};
		const onKey = (e) => {
			if (e.key === 'Escape' && !confirming) {
				e.preventDefault();
				finish(null);
			}
		};

		const render = () => {
			const model = occupancyDialogModel(current, { lane, proposedMax, alwaysNext });
			const range = productBoostRange(current.cost);
			const boost = proposedMax;
			const negotiate =
				lane === 'product'
					? `<div class="occupancy-slider">
						<label class="occupancy-slider-label" for="occupancy-max">Credits Boost<span class="occupancy-slider-value" data-occupancy-boost-value>${escapeText(formatCreditsBoost(boost))}</span></label>
						<input id="occupancy-max" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${boost}" ${confirming || range.max <= 0 ? 'disabled' : ''} />
						<div class="occupancy-slider-ends"><span>No boost</span><span>Max boost</span></div>
					</div>`
					: `<label class="occupancy-always-next">
						<input type="checkbox" data-occupancy-always ${alwaysNext ? 'checked' : ''} ${confirming ? 'disabled' : ''} />
						<span>Always next<span class="occupancy-always-next-hint">Goes ahead of anyone paying credits. Can starve that path.</span></span>
					</label>`;
			root.innerHTML = `
				<div class="occupancy-dialog" role="alertdialog" aria-modal="true"
					aria-labelledby="occupancy-dialog-title" aria-describedby="occupancy-dialog-message">
					<h2 id="occupancy-dialog-title">${escapeText(model.title)}</h2>
					<p id="occupancy-dialog-message" class="occupancy-dialog-lede">${escapeText(model.message)}</p>
					${lineMoved ? '<p class="occupancy-line-moved" role="status">The line moved. Place below is current.</p>' : ''}
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
					${negotiate}
					<div class="occupancy-dialog-actions">
						<button type="button" class="btn-secondary" data-occupancy-cancel ${confirming ? 'disabled' : ''}>${escapeText(model.cancelLabel)}</button>
						<button type="button" class="btn-primary" data-occupancy-confirm ${confirming ? 'disabled' : ''} autofocus>${escapeText(confirming ? 'Checking…' : model.confirmLabel)}</button>
					</div>
				</div>
			`;
			bind();
		};

		const bind = () => {
			root.querySelector('[data-occupancy-cancel]')?.addEventListener('click', () => finish(null));
			root.querySelector('[data-occupancy-confirm]')?.addEventListener('click', () => void onConfirm());
			const slider = root.querySelector('#occupancy-max');
			slider?.addEventListener('input', (e) => {
				proposedMax = Number(e.target.value);
				const model = occupancyDialogModel(current, { lane, proposedMax, alwaysNext });
				const msg = root.querySelector('#occupancy-dialog-message');
				if (msg) msg.textContent = model.message;
				const boostEl = root.querySelector('[data-occupancy-boost-value]');
				if (boostEl) boostEl.textContent = formatCreditsBoost(proposedMax);
				const creditRow = [...root.querySelectorAll('.occupancy-stat')].find(
					(el) => el.querySelector('dt')?.textContent === 'Credits'
				);
				const credit = model.stats.find((s) => s.label === 'Credits');
				if (creditRow && credit) {
					const dd = creditRow.querySelector('dd');
					if (dd) dd.textContent = credit.value;
				}
			});
			root.querySelector('[data-occupancy-always]')?.addEventListener('change', (e) => {
				alwaysNext = Boolean(e.target.checked);
				render();
			});
			root.querySelector('[data-occupancy-confirm]')?.focus();
		};

		const onConfirm = async () => {
			if (confirming) return;
			confirming = true;
			lineMoved = false;
			render();
			const bid =
				lane === 'direct'
					? { maxBid: alwaysNext ? ALWAYS_NEXT_MAX : 0, alwaysNext, charge: 0 }
					: {
							maxBid: proposedMax,
							alwaysNext: false,
							charge: namedPriceFromBoost(current.cost, proposedMax)
						};
			const proposed = lane === 'direct' ? (alwaysNext ? ALWAYS_NEXT_MAX : 0) : proposedMax;
			const before = placeAtProposedMax(current, proposed);
			if (peek) {
				const fresh = await peek().catch(() => null);
				if (fresh) {
					const after = placeAtProposedMax(fresh, proposed);
					if (occupancySlotWorse(before, after)) {
						current = fresh;
						confirming = false;
						lineMoved = true;
						render();
						return;
					}
				}
			}
			if (lane === 'product') writeStickyMax(gpuMethodKind(method), proposedMax);
			finish(bid);
		};

		let downOnBackdrop = false;
		root.addEventListener('pointerdown', (e) => {
			downOnBackdrop = e.target === root;
		});
		root.addEventListener('click', (e) => {
			if (e.target === root && downOnBackdrop && !confirming) finish(null);
			downOnBackdrop = false;
		});
		window.addEventListener('keydown', onKey);
		document.body.appendChild(root);
		render();
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

/** Peek occupancy for GPU server 6. Idle or unknown → list. Busy → negotiate. */
export async function confirmGpuOccupancyIfNeeded({
	serverId,
	method,
	args,
	lane = 'product'
} = {}) {
	if (Number(serverId) !== Number(PARASCENE_BLUE_SERVER_ID)) {
		return { ok: true, bid: { maxBid: 0, alwaysNext: false } };
	}
	const occupancy = await queryCreateOccupancy({ serverId, method, args });
	if (!occupancyIsBusy(occupancy)) {
		return { ok: true, bid: idleBid(occupancy, lane) };
	}
	const bid = await showOccupancyConfirm(occupancy, {
		lane,
		method,
		peek: () => queryCreateOccupancy({ serverId, method, args })
	});
	if (!bid) return { ok: false };
	return { ok: true, bid };
}
