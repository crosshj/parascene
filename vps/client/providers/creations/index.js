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

	function mergeRows(rows, { beforePublish } = {}) {
		if (!query?.data?.creations || !Array.isArray(rows) || !rows.length) return query?.data;
		const updates = new Map(rows.map(item => [String(item?.id ?? item?.created_image_id), item]));
		const seen = new Set();
		const merged = [...rows, ...query.data.creations.map(item => updates.get(String(item?.id ?? item?.created_image_id)) || item)]
			.filter(item => {
				const id = String(item?.id ?? item?.created_image_id ?? '');
				if (!id || id === '0' || seen.has(id)) return false;
				seen.add(id);
				return true;
			});
		merged.sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0));
		const next = { ...query.data, creations: merged.slice(0, 50) };
		beforePublish?.(next);
		query.setData(next, { updated: query.getSnapshot().updatedAt });
		return next;
	}

	async function syncPendingRows(options = {}) {
		const ids = [...new Set((pending.read() || [])
			.map(item => Number(item?.id))
			.filter(id => Number.isInteger(id) && id > 0))];
		if (!ids.length) return [];
		if (query && !query.data?.creations) await query.refresh();
		const data = await api.list({ ids });
		const rows = data.creations || [];
		if (rows.length) mergeRows(rows, options);
		return rows;
	}

	return {
		api,
  pending,
		query,
		mergeRows,
		syncPendingRows,
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
