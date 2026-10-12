import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { formatCredits } from '../../utils/format.js';
import { createCreditsApi } from './api.js';
import { claimedOnUtcDay, creditsControlLabel, dailyClaimAvailable, msUntilNextUtcDay, settleCredits } from './dailyClaim.js';

export function createCreditsProvider({ viewerId, registry } = {}) {
	const api = createCreditsApi();
	const cache = viewerId ? createStorageCache(`prsn-vps-credits-v1:${viewerId}`, {
		validate: (data) => Number(data?.viewerId) === viewerId && Number.isFinite(Number(data.balance))
	}) : null;
	const lease = viewerId ? registry.acquire(['credits', viewerId], () => createQuery({
		key: ['credits', viewerId], cache, maxAge: 60_000,
		// Settle after the await so a claim that lands mid-fetch is not overwritten by the older response.
		load: async ({ signal }) => settleCredits({ ...(await api.get({ signal })), viewerId }, query?.data)
	})) : null;
	const query = lease?.query || null;
	let claimTimer = 0;

	function armClaimRefresh() {
		clearTimeout(claimTimer);
		if (!query) return;
		claimTimer = setTimeout(() => {
			claimTimer = 0;
			void query.refresh({ force: true }).catch(() => undefined).finally(armClaimRefresh);
		}, msUntilNextUtcDay() + 250);
	}

	function onClaimed(event) {
		if (!query) return;
		const detail = event?.detail || {};
		const lastClaimDate = detail.lastClaimDate || new Date().toISOString();
		query.update((current) => settleCredits({
			...current,
			balance: Number.isFinite(Number(detail.balance)) ? Number(detail.balance) : current?.balance,
			lastClaimDate,
			canClaim: false,
			viewerId,
		}, current));
	}

	function onVisible() {
		if (typeof document === 'undefined' || document.visibilityState !== 'visible' || !query?.data) return;
		const data = query.data;
		if (dailyClaimAvailable(data) || claimedOnUtcDay(data.lastClaimDate)) return;
		if (data.canClaim === false && data.lastClaimDate) void query.refresh({ force: true }).catch(() => undefined);
	}

	if (query && typeof document !== 'undefined') {
		document.addEventListener('credits-claimed', onClaimed);
		document.addEventListener('visibilitychange', onVisible);
		armClaimRefresh();
	}

	function viewState(snapshot = query?.getSnapshot?.()) {
		const data = snapshot?.data;
		const known = Boolean(data);
		const balanceText = known ? formatCredits(data.balance) : '';
		const claimAvailable = dailyClaimAvailable(data);
		return {
			known,
			balanceText,
			claimAvailable,
			label: creditsControlLabel(known ? balanceText : '', claimAvailable),
		};
	}

	return {
		api,
		query,
		viewState,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		syncExternalCache(event) {
			if (!query || event.key !== `prsn-vps-credits-v1:${viewerId}`) return;
			const entry = cache?.read?.();
			if (entry) query.setData(settleCredits(entry.data, query.data), { persist: false, updated: entry.updatedAt });
			else void query.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { cache?.clear(); },
		destroy() {
			clearTimeout(claimTimer);
			claimTimer = 0;
			if (typeof document === 'undefined') return;
			document.removeEventListener('credits-claimed', onClaimed);
			document.removeEventListener('visibilitychange', onVisible);
		},
	};
}
