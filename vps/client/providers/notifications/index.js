import { createQuery } from '../../core/query.js';
import { createStorageCache } from '../../core/storageCache.js';
import { createNotificationsApi } from './api.js';

export function bellView(data) {
	const known = Number.isFinite(Number(data?.count));
	const count = known ? Math.max(0, Math.floor(Number(data.count))) : 0;
	return {
		known,
		count,
		text: count > 99 ? '99+' : (count > 0 ? String(count) : ''),
		label: count > 0 ? `Notifications, ${count} unread` : 'Notifications',
	};
}

export function createNotificationsProvider({ viewerId, registry, api = createNotificationsApi() } = {}) {
	const lease = viewerId ? registry.acquire(['notifications-unread', viewerId], () => createQuery({
		key: ['notifications-unread', viewerId],
		maxAge: 45_000,
		load: async ({ signal }) => api.unreadCount({ signal }),
	})) : null;
	const query = lease?.query || null;
	const listCache = viewerId ? createStorageCache(`prsn-vps-notifications-v1:${viewerId}`, {
		validate: (data) => Number(data?.viewerId) === viewerId && Array.isArray(data?.notifications),
	}) : null;
	const listLease = viewerId ? registry.acquire(['notifications', viewerId], () => createQuery({
		key: ['notifications', viewerId],
		cache: listCache,
		maxAge: 30_000,
		load: async ({ signal }) => api.list({ signal }),
	})) : null;
	const listQuery = listLease?.query || null;

	function replaceRead(ids) {
		const marked = new Set((Array.isArray(ids) ? ids : [ids]).map(Number));
		const now = new Date().toISOString();
		listQuery?.update((current) => {
			if (!current?.notifications) return current;
			return {
				...current,
				notifications: current.notifications.map((row) => marked.has(Number(row.id)) && !row.acknowledged_at ? { ...row, acknowledged_at: now } : row),
			};
		});
		void query?.refresh({ force: true }).catch(() => undefined);
		if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
	}

	return {
		api,
		query,
		listQuery,
		viewState(snapshot = query?.getSnapshot?.()) { return bellView(snapshot?.data); },
		async acknowledge(id) {
			const result = await api.acknowledge(id);
			if (result?.updated) replaceRead(id);
			return result;
		},
		async acknowledgeAll() {
			const result = await api.acknowledgeAll();
			if (result?.updated) replaceRead((listQuery?.data?.notifications || []).map((row) => row.id));
			return result;
		},
		preload() {
			if (query) void query.loadIfNeeded().catch(() => undefined);
			if (listQuery) void listQuery.loadIfNeeded().catch(() => undefined);
		},
		syncExternalCache(event) {
			if (!listQuery || event?.key !== `prsn-vps-notifications-v1:${viewerId}`) return;
			const entry = listCache?.read?.();
			if (entry) listQuery.setData(entry.data, { persist: false, updated: entry.updatedAt });
			else void listQuery.refresh({ force: true }).catch(() => undefined);
		},
		clearCache() { listCache?.clear(); },
		destroy() { lease?.release(); listLease?.release(); },
	};
}
