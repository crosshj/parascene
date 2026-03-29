/**
 * Mutate: server list from API; default server/method in ./generationDefaults.js.
 */

const _qs = (() => {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();
const { fetchJsonWithStatusDeduped } = await import(`./api.js${_qs}`);

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

/**
 * Load servers available for mutate (same filter as creation edit: id 1 or is_owner or is_member, not suspended).
 * @returns {Promise<Array<{ id: number, name?: string, server_config?: object, ... }>>}
 */
export async function loadMutateServerOptions() {
	try {
		const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
		if (!result?.ok) return [];
		const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
		return servers
			.filter(server => !server.suspended && (server.id === 1 || server.is_owner === true || server.is_member === true))
			.map(normalizeServerConfig)
			.filter(Boolean);
	} catch {
		return [];
	}
}
