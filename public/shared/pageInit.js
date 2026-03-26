/**
 * Shared page initialization: wait for custom elements, show page, and register
 * global listeners (modal link handling, modal-open body class, autogrow, service worker,
 * NSFW view preference and click-to-reveal).
 * Used by entry-*.js after loading their components.
 */

let refreshAutoGrowTextareas;
let closeModalsAndNavigate;
let initNsfwViewPreference;
let handleNsfwClick;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const autogrowMod = await import(`./autogrow.js${qs}`);
		refreshAutoGrowTextareas = autogrowMod.refreshAutoGrowTextareas;

		const navMod = await import(`./navigation.js${qs}`);
		closeModalsAndNavigate = navMod.closeModalsAndNavigate;

		const nsfwMod = await import(`./nsfwView.js${qs}`);
		initNsfwViewPreference = nsfwMod.initNsfwViewPreference;
		handleNsfwClick = nsfwMod.handleNsfwClick;
	})();
	return _depsPromise;
}

/**
 * Wait for DOM and the given custom element tags to be defined, then add body.loaded.
 * @param {string[]} customElementTags - e.g. ['app-navigation', 'app-route-feed']
 */
export async function waitForComponents(customElementTags) {
	if (document.readyState === 'loading') {
		await new Promise((resolve) => {
			document.addEventListener('DOMContentLoaded', resolve);
		});
	}
	if (Array.isArray(customElementTags) && customElementTags.length > 0) {
		await Promise.all(
			customElementTags.map((tag) => customElements.whenDefined(tag))
		);
	}
	await new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve);
		});
	});
	document.body.classList.add('loaded');
}

/**
 * Run after page is loaded: refresh autogrow, then register global listeners
 * (autogrow on tab/route/modal/resize, modal-open body class, modal link interception, service worker).
 * Call once per page load (e.g. from entry.js after entry module init).
 */
export async function runCommonAppInit() {
	await loadDeps();
	// Phase 1: Supabase Auth session for Realtime (private channels). No-op without __PRSN_SUPABASE__ / SESSION_SECRET on server.
	try {
		if (typeof window !== 'undefined' && window.__PRSN_SUPABASE__) {
			const v = getAssetVersionParam();
			const qs = v ? `?v=${encodeURIComponent(v)}` : '';
			const mod = await import(`./supabaseBrowser.js${qs}`);
			await mod.ensureSupabaseSessionForApp();
		}
	} catch {
		// ignore
	}

	try {
		const v = getAssetVersionParam();
		const qs = v ? `?v=${encodeURIComponent(v)}` : '';
		const mod = await import(`./presenceHeartbeat.js${qs}`);
		mod.startPresenceHeartbeat();
	} catch {
		// ignore
	}

	document.addEventListener(
		'submit',
		(e) => {
			const form = e.target;
			if (!(form instanceof HTMLFormElement)) return;
			const action = (form.getAttribute('action') || '').trim();
			if (action !== '/logout') return;
			void (async () => {
				try {
					const v = getAssetVersionParam();
					const qs = v ? `?v=${encodeURIComponent(v)}` : '';
					const mod = await import(`./supabaseBrowser.js${qs}`);
					await mod.signOutSupabaseIfConfigured();
				} catch {
					// ignore
				}
			})();
		},
		true
	);

	// Apply NSFW view preference from localStorage so body.view-nsfw is set on load
	try {
		initNsfwViewPreference();
	} catch {
		// ignore
	}
	// NSFW overlay click: if user clicks a blurred NSFW image and hasn't enabled view, confirm then enable
	document.addEventListener(
		'click',
		(e) => {
			if (handleNsfwClick(e)) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		true
	);

	try {
		refreshAutoGrowTextareas(document);
	} catch {
		// ignore
	}
	try {
		const fonts = document.fonts;
		if (fonts?.ready && typeof fonts.ready.then === 'function') {
			fonts.ready.then(() => refreshAutoGrowTextareas(document)).catch(() => {});
		}
	} catch {
		// ignore
	}

	document.addEventListener('tab-change', () => {
		try {
			refreshAutoGrowTextareas(document);
		} catch {
			/* ignore */
		}
	});
	document.addEventListener('route-change', () => {
		try {
			refreshAutoGrowTextareas(document);
		} catch {
			/* ignore */
		}
	});
	window.addEventListener('resize', () => {
		try {
			refreshAutoGrowTextareas(document);
		} catch {
			/* ignore */
		}
	});
	window.addEventListener('orientationchange', () => {
		try {
			refreshAutoGrowTextareas(document);
		} catch {
			/* ignore */
		}
	});
	document.addEventListener('modal-opened', () => {
		setTimeout(() => {
			try {
				refreshAutoGrowTextareas(document);
			} catch {
				/* ignore */
			}
		}, 0);
	});

	// Body class when shadow DOM modals are open
	let shadowModalCount = 0;
	function updateBodyClass() {
		if (shadowModalCount > 0) {
			document.body.classList.add('modal-open');
		} else {
			document.body.classList.remove('modal-open');
		}
	}
	document.addEventListener('modal-opened', () => {
		shadowModalCount++;
		updateBodyClass();
	});
	document.addEventListener('modal-closed', () => {
		shadowModalCount = Math.max(0, shadowModalCount - 1);
		updateBodyClass();
	});

	// Modal link interception: close modals then navigate
	function ancestors(node) {
		const list = [];
		let n = node?.parentNode;
		while (n) {
			list.push(n);
			n = n.parentNode;
		}
		return list;
	}
	document.addEventListener(
		'click',
		(e) => {
			const path = e.composedPath?.() || (e.target ? [e.target, ...ancestors(e.target)] : []);
			let link = null;
			for (const el of path) {
				if (el?.nodeType === 1 && el.tagName === 'A' && el.hasAttribute('href')) {
					link = el;
					break;
				}
			}
			if (!link) return;
			const href = link.getAttribute('href');
			if (!href || href.startsWith('#') || link.target === '_blank' || link.hasAttribute('download')) return;
			const root = link.getRootNode();
			const inModal =
				root instanceof ShadowRoot
					? root.host.hasAttribute?.('data-modal')
					: link.closest?.('[data-modal]');
			if (!inModal) return;
			e.preventDefault();
			e.stopPropagation();
			closeModalsAndNavigate(href);
		},
		true
	);

	// Service worker
	if ('serviceWorker' in navigator) {
		window.addEventListener('load', () => {
			navigator.serviceWorker.register('/sw.js').catch(() => {});
		});
	}
}
