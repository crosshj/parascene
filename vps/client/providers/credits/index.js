import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { createCreditsApi } from './api.js';

export function createCreditsProvider({ viewerId, registry } = {}) {
	const api = createCreditsApi();
	const cache = viewerId ? createStorageCache(`prsn-vps-credits-v1:${viewerId}`, {
		validate: (data) => Number(data?.viewerId) === viewerId && Number.isFinite(Number(data.balance))
	}) : null;
	const lease = viewerId ? registry.acquire(['credits', viewerId], () => createQuery({
		key: ['credits', viewerId], cache, maxAge: 60_000,
		load: async ({ signal }) => ({ ...(await api.get({ signal })), viewerId })
	})) : null;
	const query = lease?.query || null;

	return {
		api,
		query,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		syncExternalCache(event) {
			if (!query || event.key !== `prsn-vps-credits-v1:${viewerId}`) return;
			const entry = cache?.read?.();
			if (entry) query.setData(entry.data, { persist: false, updated: entry.updatedAt });
			else void query.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { cache?.clear(); },
	};
}
