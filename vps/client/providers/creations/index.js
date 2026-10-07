import { createPendingCreationsStore } from './pending.js';
import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { createCreationsApi } from './api.js';
import { createCreationThumbnails } from './thumbnails.js';

const IN_FLIGHT_STATUSES = new Set(['creating', 'pending', 'queued', 'processing', 'running']);

function creationKey(row) {
	const id = Number(row?.id ?? row?.created_image_id);
	return Number.isInteger(id) && id > 0 ? String(id) : '';
}

function isInFlight(row) {
	return IN_FLIGHT_STATUSES.has(String(row?.status || '').toLowerCase());
}

function rowKey(row) {
	if (String(row?.id).startsWith('pending-')) return String(row.id);
	return creationKey(row);
}

function rowToken(row) {
	if (typeof row?.creation_token === 'string' && row.creation_token.trim()) return row.creation_token.trim();
	let meta = row?.meta;
	if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
	return typeof meta?.creation_token === 'string' ? meta.creation_token.trim() : '';
}

export function createCreationsProvider({ viewerId, registry } = {}) {
	const api = createCreationsApi();
 const removedIds = new Set();
 let destroyed = false;
	const thumbnails = createCreationThumbnails({ viewerId });
 const pending = createPendingCreationsStore(viewerId);
	const cache = viewerId ? createStorageCache(`prsn-vps-creations-v1:${viewerId}`, {
		validate: (data) => Array.isArray(data?.creations) && typeof data?.has_more === 'boolean'
	}) : null;
	const lease = viewerId ? registry.acquire(['creations', viewerId], () => createQuery({
		key: ['creations', viewerId], cache, maxAge: 30_000,
		load: async ({ signal }) => {
			const data = await api.list({ signal });
			const assembled = assembleCreations(data.creations, { hasMore: data.has_more });
			return { ...data, ...assembled };
		}
	})) : null;
	const query = lease?.query || null;

	// The list response is allowed to omit a creation the database does not have yet.
	// Optimistic rows stay queued until a later read returns the server row; that
	// row is what moves the card to generating.
	function assembleCreations(serverRows, { hasMore = false } = {}) {
		const seenIds = new Set();
		const seenTokens = new Set();
		const creations = [];
		const push = (row) => {
			const id = rowKey(row);
			const token = rowToken(row);
			if (!id || removedIds.has(id) || seenIds.has(id)) return;
			if (token && seenTokens.has(token)) return;
			seenIds.add(id);
			if (token) seenTokens.add(token);
			creations.push(row);
		};
		for (const row of serverRows || []) if (!row?.__optimistic) push(row);
		for (const row of query?.data?.creations || []) {
			if (row?.__optimistic || !isInFlight(row)) continue;
			push(row);
		}
		for (const row of pending.reconcile(creations)) push(row);
		creations.sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0));
		const page = creations.slice(0, 50);
		return { creations: page, has_more: Boolean(hasMore) || creations.length > page.length };
	}

	function publishAssembled(serverRows, { hasMore = false, beforePublish } = {}) {
		if (!query) return null;
		const assembled = assembleCreations(serverRows, { hasMore });
		const next = { ...(query.data || {}), ...assembled };
		beforePublish?.(next);
		query.setData(next, { updated: query.data ? query.getSnapshot().updatedAt : Date.now() });
		return next;
	}

	function mergeRows(rows, { beforePublish } = {}) {
		if (!query || !Array.isArray(rows) || !rows.length) return query?.data;
		const byId = new Map();
		for (const row of query.data?.creations || []) {
			if (row?.__optimistic) continue;
			const id = rowKey(row);
			if (id) byId.set(id, row);
		}
		for (const row of rows) {
			const id = rowKey(row);
			if (!id || removedIds.has(id)) continue;
			byId.set(id, { ...row, __optimistic: false });
		}
		return publishAssembled([...byId.values()], { hasMore: query.data?.has_more === true, beforePublish });
	}

	async function syncPendingRows(options = {}) {
		const ids = [...new Set((pending.read() || [])
			.map(item => Number(item?.id))
			.filter(id => Number.isInteger(id) && id > 0))];
		if (!ids.length) return [];
		if (query && !query.data?.creations) await query.refresh();
		const data = await api.list({ ids });
		const rows = data.creations || [];
		// An empty read means the database does not have the row yet. Leave the
		// optimistic card in place; a later read is what replaces it.
		if (rows.length) mergeRows(rows, options);
		return rows;
	}

	function onPendingUpdated() {
		if (destroyed || !query) return;
		const serverRows = (query.data?.creations || []).filter(row => !row.__optimistic);
		publishAssembled(serverRows, { hasMore: query.data?.has_more === true });
		void syncPendingRows().catch(() => undefined);
	}

 function onMutation(event) {
  const reason = event.detail?.reason;
  if (reason !== 'deleted' && reason !== 'ungrouped') return;
  const id = String(event.detail.creationId);
  removedIds.add(id);
  // Let a mounted grid reconcile its paginated rows before publishing the cached first page.
  queueMicrotask(() => {
   if (destroyed || !query) return;
   if (query.data?.creations?.some(row => String(row.id) === id)) {
    query.setData({ ...query.data, creations: query.data.creations.filter(row => String(row.id) !== id) });
   }
   // Ungroup restores archived source rows, so re-read the server-owned list.
   if (reason === 'ungrouped') void query.refresh({ force: true }).catch(() => undefined);
  });
 }
 if (typeof document !== 'undefined') {
		document.addEventListener('creation-detail:mutation', onMutation);
		document.addEventListener('creations-pending-updated', onPendingUpdated);
	}

	return {
		api,
		thumbnails,
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
		clearCache() { cache?.clear(); pending.clear(); void thumbnails.clearCache(); },
		destroy() {
			destroyed = true;
			if (typeof document !== 'undefined') {
				document.removeEventListener('creation-detail:mutation', onMutation);
				document.removeEventListener('creations-pending-updated', onPendingUpdated);
			}
			thumbnails.destroy();
		},
	};
}
