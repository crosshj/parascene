export function createQueryRegistry() {
	const queries = new Map();
	return {
		acquire(key, create) {
			const id = JSON.stringify(key);
			let entry = queries.get(id);
			if (!entry) {
				entry = { query: create(), refs: 0 };
				queries.set(id, entry);
			}
			entry.refs++;
			let released = false;
			return {
				query: entry.query,
				release() {
					if (released) return;
					released = true;
					entry.refs--;
					if (entry.refs <= 0) {
						entry.query.destroy?.();
						queries.delete(id);
					}
				}
			};
		},
		clear() { for (const entry of queries.values()) entry.query.destroy?.(); queries.clear(); }
	};
}
