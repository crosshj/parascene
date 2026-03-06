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

/**
 * @returns {string} HTML for one feed card skeleton (image + footer + actions)
 */
export function renderFeedCardSkeleton() {
	return `<div class="skeleton-feed-card" aria-hidden="true">
		<div class="skeleton-feed-card-image"></div>
		<div class="skeleton-feed-card-footer">
			${skeletonCircle(36)}
			<div class="skeleton-feed-card-content">
				${skeletonLine('72%', 'skeleton-line--short')}
				${skeletonLine('62%', 'skeleton-line--medium')}
			</div>
		</div>
		<div class="skeleton-feed-card-actions">
			<div style="display: inline-flex; align-items: center; gap: 14px;">
				${skeletonPill('72px')}
				${skeletonPill('64px')}
				${skeletonPill('88px')}
			</div>
			${skeletonCircle(34)}
		</div>
	</div>`;
}

/**
 * @param {number} [count] - Number of feed card skeletons (default 4).
 * @returns {string} HTML for N feed card skeletons
 */
export function renderFeedCardsSkeleton(count = 4) {
	const n = Math.max(1, Math.min(10, Number(count) || 4));
	return Array.from({ length: n }, () => renderFeedCardSkeleton()).join('');
}

/**
 * @returns {string} HTML for one grid tile skeleton (1:1, for content-cards-image-grid)
 */
export function renderGridTileSkeleton() {
	return `<div class="skeleton skeleton-grid-tile" aria-hidden="true"></div>`;
}

/**
 * @param {number} [count] - Number of grid tile skeletons (default 8).
 * @returns {string} HTML for N grid tile skeletons
 */
export function renderGridSkeleton(count = 8) {
	const n = Math.max(1, Math.min(30, Number(count) || 8));
	return Array.from({ length: n }, () => renderGridTileSkeleton()).join('');
}

/**
 * @returns {string} HTML for one comment row skeleton (thumb + body lines)
 */
export function renderCommentRowSkeleton() {
	return `<div class="skeleton-comment-row" aria-hidden="true">
		<div class="skeleton-comment-row-thumb"></div>
		<div class="skeleton-comment-row-body">
			${skeletonLine('85%')}
			${skeletonLine('50%', 'skeleton-line--short')}
			${skeletonLine('95%')}
			${skeletonLine('70%', 'skeleton-line--medium')}
			${skeletonLine('40%', 'skeleton-line--short')}
		</div>
	</div>`;
}

/**
 * @param {number} [count] - Number of comment row skeletons (default 10).
 * @returns {string} HTML for N comment row skeletons
 */
export function renderCommentRowsSkeleton(count = 10) {
	const n = Math.max(1, Math.min(15, Number(count) || 10));
	return Array.from({ length: n }, () => renderCommentRowSkeleton()).join('');
}

/**
 * @returns {string} HTML for profile hero skeleton (banner + avatar, name, stats, meta lines)
 */
export function renderProfileHeroSkeleton() {
	return `<div class="skeleton-profile-hero" aria-hidden="true">
		<div class="skeleton-profile-banner"></div>
		<div class="skeleton-profile-hero-inner">
			<div class="skeleton-profile-hero-row">
				${skeletonCircle(96)}
				<div style="display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0;">
					${skeletonLine('45%', 'skeleton-line--short')}
					${skeletonLine('35%', 'skeleton-line--short')}
				</div>
			</div>
			<div class="skeleton-profile-hero-stats">
				${skeletonPill('64px', 44)}
				${skeletonPill('48px', 44)}
				${skeletonPill('90px', 44)}
			</div>
			<div class="skeleton-profile-hero-meta">
				${skeletonLine('95%')}
				${skeletonLine('85%', 'skeleton-line--medium')}
				${skeletonLine('90%')}
				${skeletonLine('70%', 'skeleton-line--medium')}
				${skeletonLine('60%', 'skeleton-line--short')}
				${skeletonLine('75%', 'skeleton-line--medium')}
				${skeletonLine('50%', 'skeleton-line--short')}
				${skeletonLine('40%', 'skeleton-line--short')}
			</div>
		</div>
	</div>`;
}

/**
 * @returns {string} HTML for profile tabs skeleton (row of pill placeholders)
 */
export function renderProfileTabsSkeleton() {
	const count = 5;
	const pills = Array.from({ length: count }, () => skeletonPill('88px', 36)).join('');
	return `<div class="skeleton-tabs" aria-hidden="true">${pills}</div>`;
}

/**
 * @returns {string} HTML for full profile page skeleton (hero + tabs + grid)
 */
export function renderProfilePageSkeleton() {
	return `<div class="skeleton-profile-page" aria-busy="true" aria-label="Loading">
		${renderProfileHeroSkeleton()}
		${renderProfileTabsSkeleton()}
		<div class="skeleton-profile-grid-wrap route-cards content-cards-image-grid">
			${renderGridSkeleton(25)}
		</div>
	</div>`;
}

/**
 * @returns {string} HTML for one server card skeleton (title + description lines)
 */
export function renderServerCardSkeleton() {
	return `<div class="skeleton-server-card" aria-hidden="true">
		${skeletonLine('70%')}
		${skeletonLine('90%', 'skeleton-line--medium')}
	</div>`;
}

/**
 * @param {number} [count] - Number of server card skeletons (default 4).
 * @returns {string} HTML for N server card skeletons
 */
export function renderServerCardsSkeleton(count = 4) {
	const n = Math.max(1, Math.min(8, Number(count) || 4));
	return Array.from({ length: n }, () => renderServerCardSkeleton()).join('');
}
