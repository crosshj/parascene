const HISTORY_FLAG = 'parasceneSpa';
const OVERLAY_FLAG = 'parasceneOverlay';
const BACKGROUND_KEY = 'parasceneBackgroundUrl';
const RETURN_OVERLAY_KEY = 'parasceneReturnOverlayUrl';
const PREVIOUS_CREATION_KEY = 'parascenePreviousCreationUrl';

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
	let activeDialog = null;
	const creationSeeds = new Map();

	function historyStateFor(url, backgroundUrl = null, previousCreationUrl = null) {
		const prior = history.state && typeof history.state === 'object' ? history.state : {};
		const route = routes.match(url);
		if (route.presentation !== 'overlay') {
			const { [RETURN_OVERLAY_KEY]: _returnOverlay, [BACKGROUND_KEY]: _background, [PREVIOUS_CREATION_KEY]: _previousCreation, ...base } = prior;
			return { ...base, [HISTORY_FLAG]: true, [OVERLAY_FLAG]: false };
		}
		const { [PREVIOUS_CREATION_KEY]: _previousCreation, ...base } = prior;
		return {
			...base,
			[HISTORY_FLAG]: true,
			[OVERLAY_FLAG]: true,
			[BACKGROUND_KEY]: backgroundUrl || route.defaultBackground,
			...(previousCreationUrl ? { [PREVIOUS_CREATION_KEY]: previousCreationUrl } : {}),
		};
	}

	function backgroundForOverlay(route, { fromHistory = false, initial = false } = {}) {
		if (initial && route.restoreBackgroundOnLoad === false) return route.defaultBackground;
		const stored = typeof history.state?.[BACKGROUND_KEY] === 'string' ? history.state[BACKGROUND_KEY] : null;
		if (stored) return stored;
		if (!fromHistory && currentComposition) {
			return currentComposition.overlay ? currentComposition.backgroundUrl : currentComposition.url;
		}
		return route.defaultBackground;
	}

	async function reconcile({ fromHistory = false, initial = false } = {}) {
		const url = currentUrl();
		const route = routes.match(url);
		const backgroundUrl = route.presentation === 'overlay'
			? backgroundForOverlay(route, { fromHistory, initial })
			: url;
		if (route.presentation === 'overlay' && history.state?.[BACKGROUND_KEY] !== backgroundUrl) {
			history.replaceState(historyStateFor(url, backgroundUrl), '', url);
		}
		const seed = route.params.creationId ? creationSeeds.get(route.params.creationId) || null : null;
		const composition = routes.resolve({ url, backgroundUrl, seed });
		await layout.apply(composition, { navigate, dismissOverlay, backOverlay });
		currentComposition = composition;
		state.actions.navigationResolved({
			url: composition.url,
			backgroundUrl: composition.backgroundUrl,
			overlay: composition.overlay ? { path: route.path, params: route.params } : null,
		});
	}

	async function navigate(target, options = {}) {
		const url = pathFor(target);
		const route = routes.match(url);
		let backgroundUrl = null;
		if (route.presentation === 'overlay' && route.params.creationId && options.seed) creationSeeds.set(route.params.creationId, options.seed);
		if (route.presentation === 'overlay') {
			backgroundUrl = currentComposition?.overlay
				? currentComposition.backgroundUrl
				: currentComposition?.url || route.defaultBackground;
		}
		const currentRoute = currentComposition ? routes.match(currentComposition.url) : null;
		const previousCreationUrl = Object.hasOwn(options, 'previousCreationUrl') ? options.previousCreationUrl : route.presentation === 'overlay' && route.params.creationId
			? options.replace
				? history.state?.[PREVIOUS_CREATION_KEY]
				: currentRoute?.presentation === 'overlay' && currentRoute.params.creationId
					? currentComposition.url
					: null
			: null;
		const returnOverlayUrl = route.params.creationId && currentRoute?.returnFromCreation
			? currentComposition.url
			: route.params.creationId && currentRoute?.params.creationId
				? history.state?.[RETURN_OVERLAY_KEY] : null;
		const method = options.replace ? 'replaceState' : 'pushState';
		const nextState = historyStateFor(url, backgroundUrl, previousCreationUrl);
		delete nextState[RETURN_OVERLAY_KEY];
		if (returnOverlayUrl) nextState[RETURN_OVERLAY_KEY] = returnOverlayUrl;
		history[method](nextState, '', url);
		return reconcile();
	}

	function backOverlay() {
		if (!currentComposition?.overlay) return;
		const currentRoute = routes.match(currentComposition.url);
		const previousUrl = history.state?.[PREVIOUS_CREATION_KEY];
		if (currentRoute?.presentation === 'overlay' && currentRoute.params.creationId && typeof previousUrl === 'string') {
			try {
				const previousRoute = routes.match(pathFor(previousUrl));
				if (previousRoute.presentation === 'overlay' && previousRoute.params.creationId) {
					history.back();
					return;
				}
			} catch {
				// Invalid or stale predecessor: fall back to closing the overlay.
			}
		}
		void dismissOverlay();
	}

	async function dismissOverlay() {
		if (!currentComposition?.overlay) return;
		const route = routes.match(currentComposition.url);
		const previousUrl = history.state?.[PREVIOUS_CREATION_KEY];
		if (route.dismissToPreviousOverlay && typeof previousUrl === 'string') {
			try {
				const previousRoute = routes.match(pathFor(previousUrl));
				if (previousRoute.presentation === 'overlay' && !previousRoute.dismissToPreviousOverlay && previousRoute.params.creationId) {
					return navigate(previousUrl, { replace: true, previousCreationUrl: null });
				}
			} catch {
				// Invalid return metadata: use the normal background dismissal.
			}
		}
		const returnUrl = history.state?.[RETURN_OVERLAY_KEY];
		if (route.params.creationId && typeof returnUrl === 'string') {
			try {
				if (routes.match(pathFor(returnUrl)).returnFromCreation) return navigate(returnUrl, { replace: true });
			} catch { /* Ignore stale return metadata. */ }
		}
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
		if (activeDialog && history.state?.parasceneDialog !== activeDialog) {
			const key = activeDialog; activeDialog = null;
			document.dispatchEvent(new CustomEvent('parascene:dialog-dismiss', { detail: { key } }));
		}
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

	// Media dialogs keep the route mounted. On mobile, Back dismisses the
	// lightbox using the same history marker as WWW; history stays router owned.
	function onLightboxHistoryRequest(event) {
		const prior = history.state && typeof history.state === 'object' ? history.state : {};
		if (event.detail?.open === true) {
			history.pushState({ ...prior, prsnChatInlineImageLightbox: true }, '', currentUrl());
		} else if (prior.prsnChatInlineImageLightbox) {
			const { prsnChatInlineImageLightbox: _lightbox, ...next } = prior;
			history.replaceState(next, '', currentUrl());
		}
	}

	function onDialogHistoryRequest(event) {
		const key = event.detail?.key;
		if (typeof key !== 'string' || !key) return;
		const prior = history.state && typeof history.state === 'object' ? history.state : {};
		if (event.detail.open === true) {
			activeDialog = key;
			history.pushState({ ...prior, parasceneDialog: key }, '', currentUrl());
		} else {
			if (activeDialog === key) activeDialog = null;
			if (prior.parasceneDialog !== key) return;
			const { parasceneDialog: _dialog, ...next } = prior;
			activeDialog = null;
			history.replaceState(next, '', currentUrl());
		}
	}

	return {
		async start() {
			if (started) return;
			started = true;
			document.addEventListener('click', onDocumentClick);
			document.addEventListener('parascene:navigate', onNavigateRequest);
			document.addEventListener('parascene:dismiss-overlay', onDismissOverlayRequest);
			document.addEventListener('parascene:lightbox-history', onLightboxHistoryRequest);
			document.addEventListener('parascene:dialog-history', onDialogHistoryRequest);
			window.addEventListener('popstate', onPopState);
			await reconcile({ fromHistory: true, initial: true });
		},
		navigate,
		dismissOverlay,
		backOverlay,
		destroy() {
			if (!started) return;
			started = false;
			document.removeEventListener('click', onDocumentClick);
			document.removeEventListener('parascene:navigate', onNavigateRequest);
			document.removeEventListener('parascene:dismiss-overlay', onDismissOverlayRequest);
			document.removeEventListener('parascene:lightbox-history', onLightboxHistoryRequest);
			document.removeEventListener('parascene:dialog-history', onDialogHistoryRequest);
			window.removeEventListener('popstate', onPopState);
			layout.destroy();
			currentComposition = null;
			creationSeeds.clear();
		},
	};
}
