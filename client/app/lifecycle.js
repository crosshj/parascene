export function connectLifecycle({ state, session, providers, router } = {}) {
	let started = false;
	let unsubscribeNavigation = null;

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
		providers.presence?.start();
		let lastNavigation = state.get?.().navigation;
		unsubscribeNavigation = state.subscribe?.((next) => {
			if (next.navigation && next.navigation !== lastNavigation) providers.presence?.markActivity();
			lastNavigation = next.navigation;
		});
		await session.initialize();
		state.actions.sessionChanged({ status: 'ready', user: session.user });
	}

	function destroy() {
		if (!started) return;
		started = false;
		unsubscribeNavigation?.();
		unsubscribeNavigation = null;
		window.removeEventListener('storage', syncExternalCache);
		router.destroy();
		session.destroy();
		providers.destroy();
	}

	return { start, destroy };
}
