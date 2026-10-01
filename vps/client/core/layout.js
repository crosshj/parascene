import './layout.css';
import { createPopupMenu } from '../components/PopupMenu/PopupMenu.js';
import { iconMarkup } from '../components/Icon/Icon.js';

function getRegion(root, name) {
	const region = root.querySelector(`[data-layout-region="${name}"]`);
	if (!region) throw new Error(`Missing layout region: ${name}`);
	return region;
}

function destroyHandle(handle) {
	if (typeof handle === 'function') handle();
	else handle?.destroy?.();
}

export function createLayout({ root, views, services } = {}) {
	if (!(root instanceof HTMLElement)) throw new Error('Missing application shell');

	const sidebarRegion = getRegion(root, 'sidebar');
	const pageRegion = getRegion(root, 'page');
	const mobileRegion = getRegion(root, 'mobile-navigation');
	pageRegion.classList.add('beta-outlet');
	pageRegion.innerHTML = `
		<div class="beta-outlet__frame">
			<header class="beta-outlet__header">
				<div class="beta-outlet__identity"><span class="beta-outlet__icon"></span><h1 class="beta-outlet__title"></h1></div>
				<div class="beta-outlet__actions">
					<button class="beta-outlet__action beta-outlet__more" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${iconMarkup('more')}</button>
				</div>
			</header>
			<div class="beta-outlet__scroll"><div class="beta-outlet__content"></div></div>
			<form class="beta-outlet__composer" aria-label="Message composer">
				<textarea rows="1" aria-label="Write a message" placeholder="Write a message…"></textarea>
				<button type="button" aria-label="Add attachment">${iconMarkup('plus')}</button>
				<button type="submit" aria-label="Send message" disabled>${iconMarkup('send')}</button>
			</form>
		</div>`;

	const outletRegion = pageRegion.querySelector('.beta-outlet__content');
	const scrollRegion = pageRegion.querySelector('.beta-outlet__scroll');
	const pageTitle = pageRegion.querySelector('.beta-outlet__title');
	const pageIcon = pageRegion.querySelector('.beta-outlet__icon');
	const composer = pageRegion.querySelector('.beta-outlet__composer');
	const menuButton = pageRegion.querySelector('.beta-outlet__more');
	let menu = null;
	let actions = {};
	let appliedComposition = null;
	let restoreFocus = null;
	let backgroundRevision = 0;
	let viewportResizeTimer = 0;
	let sidebarLayoutReady = false;

	const overlayHost = document.createElement('div');
	overlayHost.className = 'beta-app-overlay-host';
	overlayHost.hidden = true;
	overlayHost.innerHTML = `
		<section class="beta-app-overlay" role="dialog" aria-modal="true" aria-labelledby="beta-app-overlay-title">
			<div class="beta-app-overlay__chrome">
				<button type="button" class="beta-app-overlay__back" aria-label="Back">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="M11 6 5 12l6 6"></path></svg>
				</button>
				<h1 id="beta-app-overlay-title" class="beta-app-overlay__title" data-overlay-title></h1>
				<button type="button" class="beta-app-overlay__close" aria-label="Close">
					<svg class="beta-app-overlay__close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
			</div>
			<div class="beta-app-overlay__content" data-overlay-content></div>
		</section>`;
	root.append(overlayHost);
	const overlayContent = overlayHost.querySelector('[data-overlay-content]');
	const overlayTitle = overlayHost.querySelector('[data-overlay-title]');
	const overlayBack = overlayHost.querySelector('.beta-app-overlay__back');
	const overlayClose = overlayHost.querySelector('.beta-app-overlay__close');

	const mounted = {
		sidebar: null,
		mobile: null,
		outlet: null,
		overlay: null,
	};

	function setHeaderMenu({ label = 'Page actions', items = [], onSelect } = {}) {
		menu?.destroy();
		menu = items.length ? createPopupMenu({ label, items, onSelect }) : null;
		menuButton.hidden = !menu;
		menuButton.setAttribute('aria-expanded', 'false');
	}

	function setPage(chrome = {}) {
		pageTitle.replaceChildren();
		if (chrome.breadcrumb) {
			const breadcrumb = document.createElement('span');
			breadcrumb.className = 'beta-outlet__title-text beta-outlet__title-text--breadcrumb';
			const parent = document.createElement('a');
			parent.className = 'beta-outlet__breadcrumb-link';
			parent.href = chrome.breadcrumb.href;
			parent.dataset.spaLink = '';
			parent.textContent = chrome.breadcrumb.parent;
			const separator = document.createElement('span');
			separator.className = 'beta-outlet__breadcrumb-sep';
			separator.setAttribute('aria-hidden', 'true');
			separator.textContent = '›';
			const current = document.createElement('span');
			current.className = 'beta-outlet__breadcrumb-current';
			current.textContent = chrome.breadcrumb.current;
			breadcrumb.append(parent, separator, current);
			pageTitle.append(breadcrumb);
		} else {
			pageTitle.textContent = chrome.title || 'Feed';
		}
		pageIcon.innerHTML = iconMarkup(chrome.icon || 'home');
		composer.hidden = chrome.composer === 'none';
	}

	function mountContext(extra = {}) {
		return {
			services,
			actions,
			setHeaderMenu,
			...extra,
		};
	}

	function unmount(name, host) {
		const record = mounted[name];
		if (!record) return;
		record.active = false;
		destroyHandle(record.handle);
		record.handle = null;
		host.replaceChildren();
		mounted[name] = null;
	}

	async function reconcileRegion(name, host, descriptor, extra = {}) {
		const current = mounted[name];
		if (!descriptor) {
			unmount(name, host);
			return false;
		}
		if (current?.key === descriptor.key) {
			current.handle?.update?.({ ...descriptor.props, ...mountContext(extra) });
			return false;
		}
		unmount(name, host);
		const record = { key: descriptor.key, handle: null, active: true };
		mounted[name] = record;
		const result = descriptor.view.mount({
			outlet: host,
			...mountContext(extra),
			...(descriptor.props || {}),
		});
		const handle = result && typeof result.then === 'function' ? await result : result;
		if (!record.active || mounted[name] !== record) {
			destroyHandle(handle);
			return true;
		}
		record.handle = typeof handle === 'function' ? { destroy: handle } : handle || { destroy() {} };
		return true;
	}

	function setBackgroundSuppressed(suppressed) {
		for (const region of [sidebarRegion, pageRegion, mobileRegion]) {
			region.inert = suppressed;
			if (suppressed) region.setAttribute('aria-hidden', 'true');
			else region.removeAttribute('aria-hidden');
		}
		document.body.classList.toggle('beta-creation-overlay-open', suppressed);
	}

	function setSidebarLayoutReady(ready) {
		sidebarLayoutReady = Boolean(ready);
		document.documentElement.classList.toggle('beta-sidebar-layout-pending', !sidebarLayoutReady);
	}

	function onViewportResize() {
		document.body.classList.add('is-resizing-viewport');
		window.clearTimeout(viewportResizeTimer);
		viewportResizeTimer = window.setTimeout(() => {
			viewportResizeTimer = 0;
			document.body.classList.remove('is-resizing-viewport');
		}, 180);
	}

	function showOverlay(descriptor, changed) {
		const visible = Boolean(descriptor);
		const opening = visible && overlayHost.hidden;
		if (opening) {
			restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}
		overlayHost.hidden = !visible;
		if (opening && document.activeElement instanceof HTMLElement && !overlayHost.contains(document.activeElement)) {
			document.activeElement.blur();
		}
		setBackgroundSuppressed(visible);
		if (visible) {
			overlayTitle.textContent = descriptor.title || 'Detail';
			if (mounted.overlay) document.documentElement.classList.remove('beta-overlay-route-pending');
		} else if (restoreFocus) {
			const focusTarget = restoreFocus;
			restoreFocus = null;
			queueMicrotask(() => { if (focusTarget.isConnected) focusTarget.focus(); });
		}
		if (!visible || changed) overlayContent.scrollTop = 0;
	}

	function focusOverlayInitialContent() {
		const detailContent = overlayContent.querySelector('[data-detail-content]');
		if (detailContent instanceof HTMLElement) {
			if (!detailContent.hasAttribute('tabindex')) detailContent.setAttribute('tabindex', '-1');
			detailContent.focus({ preventScroll: true });
			return;
		}
		overlayClose.focus({ preventScroll: true });
	}

	function onOverlayKeydown(event) {
		if (overlayHost.hidden) return;
		if (event.key !== 'Tab') return;
		const focusable = [...overlayHost.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
			.filter((element) => !element.hidden && element.getClientRects().length > 0);
		if (!focusable.length) {
			event.preventDefault();
			overlayClose.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onDocumentKeydown(event) {
		if (overlayHost.hidden || event.key !== 'Escape' || event.defaultPrevented) return;
		if (mounted.overlay?.handle?.hasOpenEscapeTarget?.()) return;
		queueMicrotask(() => {
			// Let any target/document-level dialog handler consume Escape first.
			if (event.defaultPrevented || event.cancelBubble || overlayHost.hidden) return;
			event.preventDefault();
			actions.dismissOverlay?.();
		});
	}

	async function prepareBackground(composition, revision) {
		if (revision !== backgroundRevision) return;
		const appShell = composition.shell === 'app';
		setSidebarLayoutReady(!appShell);
		await reconcileRegion('sidebar', sidebarRegion, appShell ? { key: 'app:sidebar', view: views.Sidebar, props: {} } : null);
		if (revision !== backgroundRevision) return;
		// Sidebar mount reads the saved width and applies it before returning.
		setSidebarLayoutReady(true);
		await reconcileRegion('mobile', mobileRegion, appShell ? { key: 'app:mobile', view: views.MobileNavigation, props: {} } : null);
		if (revision !== backgroundRevision) return;

		const outletChanged = mounted.outlet?.key !== composition.outlet?.key;
		if (outletChanged) {
			setHeaderMenu();
			setPage(composition.outlet?.chrome);
		}
		await reconcileRegion('outlet', outletRegion, composition.outlet);
		if (revision !== backgroundRevision) return;
		if (outletChanged) {
			scrollRegion.scrollTo(0, 0);
			outletRegion.scrollTop = 0;
		}
	}

	function prepareColdOverlayBackground(composition, revision) {
		const ready = mounted.overlay?.handle?.backgroundReady;
		if (!ready || typeof ready.then !== 'function') {
			console.error('[layout] cold overlay did not provide a backgroundReady signal');
			return;
		}
		void ready.then(
			() => prepareBackground(composition, revision),
			() => prepareBackground(composition, revision)
		).catch((error) => console.error('[layout] background preparation failed', error));
	}

	async function apply(composition, nextActions = {}) {
		actions = nextActions;
		const revision = ++backgroundRevision;
		const overlayChanged = mounted.overlay?.key !== composition.overlay?.key;
		if (composition.overlay) {
			const overlayOpening = overlayHost.hidden;
			// Reset before revealing/mounting a new route so stale scroll position
			// cannot flash while the new detail view is being inserted.
			showOverlay(composition.overlay, overlayChanged);
			await reconcileRegion('overlay', overlayContent, composition.overlay);
			if (overlayOpening) focusOverlayInitialContent();
			showOverlay(composition.overlay, false);
			appliedComposition = composition;

			if (!mounted.outlet) {
				// A cold overlay owns startup. Its resolved background remains dormant
				// until detail reports a terminal ready state or navigation dismisses it.
				prepareColdOverlayBackground(composition, revision);
				return;
			}
		}

		await prepareBackground(composition, revision);

		if (!composition.overlay) {
			// Keep an existing overlay covering the page until its destination is
			// ready, then remove the overlay mount and restore background interaction.
			await reconcileRegion('overlay', overlayContent, null);
			showOverlay(null, overlayChanged);
		}
		appliedComposition = composition;
	}

	function destroy() {
		backgroundRevision++;
		unmount('overlay', overlayContent);
		unmount('outlet', outletRegion);
		unmount('mobile', mobileRegion);
		unmount('sidebar', sidebarRegion);
		setHeaderMenu();
		setBackgroundSuppressed(false);
		setSidebarLayoutReady(true);
		document.removeEventListener('keydown', onDocumentKeydown);
		window.removeEventListener('resize', onViewportResize);
		window.clearTimeout(viewportResizeTimer);
		viewportResizeTimer = 0;
		document.documentElement.classList.remove('beta-overlay-route-pending');
		overlayHost.remove();
		document.body.classList.remove('beta-layout', 'is-resizing-sidebar', 'is-resizing-viewport');
		document.body.style.removeProperty('--beta-sidebar-width');
		appliedComposition = null;
	}

	menuButton.hidden = true;
	menuButton.addEventListener('click', (event) => menu?.toggle(event.currentTarget));
	composer.addEventListener('submit', (event) => event.preventDefault());
	overlayClose.addEventListener('click', () => actions.dismissOverlay?.());
	overlayBack.addEventListener('click', () => (actions.backOverlay || actions.dismissOverlay)?.());
	overlayHost.addEventListener('keydown', onOverlayKeydown);
	document.addEventListener('keydown', onDocumentKeydown);
	window.addEventListener('resize', onViewportResize, { passive: true });
	document.body.classList.add('beta-layout');
	setSidebarLayoutReady(false);

	return {
		apply,
		destroy,
		get composition() { return appliedComposition; },
	};
}
