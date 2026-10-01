export function connectLifecycle({ state, session, providers, router } = {}) {
	let started = false;

	function syncExternalCache(event) {
		providers.syncExternalCache?.(event);
	}

	async function start() {
		if (started) return;
		started = true;
		window.addEventListener('storage', syncExternalCache);
		// Bootstrap already contains the authenticated viewer. Resolve and paint
		// the requested route before a session refresh can delay an overlay deep link.
		// Providers load query data on demand when their owning views mount.
		await router.start();
		await session.initialize();
		state.actions.sessionChanged({ status: 'ready', user: session.user });
	}

	function destroy() {
		if (!started) return;
		started = false;
		window.removeEventListener('storage', syncExternalCache);
		router.destroy();
		session.destroy();
		providers.destroy();
	}

	return { start, destroy };
}
