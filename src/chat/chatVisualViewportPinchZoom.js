/**
 * Pinch-zoom uses visualViewport resize/scroll too; shell sync must ignore those gestures.
 * Keyboard and URL-bar changes keep scale at 1.
 */
export function isVisualViewportPinchZoomed() {
	const vv = window.visualViewport;
	if (!vv || typeof vv.scale !== 'number' || !Number.isFinite(vv.scale)) return false;
	return Math.abs(vv.scale - 1) > 0.01;
}
