// Anchor and composerTop are visual-viewport coordinates (getBoundingClientRect).
// Returned left/top are layout-viewport coordinates for position:fixed.
// Mobile Chrome and zoomed Windows Chrome offset those two viewports; using
// only window.innerHeight drops the picker below the visible screen.
export function reactionPickerPosition({ anchor, popup, viewport, composerTop = null }) {
	const margin = 8;
	const gap = 4;
	const offsetLeft = viewport.offsetLeft || 0;
	const offsetTop = viewport.offsetTop || 0;
	const viewLeft = offsetLeft + margin;
	const viewTop = offsetTop + margin;
	const viewRight = offsetLeft + viewport.width - margin;
	const viewBottom = offsetTop + viewport.height - margin;
	const anchorLeft = anchor.left + offsetLeft;
	const anchorTop = anchor.top + offsetTop;
	const anchorBottom = anchor.bottom + offsetTop;
	const floor = composerTop == null
		? viewBottom
		: Math.min(viewBottom, composerTop + offsetTop - margin);
	const width = popup.width || 0;
	const height = popup.height || 0;
	const belowTop = anchorBottom + gap;
	const aboveTop = anchorTop - gap - height;
	const fitsBelow = belowTop + height <= floor;
	const fitsAbove = aboveTop >= viewTop;
	let top = fitsBelow || !fitsAbove ? belowTop : aboveTop;
	const maxTop = Math.max(viewTop, floor - height);
	top = Math.min(Math.max(top, viewTop), maxTop);
	const maxLeft = Math.max(viewLeft, viewRight - width);
	const left = Math.min(Math.max(anchorLeft, viewLeft), maxLeft);
	return { left: Math.round(left), top: Math.round(top) };
}
