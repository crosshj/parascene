import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { createFilesApi } from './api.js';

export function createFilesProvider({ viewerId, registry, origin = '' } = {}) {
	const api = createFilesApi(origin);
	const cache = viewerId ? createStorageCache(`prsn-vps-files-v1:${viewerId}`, {
		validate: (data) => Array.isArray(data?.files) && data.files.every((file) => file && typeof file.id === 'string')
	}) : null;
	const lease = viewerId ? registry.acquire(['files', viewerId], () => createQuery({
		key: ['files', viewerId], cache, maxAge: 5 * 60_000,
		load: ({ signal }) => api.list({ signal })
	})) : null;
	const query = lease?.query || null;

	return {
		api,
		query,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		syncExternalCache(event) {
			if (!query || event.key !== `prsn-vps-files-v1:${viewerId}`) return;
			const entry = cache?.read?.();
			if (entry) query.setData(entry.data, { persist: false, updated: entry.updatedAt });
			else void query.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { cache?.clear(); },
	};
}
