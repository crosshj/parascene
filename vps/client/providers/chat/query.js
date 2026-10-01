import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { mergeChatInbox } from './model.js';

// Keep the existing persisted key so the provider reuses current users' inbox snapshot.
const CACHE_PREFIX = 'prsn-vps-sidebar-roster-v1';

export function createChatInboxQuery({ viewerId, api } = {}) {
	const cacheKey = `${CACHE_PREFIX}:${viewerId}`;
	const cache = createStorageCache(cacheKey, {
		validate: (data) => Number(data?.viewerId) === viewerId && Array.isArray(data.threads) && Array.isArray(data.servers)
	});
	const query = createQuery({
		key: ['chat-inbox', viewerId], cache, maxAge: 45_000,
		load: async ({ signal, current }) => mergeChatInbox(await api.loadInbox({ signal }), current)
	});

	return {
		query,
		syncExternalCache(event) {
			if (event.key !== cacheKey) return;
			const entry = cache.read();
			if (entry) query.setData(entry.data, { persist: false, updated: entry.updatedAt });
			else void query.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { cache.clear(); }
	};
}
