import { createFilesApi } from '../api/files.js';
import { createCreationsApi } from '../api/creations.js';
import { createSidebarApi } from '../api/sidebar.js';
import { createCreditsApi } from '../api/credits.js';
import { createResource } from '../core/resource.js';
import { createResourceRegistry } from '../core/resourceRegistry.js';
import { createStorageCache } from '../core/storageCache.js';

export function createAppResources({ bootstrap = {} } = {}) {
	const viewerId = Number(bootstrap.user?.id) || null;
	const registry = createResourceRegistry();
	const filesApi = createFilesApi(bootstrap.filesOrigin || '');
	const creationsApi = createCreationsApi();
	const sidebarApi = createSidebarApi();
	const creditsApi = createCreditsApi();

	const sidebarCache = viewerId ? createStorageCache(`prsn-vps-sidebar-roster-v1:${viewerId}`, {
		validate: (data) => Number(data?.viewerId) === viewerId && Array.isArray(data.threads) && Array.isArray(data.servers)
	}) : null;
	const sidebarLease = viewerId ? registry.acquire(['sidebar-roster', viewerId], () => createResource({
		key: ['sidebar-roster', viewerId], cache: sidebarCache, maxAge: 45_000,
		load: ({ signal, current }) => sidebarApi.load({ signal, current })
	})) : null;

	const creditsCache = viewerId ? createStorageCache(`prsn-vps-credits-v1:${viewerId}`, {
		validate: (data) => Number(data?.viewerId) === viewerId && Number.isFinite(Number(data.balance))
	}) : null;
	const creditsLease = viewerId ? registry.acquire(['credits', viewerId], () => createResource({
		key: ['credits', viewerId], cache: creditsCache, maxAge: 60_000,
		load: async ({ signal }) => ({ ...(await creditsApi.get({ signal })), viewerId })
	})) : null;

	const filesCache = viewerId ? createStorageCache(`prsn-vps-files-v1:${viewerId}`, {
		validate: (data) => Array.isArray(data?.files) && data.files.every((file) => file && typeof file.id === 'string')
	}) : null;
	const filesLease = viewerId ? registry.acquire(['files', viewerId], () => createResource({
		key: ['files', viewerId], cache: filesCache, maxAge: 5 * 60_000,
		load: ({ signal }) => filesApi.list({ signal })
	})) : null;

	const creationsCache = viewerId ? createStorageCache(`prsn-vps-creations-v1:${viewerId}`, {
		validate: (data) => Array.isArray(data?.creations) && typeof data?.has_more === 'boolean'
	}) : null;
	const creationsLease = viewerId ? registry.acquire(['creations', viewerId], () => createResource({
		key: ['creations', viewerId], cache: creationsCache, maxAge: 30_000,
		load: ({ signal }) => creationsApi.list({ signal })
	})) : null;

	return {
		viewerId, registry,
		filesApi, filesResource: filesLease?.resource || null,
		creationsApi, creationsResource: creationsLease?.resource || null,
		sidebarApi, sidebarResource: sidebarLease?.resource || null,
		creditsApi, creditsResource: creditsLease?.resource || null,
		caches: { sidebarCache, creditsCache, filesCache, creationsCache },
		leases: { sidebarLease, creditsLease, filesLease, creationsLease },
		preload() {
			for (const resource of [sidebarLease?.resource, creditsLease?.resource, filesLease?.resource, creationsLease?.resource]) {
				if (resource) void resource.loadIfNeeded().catch(() => undefined);
			}
		},
		syncExternalCache(event) {
			const targets = [
				[sidebarCache, sidebarLease?.resource, `prsn-vps-sidebar-roster-v1:${viewerId}`],
				[creditsCache, creditsLease?.resource, `prsn-vps-credits-v1:${viewerId}`],
				[filesCache, filesLease?.resource, `prsn-vps-files-v1:${viewerId}`],
				[creationsCache, creationsLease?.resource, `prsn-vps-creations-v1:${viewerId}`],
			];
			for (const [cache, resource, key] of targets) {
				if (!resource || event.key !== key) continue;
				const entry = cache?.read?.();
				if (entry) resource.setData(entry.data, { persist: false, updated: entry.updatedAt });
				else void resource.refresh({ force: true }).catch(() => undefined);
			}
		},
		clearCaches() { Object.values(this.caches).forEach((cache) => cache?.clear()); },
		destroy() { this.registry.clear(); }
	};
}
