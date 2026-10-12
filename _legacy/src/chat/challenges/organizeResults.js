/**
 * Payout tab controller — prize ledger in the Results modal.
 *
 * Save recipient order, pay all unpaid tips from the admin account, then
 * finalize (Pending → Complete) when every payout is paid.
 */

import {
	rankStatsTopCreations,
	rankTopVoters,
	rankTopSubmitters,
	defaultWinnersFromRanked,
	normalizeExcludedUserNames
} from './model/ranking.js';
import { resolveChallengePrizes } from './model/prizes.js';
import { deriveChallengePhase } from './model/phases.js';
import {
	renderResultsPanelLoadingHtml,
	renderResultsPanelErrorHtml,
	renderResultsPayoutLedgerHtml
} from './views/reviewResultsView.js';

const PLACE_LABELS = { 1: '1st place', 2: '2nd place', 3: '3rd place' };
const PLACE_AMOUNTS = (prizes) => ({
	1: Math.max(0, Number(prizes.main.first) || 0),
	2: Math.max(0, Number(prizes.main.second) || 0),
	3: Math.max(0, Number(prizes.main.third) || 0)
});

/**
 * @param {HTMLElement} mountEl
 * @param {{
 *   threadId: number,
 *   challengeId: string,
 *   config: object,
 *   viewerUserName?: string | null,
 *   reload: () => Promise<void>,
 * }} ctx
 */
export function mountOrganizeResultsPanel(mountEl, ctx) {
	const challengeId = String(ctx.challengeId || '').trim();
	if (!challengeId) {
		mountEl.innerHTML = renderResultsPanelErrorHtml('Missing challenge id.');
		return;
	}

	let config = ctx.config && typeof ctx.config === 'object' ? { ...ctx.config } : {};
	const excluded = normalizeExcludedUserNames(ctx.viewerUserName || '');

	const livePrizes = () => resolveChallengePrizes(config, { track: config.track });

	const state = {
		stats: null,
		/** @type {any[]} */
		slots: [],
		/** Fingerprint of last saved (or initial) unpaid recipient order. */
		savedOrderKey: '',
		busyKey: /** @type {string | null} */ (null),
		finalizeBusy: false
	};

	const statsEndpoint = `/api/chat/threads/${encodeURIComponent(String(ctx.threadId))}/challenges/${encodeURIComponent(challengeId)}/stats`;
	const publishEndpoint = `/api/chat/challenges/organize/${encodeURIComponent(String(ctx.threadId))}/${encodeURIComponent(challengeId)}/publish-results`;
	const retryEndpoint = `/api/chat/challenges/organize/${encodeURIComponent(String(ctx.threadId))}/${encodeURIComponent(challengeId)}/retry-unpaid`;
	const finalizeEndpoint = `/api/chat/challenges/organize/${encodeURIComponent(String(ctx.threadId))}/${encodeURIComponent(challengeId)}/finalize-results`;

	const isFinalized = () => {
		const phase = deriveChallengePhase(config, Date.now());
		return (
			phase === 'results' ||
			(config.results_published_at != null && String(config.results_published_at).trim() !== '')
		);
	};

	const hasDraft = () => {
		const results = config.results && typeof config.results === 'object' ? config.results : null;
		return Boolean(results && Array.isArray(results.payouts) && results.payouts.length > 0);
	};

	const nameByUserId = () => {
		const map = new Map();
		for (const row of state.stats?.topVoters || []) {
			if (row.userName) map.set(Number(row.userId), String(row.userName).trim());
		}
		for (const row of state.stats?.topSubmitters || []) {
			if (row.userName) map.set(Number(row.userId), String(row.userName).trim());
		}
		for (const row of state.stats?.topCreations || []) {
			if (row.creatorUserName) {
				map.set(Number(row.creatorUserId), String(row.creatorUserName).trim());
			}
		}
		return map;
	};

	const creatorCandidates = () => {
		const ranked = rankStatsTopCreations(state.stats?.topCreations || [], {
			sortMode: 'weighted',
			globalAverage: Number(state.stats?.globalAverage) || 0,
			excludedUserNames: excluded
		});
		const seen = new Set();
		const out = [];
		for (const row of ranked) {
			const uid = Number(row.creatorUserId);
			if (!Number.isFinite(uid) || uid <= 0 || seen.has(uid)) continue;
			seen.add(uid);
			out.push({
				userId: uid,
				userName: row.creatorUserName ? String(row.creatorUserName).trim() : '',
				messageId: Number(row.messageId) || 0,
				creationId: Number(row.creationId) || 0
			});
		}
		return out;
	};

	const partCandidates = (kind) => {
		const ranked =
			kind === 'top_voters'
				? rankTopVoters(state.stats?.topVoters || [], { excludedUserNames: excluded })
				: rankTopSubmitters(state.stats?.topSubmitters || [], { excludedUserNames: excluded });
		return ranked.map((row) => ({
			userId: Number(row.userId),
			userName: row.userName ? String(row.userName).trim() : ''
		}));
	};

	/** Ranked default recipient for a place / participation slot. */
	const defaultRecipientFor = (kind, placeOrIndex) => {
		if (kind === 'main') {
			const place = Number(placeOrIndex);
			const creators = creatorCandidates();
			const winners = defaultWinnersFromRanked(
				rankStatsTopCreations(state.stats?.topCreations || [], {
					sortMode: 'weighted',
					globalAverage: Number(state.stats?.globalAverage) || 0,
					excludedUserNames: excluded
				}),
				3
			);
			const w = winners.find((row) => row.place === place) || null;
			const creator = creators.find((c) => c.userId === w?.userId) || creators[place - 1] || null;
			return {
				userId: creator?.userId ?? w?.userId ?? null,
				userName: creator?.userName || null,
				messageId: creator?.messageId || w?.messageId || null
			};
		}
		const cands = partCandidates(kind);
		const idx = Math.max(0, Number(placeOrIndex) || 0);
		const c = cands[idx] || null;
		return {
			userId: c?.userId ?? null,
			userName: c?.userName || null,
			messageId: null
		};
	};

	const attachDefaults = (slot) => {
		const def =
			slot.kind === 'main'
				? defaultRecipientFor('main', slot.place)
				: defaultRecipientFor(slot.kind, slot.partIndex);
		slot.defaultUserId = def.userId;
		slot.defaultUserName = def.userName;
		slot.defaultMessageId = def.messageId;
		return slot;
	};

	const isCustomized = (slot) => {
		const cur = Number(slot.userId) || 0;
		const def = Number(slot.defaultUserId) || 0;
		if (!cur || !def) return false;
		return cur !== def;
	};

	const configuredAmountForSlot = (slot) => {
		const prizes = livePrizes();
		if (slot.kind === 'main') {
			const place = Number(slot.place);
			if (place === 1) return Math.max(0, Number(prizes.main.first) || 0);
			if (place === 2) return Math.max(0, Number(prizes.main.second) || 0);
			if (place === 3) return Math.max(0, Number(prizes.main.third) || 0);
			return 0;
		}
		const amounts =
			slot.kind === 'top_voters' ? prizes.top_voters.amounts : prizes.top_submitters.amounts;
		const idx = Math.max(0, Number(slot.partIndex) || 0);
		return Math.max(0, Number(amounts?.[idx]) || 0);
	};

	/** Unpaid rows always mirror current Prizes config (paid rows keep what was tipped). */
	const syncUnpaidAmountsFromPrizes = () => {
		for (const slot of state.slots) {
			if (slot.paidAt) continue;
			slot.amount = configuredAmountForSlot(slot);
		}
	};

	const buildDefaultSlots = () => {
		const slots = [];
		const prizes = livePrizes();
		const placeAmounts = PLACE_AMOUNTS(prizes);
		for (const place of [1, 2, 3]) {
			const amount = placeAmounts[place];
			if (!(amount > 0)) continue;
			const def = defaultRecipientFor('main', place);
			slots.push(
				attachDefaults({
					key: `main-${place}`,
					kind: 'main',
					place,
					label: PLACE_LABELS[place],
					userId: def.userId,
					userName: def.userName,
					messageId: def.messageId,
					amount,
					paidAt: null,
					payoutIndex: null
				})
			);
		}

		const addPart = (kind, enabled, amounts, noun) => {
			if (!enabled) return;
			amounts.forEach((raw, i) => {
				const amount = Math.max(0, Number(raw) || 0);
				if (!(amount > 0)) return;
				const def = defaultRecipientFor(kind, i);
				slots.push(
					attachDefaults({
						key: `${kind}-${i}`,
						kind,
						partIndex: i,
						label: `Top ${i + 1} ${noun}`,
						userId: def.userId,
						userName: def.userName,
						messageId: null,
						amount,
						paidAt: null,
						payoutIndex: null
					})
				);
			});
		};

		addPart(
			'top_submitters',
			prizes.top_submitters.enabled,
			prizes.top_submitters.amounts,
			'submitter'
		);
		addPart('top_voters', prizes.top_voters.enabled, prizes.top_voters.amounts, 'voter');

		slots.forEach((s, i) => {
			s.payoutIndex = i;
		});
		state.slots = slots;
	};

	const applyResultsToSlots = (results) => {
		const payouts = Array.isArray(results?.payouts) ? results.payouts : [];
		const names = nameByUserId();
		const winners = Array.isArray(results?.winners) ? results.winners : [];
		const winnerByUserId = new Map(
			winners.map((w) => [Number(w.user_id), w]).filter(([uid]) => Number.isFinite(uid) && uid > 0)
		);
		const submitterIdx = new Map();
		const voterIdx = new Map();
		(Array.isArray(results?.top_submitters) ? results.top_submitters : []).forEach((row, i) => {
			submitterIdx.set(Number(row.user_id), i);
		});
		(Array.isArray(results?.top_voters) ? results.top_voters : []).forEach((row, i) => {
			voterIdx.set(Number(row.user_id), i);
		});

		state.slots = payouts.map((p, i) => {
			const uid = Number(p.user_id);
			const reason = String(p.reason || '').trim() || `Payout ${i + 1}`;
			const placeMatch = reason.match(/^(\d)(?:st|nd|rd|th) place$/i);
			const partMatch = reason.match(/^Top\s+(\d+)\s+(submitter|voter)/i);
			let kind = 'main';
			let place = null;
			let partIndex = null;
			if (placeMatch) {
				kind = 'main';
				place = Number(placeMatch[1]);
			} else if (partMatch) {
				kind = /voter/i.test(partMatch[2]) ? 'top_voters' : 'top_submitters';
				partIndex = Math.max(0, Number(partMatch[1]) - 1);
			} else if (/submitter/i.test(reason)) {
				kind = 'top_submitters';
				partIndex = submitterIdx.has(uid) ? submitterIdx.get(uid) : i;
			} else if (/voter/i.test(reason)) {
				kind = 'top_voters';
				partIndex = voterIdx.has(uid) ? voterIdx.get(uid) : i;
			}

			const winner = kind === 'main' ? winnerByUserId.get(uid) || winners.find((w) => Number(w.place) === place) : null;
			if (kind === 'main' && place == null && winner) place = Number(winner.place) || null;

			return attachDefaults({
				key: `paid-${i}`,
				kind,
				place,
				partIndex,
				label: reason,
				userId: Number.isFinite(uid) && uid > 0 ? uid : null,
				userName: names.get(uid) || null,
				messageId: winner ? Number(winner.message_id) || null : null,
				amount: Math.max(0, Number(p.amount) || 0),
				paidAt: p.paid_at != null && String(p.paid_at).trim() ? String(p.paid_at) : null,
				payoutIndex: i
			});
		});
	};

	const candidatesForSlot = (slot) => {
		if (slot.kind === 'main') {
			return creatorCandidates().map((c) => ({ userId: c.userId, userName: c.userName }));
		}
		return partCandidates(slot.kind);
	};

	const unpaidCount = () => state.slots.filter((s) => s.amount > 0 && !s.paidAt).length;
	const unpaidTotal = () =>
		state.slots.reduce((sum, s) => (s.amount > 0 && !s.paidAt ? sum + s.amount : sum), 0);

	/** Stable snapshot of recipients + amounts (paid stamped). */
	const orderFingerprint = () =>
		state.slots
			.map((s) => {
				const id = s.kind === 'main' ? `m${s.place}` : `${s.kind}:${s.partIndex}`;
				return `${id}:${Number(s.userId) || 0}:${Number(s.amount) || 0}:${s.paidAt ? 'p' : 'u'}`;
			})
			.join('|');

	const captureSavedOrder = () => {
		state.savedOrderKey = orderFingerprint();
	};

	const isOrderDirty = () => orderFingerprint() !== state.savedOrderKey;

	const slotsReadyToPay = () => {
		for (const slot of state.slots) {
			if (!(slot.amount > 0) || slot.paidAt) continue;
			if (!slot.userId) return false;
			if (slot.kind === 'main' && !slot.messageId) return false;
		}
		return unpaidCount() > 0;
	};

	const render = () => {
		const finalized = isFinalized();
		const draft = hasDraft();
		const unpaid = unpaidCount();
		const dirty = isOrderDirty();
		mountEl.innerHTML = renderResultsPayoutLedgerHtml({
			busyKey: state.busyKey,
			saveBusy: state.busyKey === 'save',
			payBusy: state.busyKey === 'pay-all',
			finalizeBusy: state.finalizeBusy,
			finalized,
			canSave: !finalized && dirty,
			canPay: !finalized && slotsReadyToPay(),
			canFinalize: !finalized && draft && unpaid === 0 && state.slots.length > 0,
			unpaidCount: unpaid,
			unpaidTotal: unpaidTotal(),
			rows: state.slots.map((slot) => ({
				key: slot.key,
				kind: slot.kind,
				place: slot.place,
				partIndex: slot.partIndex,
				label: slot.label,
				userId: slot.userId,
				userName: slot.userName,
				amount: slot.amount,
				paidAt: slot.paidAt,
				payoutIndex: slot.payoutIndex,
				candidates: candidatesForSlot(slot),
				editable: !finalized && !slot.paidAt,
				customized: !slot.paidAt && isCustomized(slot),
				defaultUserName: slot.defaultUserName || null
			}))
		});
	};

	const setError = (msg) => {
		const el = mountEl.querySelector('[data-results-error]');
		if (el instanceof HTMLElement) {
			el.hidden = !msg;
			el.textContent = msg || '';
		}
	};

	const assignUserToSlot = (slotKey, userId) => {
		const slot = state.slots.find((s) => s.key === slotKey);
		if (!slot || slot.paidAt || isFinalized()) return;
		const uid = Number(userId);
		if (!Number.isFinite(uid) || uid <= 0) return;
		slot.userId = uid;
		if (slot.kind === 'main') {
			const c = creatorCandidates().find((x) => x.userId === uid);
			slot.userName = c?.userName || null;
			slot.messageId = c?.messageId || null;
		} else {
			const c = partCandidates(slot.kind).find((x) => x.userId === uid);
			slot.userName = c?.userName || null;
		}
	};

	const revertSlot = (slotKey) => {
		const slot = state.slots.find((s) => s.key === slotKey);
		if (!slot || slot.paidAt || isFinalized()) return;
		if (!isCustomized(slot)) return;
		const defUid = Number(slot.defaultUserId);
		if (!Number.isFinite(defUid) || defUid <= 0) return;
		slot.userId = defUid;
		slot.userName = slot.defaultUserName || null;
		slot.messageId = slot.kind === 'main' ? slot.defaultMessageId || null : null;
		if (slot.kind === 'main' && !slot.messageId) {
			const c = creatorCandidates().find((x) => x.userId === defUid);
			slot.userName = c?.userName || slot.userName;
			slot.messageId = c?.messageId || null;
		}
	};

	const buildPublishBody = () => {
		const winners = [];
		const top_submitters = [];
		const top_voters = [];
		for (const slot of state.slots) {
			if (!(slot.amount > 0) || !slot.userId) continue;
			if (slot.kind === 'main') {
				if (!slot.messageId) continue;
				winners.push({
					place: slot.place,
					message_id: slot.messageId,
					amount: configuredAmountForSlot(slot)
				});
			} else if (slot.kind === 'top_submitters') {
				top_submitters.push({ user_id: slot.userId, amount: configuredAmountForSlot(slot) });
			} else {
				top_voters.push({ user_id: slot.userId, amount: configuredAmountForSlot(slot) });
			}
		}
		winners.sort((a, b) => a.place - b.place);
		return { winners, top_submitters, top_voters };
	};

	const applyServerResults = (results) => {
		config = { ...config, results };
		delete config.results_published_at;
		applyResultsToSlots(results);
		syncUnpaidAmountsFromPrizes();
		captureSavedOrder();
	};

	const saveDraft = async () => {
		setError('');
		if (!isOrderDirty()) return;
		const body = buildPublishBody();
		if (!body.winners.length) {
			setError('At least one place winner is required before saving.');
			return;
		}
		for (const slot of state.slots) {
			if (!(slot.amount > 0) || slot.paidAt) continue;
			if (!slot.userId) {
				setError(`Pick a recipient for ${slot.label} before saving.`);
				return;
			}
			if (slot.kind === 'main' && !slot.messageId) {
				setError('Each place winner needs a challenge submission.');
				return;
			}
		}

		state.busyKey = 'save';
		render();
		try {
			const res = await fetch(publishEndpoint, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...body, save_only: true })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data?.ok !== true) {
				throw new Error(data?.message || data?.error || 'Could not save payout order.');
			}
			if (data.results) applyServerResults(data.results);
			else captureSavedOrder();
			state.busyKey = null;
			render();
		} catch (err) {
			state.busyKey = null;
			render();
			setError(err instanceof Error && err.message ? err.message : 'Could not save payout order.');
		}
	};

	const persistOrder = async () => {
		const body = buildPublishBody();
		if (!body.winners.length) {
			throw new Error('At least one place winner is required before paying.');
		}
		for (const slot of state.slots) {
			if (!(slot.amount > 0) || slot.paidAt) continue;
			if (!slot.userId) {
				throw new Error(`Pick a recipient for ${slot.label} before paying.`);
			}
			if (slot.kind === 'main' && !slot.messageId) {
				throw new Error('Each place winner needs a challenge submission.');
			}
		}
		const res = await fetch(publishEndpoint, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...body, save_only: true })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok !== true) {
			throw new Error(data?.message || data?.error || 'Could not save payout order.');
		}
		if (data.results) applyServerResults(data.results);
		else captureSavedOrder();
	};

	const payAllUnpaid = async () => {
		setError('');
		const count = unpaidCount();
		const total = unpaidTotal();
		if (count <= 0) return;
		if (!slotsReadyToPay()) {
			setError('Set a recipient for every unpaid prize before paying.');
			return;
		}
		const ok = window.confirm(
			`Pay ${count} unpaid prize${count === 1 ? '' : 's'} (${total.toLocaleString()} credits) from the admin account?\n\nEach recipient gets a congratulatory tip notification.`
		);
		if (!ok) return;

		state.busyKey = 'pay-all';
		render();
		try {
			if (!hasDraft() || isOrderDirty()) {
				await persistOrder();
			}
			const res = await fetch(retryEndpoint, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data?.ok !== true) {
				throw new Error(data?.message || data?.error || 'Could not pay prizes.');
			}
			const failed = Array.isArray(data.failed) ? data.failed : [];
			if (data.results) applyServerResults(data.results);
			else captureSavedOrder();
			state.busyKey = null;
			render();
			if (failed.length) {
				setError(
					`Paid ${Number(data.paid) || 0}; ${failed.length} failed${failed[0]?.error ? ` (${failed[0].error})` : ''}.`
				);
			}
		} catch (err) {
			state.busyKey = null;
			render();
			setError(err instanceof Error && err.message ? err.message : 'Could not pay prizes.');
		}
	};

	const finalize = async () => {
		setError('');
		if (unpaidCount() > 0) {
			setError('Pay all prizes before finalizing.');
			return;
		}
		const ok = window.confirm(
			'Finalize this challenge?\n\nIt will move from Pending to Complete.'
		);
		if (!ok) return;
		state.finalizeBusy = true;
		render();
		try {
			const res = await fetch(finalizeEndpoint, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data?.ok !== true) {
				throw new Error(data?.message || data?.error || 'Could not finalize.');
			}
			await ctx.reload();
		} catch (err) {
			state.finalizeBusy = false;
			render();
			setError(err instanceof Error && err.message ? err.message : 'Could not finalize.');
		}
	};

	const onClick = (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;
		const revertBtn = t.closest('[data-results-revert]');
		if (revertBtn instanceof HTMLElement) {
			const key = revertBtn.getAttribute('data-slot-key') || '';
			if (key) {
				revertSlot(key);
				render();
			}
			return;
		}
		if (t.closest('[data-results-save]')) {
			void saveDraft();
			return;
		}
		if (t.closest('[data-results-pay-all]')) {
			void payAllUnpaid();
			return;
		}
		if (t.closest('[data-results-finalize]')) {
			void finalize();
		}
	};

	const onChange = (e) => {
		const t = e.target;
		if (!(t instanceof HTMLSelectElement)) return;
		if (!t.matches('[data-results-user-select]')) return;
		const key = t.getAttribute('data-slot-key') || '';
		assignUserToSlot(key, t.value);
		render();
	};

	const onKeydown = (e) => {
		if (e.key !== 'Enter') return;
		const t = e.target;
		if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) {
			e.preventDefault();
		}
	};

	mountEl.addEventListener('click', onClick);
	mountEl.addEventListener('change', onChange);
	mountEl.addEventListener('keydown', onKeydown);

	mountEl.innerHTML = renderResultsPanelLoadingHtml();
	void (async () => {
		try {
			const res = await fetch(statsEndpoint, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data?.ok !== true) {
				throw new Error(data?.message || 'Could not load challenge stats.');
			}
			state.stats = data;
			if (!mountEl.isConnected) return;
			if (hasDraft() || isFinalized()) {
				applyResultsToSlots(config.results);
				captureSavedOrder();
				syncUnpaidAmountsFromPrizes();
			} else {
				buildDefaultSlots();
				captureSavedOrder();
			}
			render();
		} catch (err) {
			if (!mountEl.isConnected) return;
			if (hasDraft() || isFinalized()) {
				state.stats = null;
				applyResultsToSlots(config.results);
				captureSavedOrder();
				syncUnpaidAmountsFromPrizes();
				render();
			} else {
				mountEl.innerHTML = renderResultsPanelErrorHtml(
					err instanceof Error && err.message ? err.message : 'Could not load challenge stats.'
				);
			}
		}
	})();
}
