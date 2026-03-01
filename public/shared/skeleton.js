/**
 * Shared skeleton loader markup. Use with global.css skeleton classes for consistent,
 * subtle loading placeholders. Pages compose these into layout-specific skeletons.
 */

/**
 * @param {string} [width] - CSS width (e.g. '40%', '120px'). Omit for full width.
 * @param {string} [modifier] - Optional class modifier, e.g. 'skeleton-line--short'.
 * @returns {string} HTML for a skeleton line
 */
export function skeletonLine(width, modifier = '') {
	const style = width ? ` style="width: ${width};"` : '';
	const mod = modifier ? ` ${modifier}` : '';
	return `<span class="skeleton skeleton-line${mod}"${style} aria-hidden="true"></span>`;
}

/**
 * @param {number} [size] - Pixel size (default 32).
 * @returns {string} HTML for a skeleton circle (e.g. avatar)
 */
export function skeletonCircle(size = 32) {
	return `<span class="skeleton skeleton-circle" style="width: ${size}px; height: ${size}px;" aria-hidden="true"></span>`;
}

/**
 * @param {string} [width] - CSS width (e.g. '80px', '20%'). Omit for default pill width.
 * @param {number} [height] - Pixel height (default 34).
 * @returns {string} HTML for a skeleton pill (e.g. button)
 */
export function skeletonPill(width, height = 34) {
	const w = width ? `width: ${width}; ` : '';
	return `<span class="skeleton skeleton-pill" style="${w}height: ${height}px;" aria-hidden="true"></span>`;
}
