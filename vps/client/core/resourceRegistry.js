export function createResourceRegistry() {
	const resources = new Map();
	return {
		acquire(key, create) {
			const id = JSON.stringify(key);
			let entry = resources.get(id);
			if (!entry) {
				entry = { resource: create(), refs: 0 };
				resources.set(id, entry);
			}
			entry.refs++;
			let released = false;
			return {
				resource: entry.resource,
				release() {
					if (released) return;
					released = true;
					entry.refs--;
					if (entry.refs <= 0) {
						entry.resource.destroy?.();
						resources.delete(id);
					}
				}
			};
		},
		clear() { for (const entry of resources.values()) entry.resource.destroy?.(); resources.clear(); }
	};
}
