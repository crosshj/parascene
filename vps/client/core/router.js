function normalizeRoutePath(pathname) {
	const value = String(pathname || '/').replace(/\/+$/, '');
	return value || '/';
}

export function createRouter({ outlet, routes, onRouteChange }) {
	let disposePage = null;

	async function render() {
		if (typeof disposePage === 'function') disposePage();
		disposePage = null;
		outlet.scrollTop = 0;
		const path = normalizeRoutePath(location.pathname);
		onRouteChange?.({ path, url: new URL(location.href) });
		const handler = routes[path] || routes['*'] || routes['/'];
		const result = await handler({ path });
		disposePage = typeof result === 'function' ? result : null;
		document.querySelectorAll('[data-spa-link]').forEach((link) => {
			const target = normalizeRoutePath(new URL(link.href, location.href).pathname);
			if (target === path) link.setAttribute('aria-current', 'page');
			else link.removeAttribute('aria-current');
		});
		onRouteChange?.({ path, url: new URL(location.href) });
	}

	function onClick(event) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const link = event.target.closest('a[data-spa-link]');
		if (!link || link.target || link.hasAttribute('download')) return;
		const url = new URL(link.href, location.href);
		if (url.origin !== location.origin) return;
		event.preventDefault();
		history.pushState({ parascene: true }, '', url.pathname + url.search + url.hash);
		void render();
	}

	return {
		start() {
			document.addEventListener('click', onClick);
			window.addEventListener('popstate', render);
			void render();
		},
		navigate(path) {
			history.pushState({ parascene: true }, '', path);
			return render();
		},
		destroy() {
			document.removeEventListener('click', onClick);
			window.removeEventListener('popstate', render);
			if (typeof disposePage === 'function') disposePage();
			outlet.replaceChildren();
		}
	};
}
