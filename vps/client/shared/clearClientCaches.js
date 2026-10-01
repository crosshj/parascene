/**
 * Hard reset of Cache Storage, SW, local/session storage, IndexedDB (best-effort).
 * Used from account menu and mobile header menu.
 */
export async function hardResetClientCaches() {
	// Ask active SW to clear its own named caches and metadata first.
	try {
		if (navigator.serviceWorker?.controller) {
			navigator.serviceWorker.controller.postMessage({
				type: 'PRSN_SW_INVALIDATE',
				all: true
			});
		}
	} catch {
		// ignore
	}

	// Clear Cache Storage buckets.
	try {
		const keys = await caches.keys();
		await Promise.all(keys.map((key) => caches.delete(key)));
	} catch {
		// ignore
	}

	// Unregister service workers so next load starts clean.
	try {
		if (navigator.serviceWorker?.getRegistrations) {
			const regs = await navigator.serviceWorker.getRegistrations();
			await Promise.all(regs.map((reg) => reg.unregister()));
		}
	} catch {
		// ignore
	}

	// Best-effort local/session state reset.
	try {
		window.localStorage?.clear();
	} catch {
		// ignore
	}
	try {
		window.sessionStorage?.clear();
	} catch {
		// ignore
	}

	// Best-effort IndexedDB wipe for debugging sanity checks.
	try {
		if (window.indexedDB?.databases && typeof window.indexedDB.deleteDatabase === 'function') {
			const dbs = await window.indexedDB.databases();
			await Promise.all(
				(dbs || [])
					.map((db) => (typeof db?.name === 'string' ? db.name : ''))
					.filter(Boolean)
					.map(
						(name) =>
							new Promise((resolve) => {
								try {
									const req = window.indexedDB.deleteDatabase(name);
									req.onsuccess = () => resolve();
									req.onerror = () => resolve();
									req.onblocked = () => resolve();
								} catch {
									resolve();
								}
							})
					)
			);
		}
	} catch {
		// ignore
	}
}

const CONFIRM_CLEAR =
	'Clear all local caches and storage, unregister service workers, and reload now?';

export async function confirmAndHardReloadAfterClearingCaches() {
	const ok = window.confirm(CONFIRM_CLEAR);
	if (!ok) return;
	await hardResetClientCaches();
	const current = new URL(window.location.href);
	current.searchParams.set('cache_reset', String(Date.now()));
	window.location.replace(current.toString());
}
