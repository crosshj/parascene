import { importCreationMedia } from './imports.js';
import { createCreationWorkflow } from './workflow.js';
import { submitCreationWithPending, importCreationWithPending, uploadImageFile, formatMentionsFailureForDialog } from './transport.js';
import { getMutateLineageForImageUrls, syncSavedCreateImagesToQueue, syncCreationDetailToAdvancedCreate } from '../../shared/mutateQueueSync.js';
import { createCreateApi } from './api.js';
import { getSavedCreateDraftStore, persistSavedCreateForm } from '../../shared/createSettingsSync.js';
/**
 * Create/mutate server list: cache → bundled defaults → background network.
 */

import {
	CREATE_SERVERS_CACHE_KEY,
	DEFAULT_CREATE_SERVERS,
} from './defaults.js';
import { isPublicGenerationServerId } from '../../shared/generationDefaults.js';

export function createCreateProvider({ viewerId } = {}) {
const api = createCreateApi();
const store = getSavedCreateDraftStore();
store.read();
const draft = {
 read: store.read,
 update(change, options) {
  const before = JSON.stringify(store.read().inputImages);
  const result = persistSavedCreateForm(change, options);
  if (before !== JSON.stringify(result.inputImages)) syncSavedCreateImagesToQueue();
  return result;
 },
 subscribe: store.subscribe,
};
function makeWorkflow() {
 return createCreationWorkflow({ draft, request: api.request, send: submitCreationWithPending,
  upload: uploadImageFile, importSend: importCreationWithPending, importer: importCreationMedia,
  restoreRecipe: syncCreationDetailToAdvancedCreate, lineage: getMutateLineageForImageUrls, formatMentions: formatMentionsFailureForDialog });
}
let workflow = makeWorkflow();
const composer = {
 read() {
  const saved = store.read();
  return { ...(saved.composerSettings || {}), outputMode: saved.outputMode || 'image' };
 },
 edit(change = {}) {
  const current = store.read().composerSettings || {};
  const next = { ...current, ...change };
  if (change.modelRoutes && typeof change.modelRoutes === 'object') {
   next.modelRoutes = { ...(current.modelRoutes || {}), ...change.modelRoutes };
  }
  const { outputMode, ...settings } = next;
  return workflow.edit({ composerSettings: settings, ...(outputMode ? { outputMode } : {}) });
 },
};
let generation = 0;
const cacheKey = `${CREATE_SERVERS_CACHE_KEY}:vps:${viewerId || "anonymous"}`;
const CREATE_SERVERS_CACHE_TTL_MS = 15 * 60 * 1000;

/** @param {unknown} rawServers */
function processCreateServers(rawServers) {
	let list = Array.isArray(rawServers) ? rawServers : [];
	list = list.filter(
		(server) =>
			!server?.suspended &&
			(isPublicGenerationServerId(server.id) ||
				server.id === 1 ||
				server.is_owner === true ||
				server.is_member === true)
	);
	return list.map((server) => {
		const s = { ...server };
		if (s.server_config && typeof s.server_config === 'string') {
			try {
				s.server_config = JSON.parse(s.server_config);
			} catch {
				s.server_config = null;
			}
		}
		return s;
	});
}

function serversListSame(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	return a.every((s, i) => {
		const t = b[i];
		if (s?.id !== t?.id || s?.name !== t?.name) return false;
		return JSON.stringify(s?.server_config ?? null) === JSON.stringify(t?.server_config ?? null);
	});
}

function storage() {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

/** @returns {{ servers: object[], cachedAt: number } | null} */
function readCreateServersCache() {
	try {
		const raw = storage()?.getItem(cacheKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed?.servers) || parsed.servers.length === 0) return null;
		return {
			servers: parsed.servers,
			cachedAt: Number(parsed.cachedAt) || 0,
		};
	} catch {
		return null;
	}
}

/** @param {object[]} servers */
function writeCreateServersCache(servers) {
	if (!Array.isArray(servers) || servers.length === 0) return;
	try {
		storage()?.setItem(
			cacheKey,
			JSON.stringify({ servers, cachedAt: Date.now() })
		);
	} catch {
		// ignore
	}
}

function clearCreateServersCache() {
 generation++;
	try {
		storage()?.removeItem(cacheKey);
	} catch {
		// ignore
	}
}

function isCreateServersCacheExpired(cachedAt) {
	return Date.now() - Number(cachedAt || 0) > CREATE_SERVERS_CACHE_TTL_MS;
}

/**
 * Synchronous first paint. Never waits on the network.
 * @returns {{ servers: object[], source: 'cache' | 'bundle' | null, shouldRefresh: boolean }}
 */
function getCreateServersPaint() {
	const cached = readCreateServersCache();
	if (cached) {
		return {
			servers: cached.servers,
			source: 'cache',
			shouldRefresh: isCreateServersCacheExpired(cached.cachedAt),
		};
	}
	if (Array.isArray(DEFAULT_CREATE_SERVERS) && DEFAULT_CREATE_SERVERS.length > 0) {
		return {
			servers: JSON.parse(JSON.stringify(DEFAULT_CREATE_SERVERS)),
			source: 'bundle',
			shouldRefresh: true,
		};
	}
	return { servers: [], source: null, shouldRefresh: true };
}

let inflightRefresh = null;

/**
 * @returns {Promise<{ ok: boolean, servers: object[] }>}
 */
async function refreshCreateServersFromNetwork() {
	if (inflightRefresh) return inflightRefresh;
	inflightRefresh = (async () => {
		const requestGeneration = generation;
		const result = await api.servers();
		if (requestGeneration !== generation) return { ok: false, servers: [] };
		if (!result?.ok || !Array.isArray(result.data?.servers)) {
			return { ok: false, servers: [] };
		}
		const processed = processCreateServers(result.data.servers);
		if (processed.length > 0) writeCreateServersCache(processed);
		return { ok: true, servers: processed };
	})();
	try {
		return await inflightRefresh;
	} finally {
		inflightRefresh = null;
	}
}

return {
 api,
 draft,
 composer,
 get workflow() { return workflow; },
 getCreateServersPaint,
 refreshCreateServersFromNetwork,
 processCreateServers,
 serversListSame,
 clearCreateServersCache,
 preload() {},
 syncExternalCache() {},
 clearCache() {
  workflow.destroy();
  workflow = makeWorkflow();
  store.clear();
  syncSavedCreateImagesToQueue();
  clearCreateServersCache();
 },
 destroy() { workflow.destroy(); generation++; },
};
}
