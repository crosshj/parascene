/**
 * Shared skeleton loader markup. Prefer size classes from primitives.css
 * (`.skeleton-circle--36`, `.skeleton-line--w72`, …) over inline styles.
 */

const LINE_WIDTH_CLASS = {
	'16%': 'skeleton-line--w16',
	'34%': 'skeleton-line--short',
	'38%': 'skeleton-line--w38',
	'40%': 'skeleton-line--w40',
	'42%': 'skeleton-line--w42',
	'45%': 'skeleton-line--w45',
	'48%': 'skeleton-line--w48',
	'50%': 'skeleton-line--w50',
	'52%': 'skeleton-line--w52',
	'55%': 'skeleton-line--w55',
	'56%': 'skeleton-line--w56',
	'60%': 'skeleton-line--w60',
	'62%': 'skeleton-line--medium',
	'64%': 'skeleton-line--w64',
	'70%': 'skeleton-line--w70',
	'72%': 'skeleton-line--w72',
	'75%': 'skeleton-line--w75',
	'78%': 'skeleton-line--w78',
	'85%': 'skeleton-line--w85',
	'86%': 'skeleton-line--w86',
	'88%': 'skeleton-line--w88',
	'90%': 'skeleton-line--w90',
	'95%': 'skeleton-line--w95',
};

const CIRCLE_SIZE_CLASS = {
	18: 'skeleton-circle--18',
	22: 'skeleton-circle--22',
	28: 'skeleton-circle--28',
	32: '',
	34: 'skeleton-circle--34',
	36: 'skeleton-circle--36',
	40: 'skeleton-circle--40',
};

const PILL_WIDTH_CLASS = {
	'36px': 'skeleton-pill--w36',
	'48px': 'skeleton-pill--w48',
	'64px': 'skeleton-pill--w64',
	'72px': 'skeleton-pill--w72',
	'88px': 'skeleton-pill--w88',
	'90px': 'skeleton-pill--w90',
	'96px': 'skeleton-pill--w96',
};

const PILL_HEIGHT_CLASS = {
	18: 'skeleton-pill--h18',
	34: '',
	36: 'skeleton-pill--h36',
	44: 'skeleton-pill--h44',
};

/**
 * @param {string} [width] - CSS width percent (e.g. '72%'). Omit for full width.
 * @param {string} [modifier] - Extra classes (e.g. 'skeleton-line--gap-md').
 * @returns {string}
 */
export function skeletonLine(width, modifier = '') {
	const widthClass = width ? LINE_WIDTH_CLASS[String(width).trim()] || '' : '';
	const classes = ['skeleton', 'skeleton-line', widthClass, modifier]
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return `<span class="${classes}" aria-hidden="true"></span>`;
}

/**
 * @param {number} [size] - Pixel size (default 32).
 * @returns {string}
 */
export function skeletonCircle(size = 32) {
	const sizeClass = CIRCLE_SIZE_CLASS[Number(size)] ?? '';
	const classes = ['skeleton', 'skeleton-circle', sizeClass].filter(Boolean).join(' ');
	return `<span class="${classes}" aria-hidden="true"></span>`;
}

/**
 * @param {string} [width] - CSS width (e.g. '80px'). Omit for default pill width.
 * @param {number} [height] - Pixel height (default 34).
 * @returns {string}
 */
export function skeletonPill(width, height = 34) {
	const widthClass = width ? PILL_WIDTH_CLASS[String(width).trim()] || '' : '';
	const heightClass = PILL_HEIGHT_CLASS[Number(height)] ?? '';
	const classes = ['skeleton', 'skeleton-pill', widthClass, heightClass]
		.filter(Boolean)
		.join(' ');
	return `<span class="${classes}" aria-hidden="true"></span>`;
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
				${skeletonLine('72%')}
				${skeletonLine('62%')}
			</div>
			<div class="skeleton-feed-card-actions">
				${skeletonPill('36px', 18)}
				${skeletonPill('36px', 18)}
				${skeletonCircle(18)}
			</div>
		</div>
	</div>`;
}

/** Mobile Feed loading card copied from WWW's global feed skeleton. */
export function renderMobileFeedCardSkeleton() {
	return `<div class="skeleton-feed-card skeleton-feed-card--mobile-www" aria-hidden="true">
		<div class="skeleton-feed-card-image"></div>
		<div class="skeleton-feed-card-footer">
			${skeletonCircle(36)}
			<div class="skeleton-feed-card-content">
				${skeletonLine('72%')}
				${skeletonLine('62%')}
			</div>
		</div>
		<div class="skeleton-feed-card-actions">
			<div class="skeleton-feed-card-actions-primary">${skeletonPill('72px')}${skeletonPill('64px')}${skeletonPill('88px')}</div>
			${skeletonCircle(34)}
		</div>
	</div>`;
}

export function renderMobileFeedCardsSkeleton(count = 4) {
	const n = Math.max(1, Math.min(10, Number(count) || 4));
	return Array.from({ length: n }, () => renderMobileFeedCardSkeleton()).join('');
}

/**
 * Image-only feed tile skeleton (matches `feed-card--image-only` browse lanes).
 * @returns {string}
 */
export function renderFeedCardImageOnlySkeleton() {
	return `<div class="skeleton-feed-card skeleton-feed-card--image-only" aria-hidden="true">
		<div class="skeleton-feed-card-image"></div>
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
 * @param {number} [count] - Number of image-only feed card skeletons (default 4).
 * @returns {string}
 */
export function renderFeedCardsImageOnlySkeleton(count = 4) {
	const n = Math.max(1, Math.min(10, Number(count) || 4));
	return Array.from({ length: n }, () => renderFeedCardImageOnlySkeleton()).join('');
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
			${skeletonLine('50%')}
			${skeletonLine('95%')}
			${skeletonLine('70%')}
			${skeletonLine('40%')}
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
 * @returns {string} HTML for profile hero skeleton (banner + avatar, @handle row, stats, meta lines)
 */
export function renderProfileHeroSkeleton() {
	return `<div class="skeleton-profile-hero" aria-hidden="true">
		<div class="skeleton-profile-banner"></div>
		<div class="skeleton-profile-hero-inner">
			<div class="skeleton-profile-hero-row">
				<span class="skeleton skeleton-circle skeleton-profile-avatar" aria-hidden="true"></span>
				<div class="skeleton-profile-identity">
					${skeletonLine('42%', 'skeleton-profile-handle')}
					${skeletonPill('96px', 34)}
				</div>
			</div>
			<div class="skeleton-profile-hero-stats">
				${skeletonPill('64px', 44)}
				${skeletonPill('48px', 44)}
				${skeletonPill('90px', 44)}
			</div>
			<div class="skeleton-profile-hero-meta">
				${skeletonLine('95%')}
				${skeletonLine('85%')}
				${skeletonLine('90%')}
				${skeletonLine('70%')}
				${skeletonLine('60%')}
				${skeletonLine('75%')}
				${skeletonLine('50%')}
				${skeletonLine('40%')}
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
		${skeletonLine('90%')}
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

/**
 * Chat #challenges pane — a few large blobs (no diagrammed fields).
 * @returns {string} HTML skeleton (wrap in `.challenge-pane-root` in chat messages column)
 */
export function renderChallengePaneSkeleton() {
	return `<div class="challenge-pane-skeleton" aria-hidden="true">
		<span class="skeleton skeleton-line challenge-pane-skeleton-blob-title skeleton-line--w56" aria-hidden="true"></span>
		<div class="challenge-pane-skeleton-strip"></div>
		<div class="challenge-pane-skeleton-blob"></div>
		<div class="challenge-pane-skeleton-blob challenge-pane-skeleton-blob--short"></div>
	</div>`;
}

/**
 * Blank organize card shell (rounded blob).
 * @returns {string}
 */
export function renderChallengesOrganizeCardSkeleton() {
	return `<div class="skeleton challenges-organize-card challenges-organize-card--skeleton" aria-hidden="true"></div>`;
}

/**
 * `/challenges/organize` board skeleton — a few header + card blobs only.
 * @returns {string}
 */
export function renderChallengesOrganizeBoardSkeleton() {
	const header = (widthClass) =>
		`<span class="skeleton skeleton-line challenges-organize-skeleton-header ${widthClass}" aria-hidden="true"></span>`;
	const card = () => renderChallengesOrganizeCardSkeleton();
	return `<div class="challenges-organize-board challenges-organize-board--skeleton" aria-hidden="true">
		<section class="challenges-organize-current">
			${header('skeleton-line--px72')}
			<div class="challenges-organize-card-list challenges-organize-card-list--main">
				${card()}
				${card()}
			</div>
		</section>
		<section class="challenges-organize-draft">
			${header('skeleton-line--px56')}
			<div class="challenges-organize-card-list">
				${card()}
			</div>
		</section>
		<section class="challenges-organize-past">
			${header('skeleton-line--px48')}
			<div class="challenges-organize-card-list">
				${card()}
				${card()}
			</div>
		</section>
	</div>`;
}

/**
 * One chat message row skeleton (meta + bubble lines) for thread/DM/channel loading.
 * @param {string[]} [lineWidths]
 * @returns {string}
 */
export function renderChatThreadMessageSkeleton(lineWidths = ['72%', '48%']) {
	const lines = (Array.isArray(lineWidths) ? lineWidths : ['72%'])
		.map((width) => skeletonLine(width))
		.join('');
	return `<div class="skeleton-chat-msg-row" aria-hidden="true">
		<div class="skeleton-chat-msg-inner">
			<div class="skeleton-chat-msg-meta">
				${skeletonCircle(28)}
				${skeletonLine('34%')}
				${skeletonLine('16%')}
			</div>
			<div class="skeleton-chat-msg-bubble">${lines}</div>
		</div>
	</div>`;
}

/**
 * Row count for chat thread loading skeleton (taller desktop panes need more rows).
 * @returns {number}
 */
export function chatThreadSkeletonRowCount() {
	if (typeof window === 'undefined') return 12;
	const isDesktop = window.matchMedia(
		'(min-width: 1024px) and (hover: hover) and (pointer: fine)'
	).matches;
	if (!isDesktop) return 12;
	const host =
		document.querySelector('[data-chat-messages]') ||
		document.querySelector('.chat-page-messages');
	const h = host instanceof HTMLElement ? host.clientHeight : 0;
	const paneH = h > 0 ? h : window.innerHeight;
	// Meta row + 1–2 bubble lines + padding/gap (see `.skeleton-chat-msg-row`).
	const estimatedRowPx = 54;
	return Math.max(18, Math.min(32, Math.ceil(paneH / estimatedRowPx)));
}

/**
 * @param {number} [count]
 * @returns {string}
 */
export function renderChatThreadSkeleton(count) {
	const lineSets = [
		['78%', '52%'],
		['64%'],
		['88%', '60%', '40%'],
		['55%'],
		['70%', '45%'],
		['50%'],
	];
	const n = Math.max(1, Math.min(32, Number(count) || chatThreadSkeletonRowCount()));
	return `<div class="skeleton-chat-thread" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
		renderChatThreadMessageSkeleton(lineSets[i % lineSets.length])
	).join('')}</div>`;
}
