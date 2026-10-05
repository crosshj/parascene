import { createQuery } from '../../core/query.js';

// App-local, viewer-scoped data. Never persist private profile responses to disk.
export function createProfileProvider({ fetcher = (...args) => fetch(...args) } = {}) {
	const queries = new Map();
	function query(url) {
		if (!queries.has(url)) queries.set(url, createQuery({ key: ['profile', url], load: async ({ signal }) => {
			const response = await fetcher(url, { credentials: 'include', signal });
			const data = await response.json().catch(() => null);
			if (!response.ok) throw Object.assign(new Error('Profile request failed'), { status: response.status, data });
			return { ok: true, status: response.status, data };
		} }));
		return queries.get(url);
	}
	return {
		query,
		async read(url) {
			const resource = query(url);
			if (resource.data !== undefined) {
				void resource.refresh().catch(() => undefined);
				return structuredClone(resource.data);
			}
			try { return structuredClone(await resource.refresh()); }
			catch (error) { if (error.name === 'AbortError') throw error; return { ok: false, status: error.status || 0, data: error.data || null }; }
		},
		preload() {}, syncExternalCache() {},
		invalidate() { for (const resource of queries.values()) void resource.refresh({ force: true }).catch(() => undefined); },
		clearCache() { for (const resource of queries.values()) resource.destroy(); queries.clear(); },
		destroy() { this.clearCache(); },
	};
}
