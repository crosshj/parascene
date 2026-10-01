export function connectLifecycle({ state, session, resources, router } = {}) {
	let started = false;

	function syncExternalCache(event) {
		resources.syncExternalCache?.(event);
	}

	async function start() {
		if (started) return;
		started = true;
		window.addEventListener('storage', syncExternalCache);
		// Bootstrap already contains the authenticated viewer. Resolve and paint
		// the requested route before a session refresh can delay an overlay deep link.
		// Domain resources load on demand when their owning views mount.
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
		resources.destroy();
	}

	return { start, destroy };
}
