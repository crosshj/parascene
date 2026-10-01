/* VPS-native compatibility surface for legacy modules that still name the WWW overlay API. */

function routeHref(href, event) {
	if (event?.preventDefault) event.preventDefault();
	const raw = String(href || '').trim();
	if (!raw) return false;
	document.dispatchEvent(new CustomEvent('parascene:navigate', { detail: { href: raw } }));
	return true;
}

export function parseCreationIdFromHref(href) {
	try {
		const match = new URL(String(href || ''), location.origin).pathname.match(/^\/creations\/(\d+)\/?$/);
		if (!match) return null;
		const id = Number(match[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	} catch {
		return null;
	}
}

export const parseCreationNavigationTargetId = parseCreationIdFromHref;

export function parseSpaOverlayTarget(href) {
	const creationId = parseCreationIdFromHref(href);
	return creationId ? { kind: 'creation-detail', creationId, href: `/creations/${creationId}` } : null;
}

export const parseOverlayTarget = parseSpaOverlayTarget;
export const parsePromptLibraryOverlayTarget = () => null;

export function shouldUseSpaPageOverlay() { return true; }
export const shouldUseCreationDetailOverlay = shouldUseSpaPageOverlay;
export const shouldUsePromptLibraryOverlay = shouldUseSpaPageOverlay;

export function isSpaPageOverlayHistoryActive() {
	return history.state?.parasceneOverlay === true;
}
export const isCreationDetailOverlayHistoryActive = isSpaPageOverlayHistoryActive;
export const isPromptLibraryOverlayHistoryActive = isSpaPageOverlayHistoryActive;

export function isSpaPageOverlayOpen() {
	return Boolean(document.querySelector('[data-app-overlay]:not([hidden]), .beta-app-overlay:not([hidden])'));
}
export const isCreationDetailOverlayOpen = isSpaPageOverlayOpen;
export const isPromptLibraryOverlayOpen = isSpaPageOverlayOpen;

export function navigateToSpaPageFromSpa(href, event) { return routeHref(href, event); }
export function navigateToCreationDetailFromSpa(href, event) { return routeHref(href, event); }
export function navigateToMutateFromSpa(href, event) { return routeHref(href, event); }
export function navigateToCreateFromSpa(href = '/create', event) { return routeHref(href, event); }
export const navigateToPromptLibraryFromSpa = navigateToSpaPageFromSpa;

export function openSpaPageOverlayFromHref(href) { return routeHref(href); }
export const openWorkflowOverlayFromHref = openSpaPageOverlayFromHref;
export const openPromptLibraryOverlayFromHref = openSpaPageOverlayFromHref;
export function openCreationDetailOverlay(creationId) { return routeHref(`/creations/${creationId}`); }

export function closeSpaPageOverlay() {
	document.dispatchEvent(new CustomEvent('parascene:dismiss-overlay'));
	return true;
}
export const closeCreationDetailOverlay = closeSpaPageOverlay;
export const closePromptLibraryOverlay = closeSpaPageOverlay;
export const dismissEntireSpaPageOverlay = closeSpaPageOverlay;
export const dismissEntireCreationDetailOverlay = closeSpaPageOverlay;
export const dismissEntirePromptLibraryOverlay = closeSpaPageOverlay;

export function shellOutFromSpaPageOverlay(href) { return routeHref(href); }
export const shellOutFromCreationDetailOverlay = shellOutFromSpaPageOverlay;
export const shellOutFromPromptLibraryOverlay = shellOutFromSpaPageOverlay;
export function assignWithShellOutVeil(href) { window.location.assign(href); }
export function showShellOutVeil() {}
export function hideShellOutVeil() {}

export function isCreationDetailEmbedFrame() { return false; }
export function requestCreationDetailEmbedRoute(href) { return routeHref(href); }
export function routeSpaPageOverlayFromEmbed(href) { return routeHref(href); }
export const routeCreationDetailOverlayFromEmbed = routeSpaPageOverlayFromEmbed;
export const routePromptLibraryOverlayFromEmbed = routeSpaPageOverlayFromEmbed;
export function openInlineLightboxFromEmbed() { return false; }
export function getSpaPageOverlayReturnPath() { return history.state?.parasceneBackgroundUrl || '/creations'; }
export function handleSpaPageOverlayPopstate() { return false; }
export const handleCreationDetailOverlayPopstate = handleSpaPageOverlayPopstate;
export const handlePromptLibraryOverlayPopstate = handleSpaPageOverlayPopstate;
export function setCreationDetailSeedLookup() {}
export function setCreationDetailSeedViewerId() {}
export function prefetchCreateOverlayAssets() { return Promise.resolve(); }
