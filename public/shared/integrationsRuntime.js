/**
 * Connections page (/integrations) runtime — standalone and embed (`?embed=1`).
 */

import { createEmbedPageRuntime, notifySpaPageOverlayEmbedReady } from './embedPageRuntime.js';

const runtime = createEmbedPageRuntime('__ps_integrations_embed');

export const isIntegrationsEmbed = runtime.isEmbed;
export const isIntegrationsEmbedFrame = runtime.isEmbedFrame;
export const navigate = runtime.navigate;
export const shellOut = runtime.shellOut;
export const requestCloseOverlay = runtime.requestCloseOverlay;
export const navigateFromModal = runtime.navigateFromModal;
export const bindIntegrationsEmbedNavigation = runtime.bindEmbedNavigation;
export const bindIntegrationsEmbedEscape = runtime.bindEmbedEscape;

/** Reveal the overlay frame once the embed page has themed content mounted. */
export function notifyIntegrationsEmbedReady() {
	if (!runtime.isEmbed()) return false;
	return notifySpaPageOverlayEmbedReady();
}

export { notifySpaPageOverlayEmbedReady };
