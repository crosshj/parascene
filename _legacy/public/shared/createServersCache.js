/**
 * Create/mutate server list: cache → bundled defaults → background network.
 */

import {
	CREATE_SERVERS_CACHE_KEY,
	DEFAULT_CREATE_SERVERS,
} from './createServersDefault.js';
import { isPublicGenerationServerId } from './generationDefaults.js';

export const CREATE_SERVERS_CACHE_TTL_MS = 15 * 60 * 1000;

/** @param {unknown} rawServers */
export function processCreateServers(rawServers) {
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

export function serversListSame(a, b) {
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
export function readCreateServersCache() {
	try {
		const raw = storage()?.getItem(CREATE_SERVERS_CACHE_KEY);
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
export function writeCreateServersCache(servers) {
	if (!Array.isArray(servers) || servers.length === 0) return;
	try {
		storage()?.setItem(
			CREATE_SERVERS_CACHE_KEY,
			JSON.stringify({ servers, cachedAt: Date.now() })
		);
	} catch {
		// ignore
	}
}

export function clearCreateServersCache() {
	try {
		storage()?.removeItem(CREATE_SERVERS_CACHE_KEY);
	} catch {
		// ignore
	}
}

export function isCreateServersCacheExpired(cachedAt) {
	return Date.now() - Number(cachedAt || 0) > CREATE_SERVERS_CACHE_TTL_MS;
}

/**
 * Synchronous first paint. Never waits on the network.
 * @returns {{ servers: object[], source: 'cache' | 'bundle' | null, shouldRefresh: boolean }}
 */
export function getCreateServersPaint() {
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
export async function refreshCreateServersFromNetwork() {
	if (inflightRefresh) return inflightRefresh;
	inflightRefresh = (async () => {
		const { fetchJsonWithStatusDeduped } = await import('./api.js');
		const result = await fetchJsonWithStatusDeduped(
			'/api/servers',
			{ credentials: 'include' },
			{ windowMs: 2000 }
		);
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
