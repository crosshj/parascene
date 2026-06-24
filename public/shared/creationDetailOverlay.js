/**
 * @deprecated Import from `./spaPageOverlay.js` — thin re-export for backward compatibility.
 */
export {
	closeSpaPageOverlay as closeCreationDetailOverlay,
	dismissEntireSpaPageOverlay as dismissEntireCreationDetailOverlay,
	handleSpaPageOverlayPopstate as handleCreationDetailOverlayPopstate,
	isCreationDetailEmbedFrame,
	isCreationDetailOverlayHistoryActive,
	isCreationDetailOverlayOpen,
	navigateToCreateFromSpa,
	navigateToCreationDetailFromSpa,
	navigateToMutateFromSpa,
	openCreationDetailOverlay,
	openInlineLightboxFromEmbed,
	openSpaPageOverlayFromHref as openWorkflowOverlayFromHref,
	parseCreationIdFromHref,
	parseCreationNavigationTargetId,
	parseOverlayTarget,
	requestCreationDetailEmbedRoute,
	routeCreationDetailOverlayFromEmbed,
	shouldUseCreationDetailOverlay,
	shellOutFromSpaPageOverlay as shellOutFromCreationDetailOverlay,
} from './spaPageOverlay.js';
