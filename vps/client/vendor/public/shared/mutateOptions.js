/**
 * Mutate: server list from cache → bundle → background /api/servers.
 */

import { isPublicGenerationServerId } from './generationDefaults.js';
import { getCreateServersPaint, refreshCreateServersFromNetwork } from './createServersCache.js';

export function getMethodIntentList(method) {
	if (Array.isArray(method?.intents)) {
		return method.intents
			.filter(v => typeof v === 'string')
			.map(v => v.trim())
			.filter(Boolean);
	}
	if (typeof method?.intent === 'string') {
		const v = method.intent.trim();
		return v ? [v] : [];
	}
	return [];
}

function normalizeServerConfig(server) {
	if (!server) return null;
	if (server.server_config && typeof server.server_config === 'string') {
		try {
			server.server_config = JSON.parse(server.server_config);
		} catch {
			server.server_config = null;
		}
	}
	return server;
}

function filterMutateServers(servers) {
	return (Array.isArray(servers) ? servers : [])
		.filter(
			(server) =>
				!server.suspended &&
				(isPublicGenerationServerId(server.id) ||
					server.is_owner === true ||
					server.is_member === true)
		)
		.map(normalizeServerConfig)
		.filter(Boolean);
}

/**
 * Load servers available for mutate. Paints from cache or bundled defaults immediately;
 * refreshes from network in the background when there is no cache or the cache TTL expired.
 * @returns {Promise<Array<{ id: number, name?: string, server_config?: object, ... }>>}
 */
export async function loadMutateServerOptions() {
	const paint = getCreateServersPaint();
	const painted = filterMutateServers(paint.servers);
	if (paint.shouldRefresh) {
		void refreshCreateServersFromNetwork().catch(() => {});
	}
	if (painted.length > 0) return painted;
	try {
		const result = await refreshCreateServersFromNetwork();
		if (!result?.ok) return [];
		return filterMutateServers(result.servers);
	} catch {
		return [];
	}
}
