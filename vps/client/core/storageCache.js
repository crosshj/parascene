export function createStorageCache(key, { storage = () => localStorage, version = 1, validate = () => true } = {}) {
	return {
		read() {
			try {
				const value = JSON.parse(storage()?.getItem(key) || 'null');
				if (!value || value.version !== version || !Number.isFinite(value.updatedAt) || !validate(value.data)) return null;
				return value;
			} catch { return null; }
		},
		write({ data, updatedAt = Date.now() }) {
			try { storage()?.setItem(key, JSON.stringify({ version, updatedAt, data })); } catch { /* Quota/private browsing: cache is optional. */ }
		},
		clear() { try { storage()?.removeItem(key); } catch { /* Optional cache. */ } }
	};
}
