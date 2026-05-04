/**
 * Mirrors `public/shared/pageInit.js` → `runCommonAppInit` for the chat Rollup bundle.
 * Imports only from `src/shared/*` (bundle copies); keep aligned when editing global listeners.
 */

import { refreshAutoGrowTextareas } from './autogrow.js';
import { closeModalsAndNavigate } from './navigation.js';
import { initNsfwViewPreference, handleNsfwClick } from './nsfwView.js';
import * as supabaseBrowser from './supabaseBrowser.js';
import { startPresenceHeartbeat } from './presenceHeartbeat.js';

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

/**
 * Run once after route-specific UI is mounted: autogrow, modals, NSFW, Supabase session,
 * presence heartbeat, service worker (mirrors `runCommonAppInit` in pageInit.js).
 */
export async function runBundledCommonAppInit() {
	try {
		if (typeof window !== 'undefined' && window.__PRSN_SUPABASE__) {
			await supabaseBrowser.ensureSupabaseSessionForApp();
		}
	} catch {
		// ignore
	}

	try {
		startPresenceHeartbeat();
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
			try {
				if (navigator.serviceWorker?.controller) {
					navigator.serviceWorker.controller.postMessage({ type: 'PRSN_SW_INVALIDATE', all: true });
				}
			} catch {
				// ignore
			}
			void (async () => {
				try {
					await supabaseBrowser.signOutSupabaseIfConfigured();
				} catch {
					// ignore
				}
			})();
		},
		true
	);

	try {
		initNsfwViewPreference();
	} catch {
		// ignore
	}
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

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', () => {
			const v = getAssetVersionParam();
			const swUrl = v ? `/sw.js?v=${encodeURIComponent(v)}` : '/sw.js';
			navigator.serviceWorker.register(swUrl).catch(() => {});
		});
	}
}
