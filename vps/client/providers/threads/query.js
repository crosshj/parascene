import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { mergeThreadsInbox } from './model.js';

// Real inbox data must not reuse the earlier mock roster snapshot.
const CACHE_PREFIX = 'prsn-vps-threads-inbox-v3';
const MESSAGE_CACHE_PREFIX = 'prsn-vps-thread-messages-v1';
const MESSAGE_CACHE_LIMIT = 8;
const MESSAGE_PAGE_LIMIT = 40;

function createPublicThreadMessageCache(viewerId, threadId) {
	const baseKey = `${MESSAGE_CACHE_PREFIX}:${viewerId}`;
	const cacheKey = `${baseKey}:${threadId}`;
	const cache = createStorageCache(cacheKey, {
		validate: (data) => Array.isArray(data?.messages) && data.messages.length <= MESSAGE_PAGE_LIMIT
			&& data.messages.every((message) => Number.isFinite(Number(message?.id)))
	});
	function touch() {
		try {
			const storage = localStorage;
			const indexKey = `${baseKey}:index`;
			const previous = JSON.parse(storage.getItem(indexKey) || '[]');
			const ids = Array.isArray(previous) ? previous.filter((id) => /^\d+$/.test(String(id)) && Number(id) !== Number(threadId)) : [];
			ids.push(String(threadId));
			while (ids.length > MESSAGE_CACHE_LIMIT) storage.removeItem(`${baseKey}:${ids.shift()}`);
			storage.setItem(indexKey, JSON.stringify(ids));
		} catch { /* Browser storage is an optional warm cache. */ }
	}
	return {
		read() { const entry = cache.read(); if (entry) touch(); return entry; },
		write(entry) {
			let data = entry.data;
			if (data.messages.length > MESSAGE_PAGE_LIMIT) {
				const messages = data.messages.slice(-MESSAGE_PAGE_LIMIT);
				const first = messages[0];
				let nextBefore = data.nextBefore;
				if (first?.created_at && Number.isFinite(Number(first.id))) {
					const cursor = btoa(JSON.stringify({ c: first.created_at, i: Number(first.id) }));
					nextBefore = cursor.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
				}
				data = { ...data, messages, hasMore: true, nextBefore };
			}
			cache.write({ ...entry, data }); touch();
		},
		clear() { cache.clear(); }
	};
}

export function clearThreadMessagesCache(viewerId) {
	if (!viewerId) return;
	try {
		const prefix = `${MESSAGE_CACHE_PREFIX}:${Number(viewerId)}`;
		const storage = localStorage;
		const indexKey = `${prefix}:index`;
		const ids = JSON.parse(storage.getItem(indexKey) || '[]');
		if (Array.isArray(ids)) for (const id of ids) storage.removeItem(`${prefix}:${id}`);
		storage.removeItem(indexKey);
	} catch { /* Browser storage is optional. */ }
}

export function createThreadsInboxQuery({ viewerId, api } = {}) {
	const cacheKey = `${CACHE_PREFIX}:${viewerId}`;
	const cache = createStorageCache(cacheKey, {
		validate: (data) => Number(data?.viewerId) === viewerId && Array.isArray(data.threads) && Array.isArray(data.servers)
	});
	const query = createQuery({
		key: ['threads-inbox', viewerId], cache, maxAge: 45_000,
		load: async ({ signal, current }) => mergeThreadsInbox(await api.loadInbox({ signal }), current)
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

export function createThreadMessagesQuery({ threadId, api, registry, viewerId, persist = false } = {}) {
	const create = () => {
		let query;
		query = createQuery({
		key: ['thread-messages', Number(threadId)],
		cache: persist && viewerId ? createPublicThreadMessageCache(Number(viewerId), Number(threadId)) : undefined,
		maxAge: 0,
		load: async ({ signal, current }) => {
			const initialIds = new Set((current?.messages || []).map((row) => Number(row.id)));
			let page = await api.loadMessages(threadId, { signal });
			const loadedIds = (current?.messages || []).map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
			const previousOldest = loadedIds.length ? Math.min(...loadedIds) : 0;
			// Refresh the loaded range, including older reaction/edit/delete changes.
			while (previousOldest && page.hasMore && page.nextBefore && Number(page.messages[0]?.id) > previousOldest) {
				const cursor = page.nextBefore;
				const previous = await api.loadMessages(threadId, { signal, before: cursor });
				if (previous.hasMore && previous.nextBefore === cursor) throw new Error('Message history cursor did not advance');
				page = { ...previous, messages: [...previous.messages, ...page.messages] };
			}
			// History loads and send responses can publish while this fetch runs.
			// Merge against that live query state rather than its starting snapshot.
			const live = query.data || current;
			const firstId = Number(page.messages[0]?.id) || 0;
			const latestId = Math.max(0, ...page.messages.map((row) => Number(row.id)));
			const older = (live?.messages || []).filter((row) => firstId && Number(row.id) < firstId);
			const addedDuringFetch = (live?.messages || []).filter((row) => Number(row.id) > latestId && !initialIds.has(Number(row.id)));
			return { ...(older.length ? live : page), messages: [...older, ...page.messages, ...addedDuringFetch] };
		},
		});
		return query;
	};
	return registry
		? registry.acquire(['thread-messages', Number(threadId)], create)
		: { query: create(), release() {} };
}
