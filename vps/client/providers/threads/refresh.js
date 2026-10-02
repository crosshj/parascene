// An event arriving during a fetch schedules one more fetch, rather than
// aborting the current request or losing that invalidation.
export function createQueryRefresh(query) {
	let active = true;
	let running = false;
	let pending = false;
	async function drain() {
		if (running || !active) return;
		running = true;
		try {
			while (active && pending) {
				pending = false;
				try { await query.refresh(); } catch { /* Query publishes the failure to its consumers. */ }
			}
		} finally { running = false; }
	}
	return {
		request() { if (active) { pending = true; void drain(); } },
		destroy() { active = false; pending = false; },
	};
}
