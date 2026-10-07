import './layout.css';
import { mobilePresentation } from './mobilePresentation.js';
import { createRightSidebar } from './rightSidebar.js';
import { createPopupMenu } from '../components/PopupMenu/PopupMenu.js';
import { iconMarkup } from '../components/Icon/Icon.js';
import { createSearchComposerElement } from '../components/SearchComposer/SearchComposer.js';
import { createMessageComposerElement } from '../components/Messages/Composer.js';
import { mountCreateComposer } from '../components/CreateComposer/CreateComposer.js';
import '../components/CreateComposer/CreateComposer.css';
import { refreshAutoGrowTextareas } from '../shared/autogrow.js';
import { attachCreateComposerSuggest, isTriggeredSuggestPopupOpen } from '../shared/triggeredSuggest.js';
import { CHAT_PAGE_BACK_ICON_HTML } from '../shared/chatPageHeader.js';
import { bindConversationVisualViewport } from './conversationViewport.js';

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
	const mobileHeaderRegion = document.createElement('div');
	mobileHeaderRegion.dataset.layoutRegion = 'mobile-header';
	root.prepend(mobileHeaderRegion);
	pageRegion.classList.add('beta-outlet');
	pageRegion.innerHTML = `
		<div class="beta-outlet__frame">
			<div class="beta-outlet__thread-body">
			<header class="beta-outlet__header">
				<a class="beta-outlet__action beta-outlet__mobile-back" href="/chat#channels" data-spa-link aria-label="Back to Chat">${CHAT_PAGE_BACK_ICON_HTML}</a>
				<div class="beta-outlet__identity"><span class="beta-outlet__icon"></span><h1 class="beta-outlet__title"></h1></div>
				<div class="beta-outlet__actions">
					<button class="beta-outlet__action beta-outlet__more" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${iconMarkup('more')}</button>
				</div>
			</header>
			<div class="beta-outlet__scroll"><div class="beta-outlet__content"></div></div>
			</div>
			<div class="beta-outlet__creation-composer" data-layout-creation-composer hidden><div class="chat-page-create-composer-host" data-create-composer-host></div></div>
		</div>`;

	const outletRegion = pageRegion.querySelector('.beta-outlet__content');
	const scrollRegion = pageRegion.querySelector('.beta-outlet__scroll');
	const pageTitle = pageRegion.querySelector('.beta-outlet__title');
	const pageIcon = pageRegion.querySelector('.beta-outlet__icon');
	const composer = createMessageComposerElement();
	const frame = pageRegion.querySelector('.beta-outlet__frame');
	const conversationViewport = bindConversationVisualViewport({ frame, root });
	const searchComposer = createSearchComposerElement();
	frame.append(composer, searchComposer);
	const creationComposer = pageRegion.querySelector('[data-layout-creation-composer]');
	const creationComposerHost = creationComposer.querySelector('[data-create-composer-host]');
	const measureComposer = () => frame.style.setProperty('--creation-composer-height', `${creationComposer.hidden ? 0 : creationComposer.getBoundingClientRect().height}px`);
	const composerResize = new ResizeObserver(measureComposer);
	composerResize.observe(creationComposer);
	const measureMessageComposer = () => frame.style.setProperty('--message-composer-height', `${composer.hidden ? 0 : composer.getBoundingClientRect().height}px`);
	const messageComposerResize = new ResizeObserver(measureMessageComposer);
	messageComposerResize.observe(composer);
	const searchComposerResize = new ResizeObserver(() => frame.style.setProperty('--search-composer-height', `${searchComposer.hidden ? 0 : searchComposer.getBoundingClientRect().height}px`));
	searchComposerResize.observe(searchComposer);
	const menuButton = pageRegion.querySelector('.beta-outlet__more');
	const pageActions = pageRegion.querySelector('.beta-outlet__actions');
	const pageHeader = pageRegion.querySelector('.beta-outlet__header');
	const mobileMenuButton = document.createElement('button');
	mobileMenuButton.type = 'button';
	mobileMenuButton.className = 'beta-outlet__mobile-menu';
	mobileMenuButton.hidden = true;
	mobileMenuButton.setAttribute('aria-label', 'Open page menu');
	mobileMenuButton.setAttribute('aria-haspopup', 'menu');
	mobileMenuButton.setAttribute('aria-expanded', 'false');
	mobileMenuButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
	pageHeader.insertBefore(mobileMenuButton, pageActions);
	const mobileMenuSheet = document.createElement('div');
	mobileMenuSheet.className = 'beta-outlet__mobile-menu-sheet';
	mobileMenuSheet.hidden = true;
	mobileMenuSheet.innerHTML = '<button class="beta-outlet__mobile-menu-scrim" type="button" aria-label="Dismiss page menu"></button><div class="beta-outlet__mobile-menu-panel"><div class="beta-outlet__mobile-menu-items" role="menu"></div></div>';
	root.append(mobileMenuSheet);
	const mobileMenuItems = mobileMenuSheet.querySelector('.beta-outlet__mobile-menu-items');
	let mobileSwitcherConfig = null;
	let mobileMenuConfig = null;
	let sidebarMobileMenuButton = null;
	function closeMobileMenu() {
		mobileMenuSheet.hidden = true;
		mobileMenuButton.setAttribute('aria-expanded', 'false');
		sidebarMobileMenuButton?.setAttribute('aria-expanded', 'false');
		document.body.classList.remove('beta-mobile-menu-open');
	}
	function renderMobileMenu() {
		mobileMenuItems.replaceChildren();
		const appendItem = (item, onSelect) => {
			if (item.section) {
				const section = document.createElement('div'); section.className = 'beta-outlet__mobile-menu-section'; section.textContent = item.section; mobileMenuItems.append(section); return;
			}
			if (item.separator) {
				const separator = document.createElement('div'); separator.className = 'beta-outlet__mobile-menu-separator'; separator.setAttribute('role', 'separator'); mobileMenuItems.append(separator); return;
			}
			const button = item.href ? document.createElement('a') : document.createElement('button');
			if (!item.href) button.type = 'button';
			else { button.href = item.href; button.dataset.spaLink = ''; }
			button.className = `beta-outlet__mobile-menu-item${item.current ? ' is-current' : ''}`;
			button.setAttribute('role', 'menuitem');
			button.textContent = item.label;
			button.addEventListener('click', () => { closeMobileMenu(); if (!item.href) onSelect?.(item); });
			mobileMenuItems.append(button);
		};
		if (mobileSwitcherConfig?.items?.length) {
			for (const item of mobileSwitcherConfig.items) appendItem(item, (selected) => mobileSwitcherConfig?.onSelect?.(selected.id));
		}
		if (mobileMenuConfig?.items?.length) {
			if (mobileSwitcherConfig?.items?.length) {
				const separator = document.createElement('div'); separator.className = 'beta-outlet__mobile-menu-separator'; separator.setAttribute('role', 'separator'); mobileMenuItems.append(separator);
			}
			for (const item of mobileMenuConfig.items) appendItem(item, (selected) => mobileMenuConfig?.onSelect?.(selected));
		}
		const mobileContext = root.dataset.mobileMode !== 'primary' && root.dataset.mobileMode !== 'roster';
		mobileMenuButton.hidden = !mobileMedia.matches || !mobileContext || !mobileMenuItems.childElementCount;
		if (sidebarMobileMenuButton) sidebarMobileMenuButton.hidden = mobileMenuButton.hidden;
		mobileMenuButton.setAttribute('aria-label', mobileSwitcherConfig?.items?.length && mobileMenuConfig?.items?.length ? 'Channel and page menu' : mobileSwitcherConfig?.items?.length ? 'Channel and canvases' : (mobileMenuConfig?.label || 'Page actions'));
	}
	function setHeaderSwitcher(config = null) {
		mobileSwitcherConfig = config;
		renderMobileMenu();
	}
	mobileMenuButton.addEventListener('click', () => {
		if (!mobileMenuItems.childElementCount) return;
		if (mobileMenuSheet.hidden) {
			mobileMenuSheet.hidden = false;
			mobileMenuButton.setAttribute('aria-expanded', 'true');
			sidebarMobileMenuButton?.setAttribute('aria-expanded', 'true');
			document.body.classList.add('beta-mobile-menu-open');
		} else closeMobileMenu();
	});
	mobileMenuSheet.querySelector('.beta-outlet__mobile-menu-scrim').addEventListener('click', closeMobileMenu);
	document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !mobileMenuSheet.hidden) closeMobileMenu(); });
	const mobileMedia = window.matchMedia('(max-width: 768px)');
	function syncMobileActions() {
		// WWW's app header owns only global actions (notifications, credits, account).
		// Route actions such as the three-dot menu belong to the page header, which
		// is hidden while app chrome is active and remains visible in contextual views.
		if (pageActions.parentElement !== pageHeader) pageHeader.append(pageActions);
		menuButton.hidden = !menu || mobileMedia.matches;
	}
	function syncMobileScrollPolicy(composition = appliedComposition) {
		const mobile = mobilePresentation(composition || {});
		const documentScroll = mobileMedia.matches && mobile.backgroundScrollOwner === 'document';
		scrollRegion.dataset.scrollOwner = documentScroll ? 'document' : 'outlet';
		document.documentElement.classList.toggle('beta-mobile-document-scroll', documentScroll);
		document.body.classList.toggle('beta-mobile-document-scroll', documentScroll);
		root.dataset.mobileScrollOwner = documentScroll ? 'document' : 'outlet';
	}
	function onMobileBreakpointChange() {
		syncMobileActions();
		renderMobileMenu();
		syncMobileScrollPolicy();
		document.dispatchEvent(new CustomEvent('beta-mobile-scroll-owner-changed'));
	}
	mobileMedia.addEventListener('change', onMobileBreakpointChange);
	let menu = null;
	let actions = {};
	let appliedComposition = null;
	let backgroundRevision = 0;
	let viewportResizeTimer = 0;
	let sidebarLayoutReady = false;
	let creationComposerHandle = null;
	let mobileDocumentScrollLockTop = null;
	let mobileDocumentScrollLockStyles = null;

	const overlayHost = document.createElement('div');
	overlayHost.className = 'beta-app-overlay-host';
	overlayHost.hidden = true;
	overlayHost.innerHTML = `
		<section class="beta-app-overlay">
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

	const rightSidebar = createRightSidebar({ root });
	sidebarMobileMenuButton = mobileMenuButton.cloneNode(true);
	sidebarMobileMenuButton.classList.add('beta-right-sidebar__menu');
	rightSidebar.header.insertBefore(sidebarMobileMenuButton, rightSidebar.header.querySelector('.beta-right-sidebar__close'));
	sidebarMobileMenuButton.addEventListener('click', () => mobileMenuButton.click());
	const headerAccessories = document.createElement('span');
	headerAccessories.className = 'beta-outlet__accessories';
	menuButton.before(headerAccessories);
	function setHeaderAccessories(items = []) {
		headerAccessories.replaceChildren();
		for (const item of items) {
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'beta-outlet__pin';
			button.textContent = item.label; button.setAttribute('aria-label', item.ariaLabel || item.label);
			button.addEventListener('click', item.onClick); headerAccessories.append(button);
		}
	}

	const overlayRestoreStates = new Map();
	const mounted = {
		sidebar: null,
		mobile: null,
		mobileHeader: null,
		outlet: null,
		overlay: null,
	};

	function setHeaderMenu({ label = 'Page actions', items = [], onSelect } = {}) {
		mobileMenuConfig = items.length ? { label, items, onSelect } : null;
		menu?.destroy();
		menu = items.length ? createPopupMenu({ label, items, onSelect, placement: 'below-end' }) : null;
		menuButton.hidden = !menu || mobileMedia.matches;
		menuButton.setAttribute('aria-expanded', 'false');
		renderMobileMenu();
	}

	function setPageTitle(chrome = {}) {
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
			pageTitle.textContent = chrome.title ?? 'Feed';
		}
	}

	function setPage(chrome = {}) {
		if (mobileMedia.matches && root.dataset.mobileMode === 'challenge-subpage' && chrome.breadcrumb) {
			setPageTitle({ title: chrome.breadcrumb.current });
		} else {
			setPageTitle(chrome);
		}
		pageIcon.innerHTML = iconMarkup(chrome.icon || 'home');
		composer.hidden = chrome.composer !== 'message';
		creationComposer.hidden = chrome.composer !== 'creation';
		searchComposer.hidden = chrome.composer !== 'search';
		frame.dataset.composer = chrome.composer || 'none';
		measureComposer();
		measureMessageComposer();
	}

	async function reconcileCreationComposer(chrome, revision) {
		const wants = chrome?.composer === 'creation';
		if (!wants) {
			if (creationComposerHandle) destroyHandle(creationComposerHandle);
			creationComposerHandle = null;
			creationComposerHost.replaceChildren();
			return;
		}
		if (creationComposerHandle) return;
		const result = mountCreateComposer(creationComposerHost, {
			refreshAutoGrowTextareas,
			attachPromptSuggest: attachCreateComposerSuggest,
			isTriggeredSuggestPopupOpen,
			createProvider: services.providers.create,
		});
		creationComposerHandle = result && typeof result.then === 'function' ? await result : result;
		if (revision !== backgroundRevision) {
			destroyHandle(creationComposerHandle);
			creationComposerHandle = null;
			creationComposerHost.replaceChildren();
		}
	}

	function mountContext(extra = {}) {
		return {
			services,
			actions,
			setHeaderMenu,
			setHeaderAccessories,
			setHeaderSwitcher,
			setHeaderBreadcrumb(breadcrumb) {
				if (mobileMedia.matches && root.dataset.mobileMode === 'challenge-subpage') {
					setPageTitle({ title: breadcrumb?.current || 'Challenge details' });
					return;
				}
				setPageTitle({ breadcrumb });
			},
			setHeaderTitle(title) { setPageTitle({ title }); },
			rightSidebar,
			setConversationIdentity({ title, avatarHtml, href }) {
				pageTitle.replaceChildren();
				if (typeof avatarHtml === 'string') pageIcon.innerHTML = avatarHtml;
				if (href) {
					const titleLink = document.createElement('a');
					titleLink.className = 'beta-outlet__profile-link';
					titleLink.href = href;
					titleLink.dataset.profileLink = '';
					titleLink.textContent = title;
					pageTitle.append(titleLink);
					const avatarLink = document.createElement('a');
					avatarLink.className = 'beta-outlet__profile-avatar-link';
					avatarLink.href = href;
					avatarLink.dataset.profileLink = '';
					avatarLink.setAttribute('aria-label', `View ${title} profile`);
					while (pageIcon.firstChild) avatarLink.append(pageIcon.firstChild);
					pageIcon.append(avatarLink);
				} else {
					pageTitle.textContent = title;
				}
				services.providers.document.setTitle(`${title} - parascene beta`);
			},
			composer,
			searchComposer,
			...extra,
		};
	}

	function unmount(name, host) {
		const record = mounted[name];
		if (!record) return;
		if (name === 'overlay' && record.handle?.getRestoreState) {
			overlayRestoreStates.set(record.key, { state: record.handle.getRestoreState(), scrollTop: host.scrollTop });
		}
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
			if (name === 'outlet') rightSidebar.close({ forget: false });
			return false;
		}
		if (current?.key === descriptor.key) {
			current.handle?.update?.({ ...descriptor.props, ...mountContext(extra) });
			return false;
		}
		if (name === 'outlet') rightSidebar.prepare(extra.sidebarRoute);
		unmount(name, host);
		if (name === 'overlay') host.scrollTop = 0;
		const record = { key: descriptor.key, handle: null, active: true };
		mounted[name] = record;
		const restored = name === 'overlay' ? overlayRestoreStates.get(descriptor.key) : null;
		const result = descriptor.view.mount({
			outlet: host,
			restoreState: restored?.state,
			...mountContext(extra),
			...(descriptor.props || {}),
		});
		const handle = result && typeof result.then === 'function' ? await result : result;
		if (!record.active || mounted[name] !== record) {
			destroyHandle(handle);
			return true;
		}
		record.handle = typeof handle === 'function' ? { destroy: handle } : handle || { destroy() {} };
		if (restored) {
			void Promise.resolve(record.handle.backgroundReady).then(() => {
				if (record.active && mounted[name] === record) host.scrollTop = restored.scrollTop;
			});
		}
		return true;
	}

	function setBackgroundSuppressed(suppressed) {
		const lockDocumentScroll = suppressed && document.body.classList.contains('beta-mobile-document-scroll');
		if (lockDocumentScroll && mobileDocumentScrollLockTop === null) {
			mobileDocumentScrollLockTop = window.scrollY || document.documentElement.scrollTop || 0;
			mobileDocumentScrollLockStyles = {
				position: document.body.style.getPropertyValue('position'),
				top: document.body.style.getPropertyValue('top'),
				width: document.body.style.getPropertyValue('width'),
			};
			document.body.style.position = 'fixed';
			document.body.style.setProperty('top', '-' + mobileDocumentScrollLockTop + 'px');
			document.body.style.width = '100%';
		}
		document.body.classList.toggle('beta-creation-overlay-open', suppressed);
		document.documentElement.classList.toggle('beta-mobile-document-scroll-locked', suppressed && document.body.classList.contains('beta-mobile-document-scroll'));
		if (!suppressed && mobileDocumentScrollLockTop !== null) {
			const top = mobileDocumentScrollLockTop;
			mobileDocumentScrollLockTop = null;
			for (const [property, value] of Object.entries(mobileDocumentScrollLockStyles || {})) {
				if (value) document.body.style.setProperty(property, value);
				else document.body.style.removeProperty(property);
			}
			mobileDocumentScrollLockStyles = null;
			window.scrollTo(0, top);
		}
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
		overlayHost.hidden = !visible;
		setBackgroundSuppressed(visible);
		if (visible) {
			overlayTitle.textContent = descriptor.title || 'Detail';
			if (mounted.overlay) document.documentElement.classList.remove('beta-overlay-route-pending');
		}
		if (!visible) overlayContent.scrollTop = 0;
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
		await reconcileRegion('mobileHeader', mobileHeaderRegion, appShell ? { key: 'app:mobile-header', view: views.MobileHeader, props: {} } : null,
			{ onShellAction: (action) => mounted.sidebar?.handle?.handleShellAction?.(action) });
		if (revision !== backgroundRevision) return;
		await reconcileRegion('mobile', mobileRegion, appShell ? { key: 'app:mobile', view: views.MobileNavigation, props: { navigation: composition } } : null);
		syncMobileActions();
		if (revision !== backgroundRevision) return;

		const outletChanged = mounted.outlet?.key !== composition.outlet?.key;
		if (outletChanged) {
			setHeaderAccessories();
			setHeaderMenu();
			setHeaderSwitcher();
			setPage(composition.outlet?.chrome);
		}
		await reconcileCreationComposer(composition.outlet?.chrome, revision);
		if (revision !== backgroundRevision) return;
		await reconcileRegion('outlet', outletRegion, composition.outlet, { sidebarRoute: composition.backgroundUrl || composition.url });
		if (revision !== backgroundRevision) return;
		if (outletChanged) {
			if (scrollRegion.dataset.scrollOwner === 'document') window.scrollTo({ top: 0, behavior: 'auto' });
			else scrollRegion.scrollTo(0, 0);
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
		const mobile = mobilePresentation(composition);
		const backgroundMobile = mobilePresentation({ url: composition.backgroundUrl || composition.url });
		root.dataset.mobileMode = mobile.mode;
		conversationViewport.sync();
		if (mobile.mode === 'primary' || mobile.mode === 'roster') closeMobileMenu();
		const mobileBack = pageRegion.querySelector('.beta-outlet__mobile-back');
		if (mobileBack) {
			const challengeSubpage = mobile.mode === 'challenge-subpage';
			mobileBack.href = challengeSubpage ? '/challenges' : '/chat#channels';
			mobileBack.setAttribute('aria-label', challengeSubpage ? 'Back to Challenges' : 'Back to Chat');
		}
		root.dataset.mobileBack = String(mobile.backButton);
		renderMobileMenu();
		root.dataset.mobileFooter = String(mobile.footer);
		root.dataset.mobileHeader = String(mobile.appHeader);
		root.dataset.mobileBackgroundFooter = String(backgroundMobile.footer);
		root.dataset.mobileBackgroundHeader = String(backgroundMobile.appHeader);
		syncMobileActions();
		scrollRegion.dataset.scrollOwner = mobileMedia.matches && mobile.backgroundScrollOwner === 'document' ? 'document' : 'outlet';
		syncMobileScrollPolicy(composition);
		mounted.mobile?.handle?.update?.({ navigation: composition, actions });
		const revision = ++backgroundRevision;
		const overlayChanged = mounted.overlay?.key !== composition.overlay?.key;
		if (composition.overlay) {
			// Reset before revealing/mounting a new route so stale scroll position
			// cannot flash while the new detail view is being inserted.
			showOverlay(composition.overlay, overlayChanged);
			await reconcileRegion('overlay', overlayContent, composition.overlay);
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
		if (!composition.overlay) overlayRestoreStates.clear();
		appliedComposition = composition;
	}

	function onEmbeddedCreationNavigate(event) {
		if (event.origin !== location.origin || event.data?.type !== 'prsn-creation-detail-overlay-navigate') return;
		const player = [...root.querySelectorAll('iframe')].find((frame) => frame.contentWindow === event.source);
		if (!player) return;
		const url = new URL(player.src, location.href);
		if (url.origin !== location.origin || url.pathname !== '/audio-card.html') return;
		const id = Number(event.data.creationId);
		if (!Number.isSafeInteger(id) || id <= 0) return;
		void actions.navigate?.(`/creations/${id}`);
	}
	function onComposerNavigate(event) {
		const href = event.detail?.href;
		if (typeof href === 'string') actions.navigate?.(href);
	}

	function destroy() {
		conversationViewport.destroy();
		mobileMedia.removeEventListener('change', onMobileBreakpointChange);
		pageHeader.append(pageActions);
		delete root.dataset.mobileMode;
		delete root.dataset.mobileFooter;
		delete root.dataset.mobileHeader;
		delete root.dataset.mobileBackgroundFooter;
		delete root.dataset.mobileBackgroundHeader;
		document.documentElement.classList.remove('beta-mobile-document-scroll-locked');
		delete root.dataset.mobileScrollOwner;
		document.documentElement.classList.remove('beta-mobile-document-scroll');
		document.body.classList.remove('beta-mobile-document-scroll');
		unmount('mobileHeader', mobileHeaderRegion);
		mobileHeaderRegion.remove();
		composerResize.disconnect();
		messageComposerResize.disconnect();
		searchComposerResize.disconnect();
		backgroundRevision++;
		setHeaderAccessories();
		setHeaderSwitcher();
		unmount('overlay', overlayContent);
		overlayRestoreStates.clear();
		unmount('outlet', outletRegion);
		destroyHandle(creationComposerHandle);
		creationComposerHandle = null;
		rightSidebar.destroy();
		unmount('mobile', mobileRegion);
		unmount('sidebar', sidebarRegion);
		setHeaderMenu();
		setHeaderSwitcher();
		setBackgroundSuppressed(false);
		setSidebarLayoutReady(true);
		document.removeEventListener('keydown', onDocumentKeydown);
		window.removeEventListener('resize', onViewportResize);
		window.removeEventListener('message', onEmbeddedCreationNavigate);
		window.removeEventListener('prsn:navigate', onComposerNavigate);
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
	document.addEventListener('keydown', onDocumentKeydown);
	window.addEventListener('resize', onViewportResize, { passive: true });
	window.addEventListener('message', onEmbeddedCreationNavigate);
	window.addEventListener('prsn:navigate', onComposerNavigate);
	document.body.classList.add('beta-layout');
	setSidebarLayoutReady(false);

	return {
		apply,
		destroy,
		rightSidebar,
		get composition() { return appliedComposition; },
	};
}
