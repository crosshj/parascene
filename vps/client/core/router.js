const HISTORY_FLAG = 'parasceneSpa';
const OVERLAY_FLAG = 'parasceneOverlay';
const BACKGROUND_KEY = 'parasceneBackgroundUrl';

function currentUrl() {
	return `${location.pathname}${location.search}${location.hash}`;
}

function pathFor(value) {
	const url = new URL(String(value || '/'), location.origin);
	if (url.origin !== location.origin) throw new Error('Cannot navigate the SPA to another origin');
	return `${url.pathname}${url.search}${url.hash}`;
}

export function createRouter({ routes, state, layout } = {}) {
	let started = false;
	let currentComposition = null;
	const creationSeeds = new Map();

	function historyStateFor(url, backgroundUrl = null) {
		const prior = history.state && typeof history.state === 'object' ? history.state : {};
		const route = routes.match(url);
		if (route.presentation !== 'overlay') {
			const { [BACKGROUND_KEY]: _background, ...base } = prior;
			return { ...base, [HISTORY_FLAG]: true, [OVERLAY_FLAG]: false };
		}
		return {
			...prior,
			[HISTORY_FLAG]: true,
			[OVERLAY_FLAG]: true,
			[BACKGROUND_KEY]: backgroundUrl || route.defaultBackground,
		};
	}

	function backgroundForOverlay(route, { fromHistory = false } = {}) {
		const stored = typeof history.state?.[BACKGROUND_KEY] === 'string' ? history.state[BACKGROUND_KEY] : null;
		if (stored) return stored;
		if (!fromHistory && currentComposition) {
			return currentComposition.overlay ? currentComposition.backgroundUrl : currentComposition.url;
		}
		return route.defaultBackground;
	}

	async function reconcile({ fromHistory = false } = {}) {
		const url = currentUrl();
		const route = routes.match(url);
		const backgroundUrl = route.presentation === 'overlay'
			? backgroundForOverlay(route, { fromHistory })
			: url;
		if (route.presentation === 'overlay' && typeof history.state?.[BACKGROUND_KEY] !== 'string') {
			history.replaceState(historyStateFor(url, backgroundUrl), '', url);
		}
		const seed = route.name === 'creation-detail' ? creationSeeds.get(route.params.creationId) || null : null;
		const composition = routes.resolve({ url, backgroundUrl, seed });
		await layout.apply(composition, { navigate, dismissOverlay });
		currentComposition = composition;
		state.actions.navigationResolved({
			url: composition.url,
			backgroundUrl: composition.backgroundUrl,
			overlay: composition.overlay ? { kind: route.name, params: route.params } : null,
		});
	}

	async function navigate(target, options = {}) {
		const url = pathFor(target);
		const route = routes.match(url);
		let backgroundUrl = null;
		if (route.name === 'creation-detail' && options.seed) creationSeeds.set(route.params.creationId, options.seed);
		if (route.presentation === 'overlay') {
			backgroundUrl = currentComposition?.overlay
				? currentComposition.backgroundUrl
				: currentComposition?.url || route.defaultBackground;
		}
		const method = options.replace ? 'replaceState' : 'pushState';
		history[method](historyStateFor(url, backgroundUrl), '', url);
		return reconcile();
	}

	async function dismissOverlay() {
		if (!currentComposition?.overlay) return;
		const target = currentComposition.backgroundUrl || '/creations';
		history.replaceState(historyStateFor(target), '', target);
		return reconcile();
	}

	function onDocumentClick(event) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const link = event.target.closest?.('a[data-spa-link]');
		if (!link || link.target || link.hasAttribute('download')) return;
		const url = new URL(link.href, location.href);
		if (url.origin !== location.origin) return;
		event.preventDefault();
		void navigate(`${url.pathname}${url.search}${url.hash}`);
	}

	function onPopState() {
		void reconcile({ fromHistory: true });
	}

	function onNavigateRequest(event) {
		const href = event?.detail?.href;
		if (typeof href !== 'string' || !href.trim()) return;
		void navigate(href);
	}

	function onDismissOverlayRequest() {
		void dismissOverlay();
	}

	return {
		async start() {
			if (started) return;
			started = true;
			document.addEventListener('click', onDocumentClick);
			document.addEventListener('parascene:navigate', onNavigateRequest);
			document.addEventListener('parascene:dismiss-overlay', onDismissOverlayRequest);
			window.addEventListener('popstate', onPopState);
			await reconcile({ fromHistory: true });
		},
		navigate,
		dismissOverlay,
		destroy() {
			if (!started) return;
			started = false;
			document.removeEventListener('click', onDocumentClick);
			document.removeEventListener('parascene:navigate', onNavigateRequest);
			document.removeEventListener('parascene:dismiss-overlay', onDismissOverlayRequest);
			window.removeEventListener('popstate', onPopState);
			layout.destroy();
			currentComposition = null;
			creationSeeds.clear();
		},
	};
}
