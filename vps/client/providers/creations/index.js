import { createPendingCreationsStore } from './pending.js';
import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { createCreationsApi } from './api.js';

export function createCreationsProvider({ viewerId, registry } = {}) {
	const api = createCreationsApi();
 const pending = createPendingCreationsStore(viewerId);
	const cache = viewerId ? createStorageCache(`prsn-vps-creations-v1:${viewerId}`, {
		validate: (data) => Array.isArray(data?.creations) && typeof data?.has_more === 'boolean'
	}) : null;
	const lease = viewerId ? registry.acquire(['creations', viewerId], () => createQuery({
		key: ['creations', viewerId], cache, maxAge: 30_000,
		load: ({ signal }) => api.list({ signal })
	})) : null;
	const query = lease?.query || null;

	return {
		api,
  pending,
		query,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		syncExternalCache(event) {
			if (!query || event.key !== `prsn-vps-creations-v1:${viewerId}`) return;
			const entry = cache?.read?.();
			if (entry) query.setData(entry.data, { persist: false, updated: entry.updatedAt });
			else void query.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { cache?.clear(); pending.clear(); },
	};
}
