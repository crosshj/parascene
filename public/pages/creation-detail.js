import { formatDateTime, formatRelativeTime } from '/shared/datetime.js';
import { enableLikeButtons, getCreationLikeCount, initLikeButton } from '/shared/likes.js';
import { fetchJsonWithStatusDeduped } from '/shared/api.js';
import { getAvatarColor } from '/shared/avatar.js';
import { fetchCreatedImageActivity, postCreatedImageComment } from '/shared/comments.js';
import { processUserText, hydrateUserTextLinks } from '/shared/userText.js';
import { attachAutoGrowTextarea } from '/shared/autogrow.js';
import { textsSameWithinTolerance } from '/shared/textCompare.js';
import { buildProfilePath } from '/shared/profileLinks.js';
import { getNsfwObscure, NSFW_VIEW_BODY_CLASS } from '/shared/nsfwView.js';
import { addToMutateQueue, loadMutateQueue, removeFromMutateQueueByImageUrl } from '/shared/mutateQueue.js';
import '../components/modals/publish.js';
import '../components/modals/creation-details.js';
import '../components/modals/share.js';
import { creditIcon, eyeHiddenIcon, shareIcon, sparkleIcon } from '../icons/svg-strings.js';
import '../components/modals/tip-creator.js';
import { renderEmptyState, renderEmptyLoading, renderEmptyError } from '/shared/emptyState.js';
import { skeletonLine, skeletonCircle, skeletonPill } from '/shared/skeleton.js';
import { buildCreationCardShell } from '/shared/creationCard.js';
import { renderCommentAvatarHtml } from '/shared/commentItem.js';

const html = String.raw;
const TIP_MIN_VISIBLE_BALANCE = 10.0;

/** Normalize image URL for queue match (origin + path). Same idea as creation-edit toParasceneImageUrl. */
function normalizeImageUrlForQueue(raw) {
	const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const parsed = new URL(value, base);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

/** SVG + label for each creation-detail action. inKebabMenu: true = only in more menu (no pill); false = only as pill. */
const CREATION_DETAIL_ACTION_DEFS = [
	{
		key: 'publish',
		dataAttr: 'data-publish-btn',
		btnClass: 'btn-primary',
		inKebabMenu: false,
		inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" fill="none" />
</svg>
Publish`,
		show: (c) => c?.showPublish,
		disabled: (c) => !c?.showPublish
	},
	{
		key: 'mutate',
		dataAttr: 'data-mutate-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: false,
		inner: html`<span class="creation-detail-action-strip-pill-icon">${sparkleIcon('')}</span>
Mutate`,
		show: (c) => c?.showMutate,
		disabled: (c) => !c?.showMutate
	},
	{
		key: 'share',
		dataAttr: 'data-share-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: false,
		inner: html`<span class="creation-detail-action-strip-pill-icon">${shareIcon('')}</span>
Share`,
		show: (c) => c?.showShare,
		disabled: (c) => !c?.showShare
	},
	{
		key: 'edit',
		dataAttr: 'data-edit-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: false,
		inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z" stroke="currentColor" stroke-width="1.5"
		stroke-linecap="round" stroke-linejoin="round" fill="none" />
</svg>
Edit`,
		show: (c) => c?.showEdit,
		disabled: (c) => !c?.showEdit
	},
	{
		key: 'unpublish',
		dataAttr: 'data-unpublish-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: true,
		inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" fill="none" />
</svg>
Un-publish`,
		show: (c) => c?.showUnpublish,
		disabled: (c) => !c?.showUnpublish
	},
	{
		key: 'retry',
		dataAttr: 'data-retry-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: false,
		inner: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path d="M3 12a9 9 0 1 0 3-6.708" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" />
	<polyline points="3 4 3 10 9 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" />
</svg>
Retry`,
		show: (c) => c?.showRetry,
		disabled: (c) => !c?.showRetry
	},
	{
		key: 'more-info',
		dataAttr: 'data-more-info-btn',
		btnClass: 'btn-outlined',
		inKebabMenu: false,
		inner: html`<span class="creation-detail-action-strip-pill-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M12 8v8"></path>
		<path d="M12 6h.01"></path>
	</svg></span>
More Info`,
		show: (c) => c?.showMoreInfoPill,
		disabled: () => false
	},
	{
		key: 'delete',
		dataAttr: 'data-delete-btn',
		btnClass: 'btn-outlined btn-danger-outlined',
		inKebabMenu: true,
		inner: html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px; vertical-align: middle;">
	<path
		d="M2 4H14M12.5 4V13.5C12.5 14.3284 11.8284 15 11 15H5C4.17157 15 3.5 14.3284 3.5 13.5V4M5.5 4V2.5C5.5 1.67157 6.17157 1 7 1H9C9.82843 1 10.5 1.67157 10.5 2.5V4M6.5 7.5V11.5M9.5 7.5V11.5"
		stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`,
		show: (c) => c?.showDelete,
		disabled: (c) => c?.deleteDisabled !== false,
		extraAttrs: (c) => c?.deletePermanent ? ' data-permanent-delete="1"' : '',
		label: (c) => (c?.deleteLabel ?? ' Delete')
	}
];

/**
 * Renders the creation-detail-actions bar. Builds the list of actions that should be shown from ctx, then renders only those.
 * @param {object} [ctx] - When omitted (loading/error states), no buttons are shown. When provided (success), only actions with show(ctx) true are rendered.
 */
function renderCreationDetailActions(ctx) {
	const visible = ctx ? CREATION_DETAIL_ACTION_DEFS.filter((def) => def.show(ctx)) : [];
	const containerStyle = visible.length === 0
		? ' style="opacity: 0; visibility: hidden; pointer-events: none; display: none;"'
		: ' style="opacity: 0; visibility: hidden; pointer-events: none;"';

	const buttonsHtml = visible.map((def) => {
		const disabled = def.disabled(ctx);
		const extraAttrs = def.extraAttrs ? def.extraAttrs(ctx) : '';
		const label = def.label ? def.label(ctx) : '';
		return `<button type="button" class="creation-detail-action-btn ${def.btnClass}" ${def.dataAttr}${disabled ? ' disabled' : ''}${extraAttrs}>${def.inner}${label}</button>`;
	}).join('\n\t');

	return html`
<div class="creation-detail-actions" ${containerStyle}>
	${buttonsHtml}
</div>`;
}

/** Skeleton placeholder for creation-detail-info while content is loading. Mirrors the loaded layout for a smooth transition. */
function renderCreationDetailSkeleton() {
	return html`
<div class="creation-detail-skeleton" aria-label="Loading" aria-busy="true">
	<div class="creation-detail-title-row">
		<div class="skeleton skeleton-line" style="width: 72%; max-width: 320px;"></div>
	</div>
	<div class="creation-detail-title-row">
		<div class="skeleton skeleton-line" style="width: 62%; max-width: 220px;"></div>
	</div>
	<div class="creation-detail-title-byline creation-detail-title-byline-mobile">
		<span class="skeleton skeleton-line skeleton-line--short"></span>
	</div>
	<div class="creation-detail-action-strip">
		<div class="creation-detail-action-strip-scroll">
			<div class="creation-detail-action-strip-avatar">${skeletonCircle(40)}</div>
			<div class="creation-detail-action-strip-creator-info">
				<div class="skeleton skeleton-line skeleton-line--short" style="margin-bottom: 4px;"></div>
				<div class="skeleton skeleton-line skeleton-line--medium"></div>
			</div>
			${skeletonPill('72px')}
			${skeletonPill('64px')}
			${skeletonPill('88px')}
			<span class="skeleton skeleton-circle" style="width: 34px; height: 34px;"></span>
		</div>
	</div>
	<div class="creation-detail-skeleton-description">
		<span class="skeleton skeleton-line" style="display: block; margin-bottom: 6px;"></span>
		<span class="skeleton skeleton-line" style="display: block; margin-bottom: 6px; width: 95%;"></span>
		<span class="skeleton skeleton-line skeleton-line--medium" style="display: block;"></span>
	</div>
	<div class="comment-input">
		<div class="comment-avatar">${skeletonCircle(32)}</div>
		<div class="comment-input-body">
			<span class="skeleton skeleton-line" style="display: block; height: 40px; border-radius: 8px;"></span>
		</div>
	</div>
	<div class="comments-toolbar">
		<div class="skeleton skeleton-line" style="width: 120px;"></div>
		<div class="skeleton skeleton-line" style="width: 100px; margin-left: auto;"></div>
	</div>
	<div class="comment-list">
		<div class="creation-detail-skeleton-comment">${skeletonCircle(32)}<div><span
					class="skeleton skeleton-line skeleton-line--short"
					style="display: block; margin-bottom: 4px;"></span><span
					class="skeleton skeleton-line skeleton-line--medium" style="display: block;"></span></div>
		</div>
		<div class="creation-detail-skeleton-comment">${skeletonCircle(32)}<div><span
					class="skeleton skeleton-line skeleton-line--medium"
					style="display: block; margin-bottom: 4px;"></span><span
					class="skeleton skeleton-line skeleton-line--short" style="display: block;"></span></div>
		</div>
	</div>
</div>`;
}

/** Renders visible actions as pills for the mobile scroll row. Only actions with inKebabMenu === false are shown (items in the more menu are not duplicated as pills). */
function renderCreationDetailMobilePills(ctx) {
	if (!ctx) return '';
	const visible = CREATION_DETAIL_ACTION_DEFS.filter((def) => def.show(ctx) && !def.inKebabMenu);
	return visible.map((def) => {
		const disabled = def.disabled(ctx);
		const extraAttrs = def.extraAttrs ? def.extraAttrs(ctx) : '';
		const label = def.label ? def.label(ctx) : '';
		return `<button type="button" class="creation-detail-action-strip-pill" ${def.dataAttr}${disabled ? ' disabled' : ''}${extraAttrs}>${def.inner}${label}</button>`;
	}).join('\n\t\t\t\t');
}

async function copyTextToClipboard(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// ignore
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

function formatDuration(meta) {
	if (!meta) return '';
	const durationMs =
		typeof meta.duration_ms === 'number' && Number.isFinite(meta.duration_ms)
			? meta.duration_ms
			: null;
	let ms = durationMs;
	if (ms == null) {
		const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
		const endedRaw = meta.completed_at || meta.failed_at || null;
		const ended = endedRaw ? Date.parse(endedRaw) : NaN;
		if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
			ms = ended - started;
		}
	}
	if (!Number.isFinite(ms) || ms <= 0) return '';
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		const remMin = minutes % 60;
		return `${hours}h ${remMin}m`;
	}
	return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

function setupCollapsibleDescription(rootEl) {
	const root = rootEl instanceof Element ? rootEl : document;
	const wrap = root.querySelector('[data-description-wrap]');
	const descriptionEl = root.querySelector('[data-description]');
	const toggleBtn = root.querySelector('[data-description-toggle]');

	if (!(wrap instanceof HTMLElement)) return;
	if (!(descriptionEl instanceof HTMLElement)) return;
	if (!(toggleBtn instanceof HTMLButtonElement)) return;

	if (!wrap.dataset.psDescInit) {
		// Default state: collapsed, but only keep it if it actually overflows.
		wrap.classList.add('is-collapsed');
		wrap.dataset.psDescInit = '1';
	}

	if (!descriptionEl.id) {
		descriptionEl.id = 'creation-detail-description';
	}
	toggleBtn.setAttribute('aria-controls', descriptionEl.id);
	function update() {
		// Measure overflow using the collapsed max-height enforced by CSS.
		// This avoids fragile computed line-height math across browsers.
		const wasCollapsed = wrap.classList.contains('is-collapsed');
		wrap.classList.add('is-measuring');
		wrap.classList.add('is-collapsed');
		const delta = descriptionEl.scrollHeight - descriptionEl.clientHeight;
		wrap.classList.remove('is-measuring');
		// Tolerate small sub-pixel rounding differences that can vary by browser/font.
		const overflows = delta > 4;
		if (!overflows) {
			wrap.classList.remove('is-collapsed');
			toggleBtn.hidden = true;
			return;
		}

		toggleBtn.hidden = false;
		// Restore expanded state if user already expanded it.
		if (!wasCollapsed) wrap.classList.remove('is-collapsed');
		const isCollapsed = wrap.classList.contains('is-collapsed');
		toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
		toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
	}

	update();

	// Run again once layout has fully settled (fonts/styles can affect measurements).
	requestAnimationFrame(() => requestAnimationFrame(update));

	// Keep accurate on responsive layout changes and async link title hydration.
	if (typeof window.ResizeObserver === 'function') {
		const ro = new ResizeObserver(() => update());
		ro.observe(descriptionEl);
	}
	window.addEventListener('resize', update, { passive: true });

	if (!toggleBtn.dataset.psDescToggleBound) {
		toggleBtn.dataset.psDescToggleBound = '1';
		toggleBtn.addEventListener('click', () => {
			const isCollapsed = wrap.classList.toggle('is-collapsed');
			toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
			toggleBtn.textContent = isCollapsed ? 'View Full' : 'Collapse';
		});
	}
}

// Set up URL change detection BEFORE header component loads
// This ensures we capture navigation events

// Get creation ID from URL
function getCreationId() {
	// Only use injected share context while we're actually on a share-mounted URL.
	// Otherwise it "sticks" across navigation and breaks header/mobile nav routing.
	if (isShareMountedView()) {
		if (window.__ps_share_context && Number.isFinite(Number(window.__ps_share_context.creationId))) {
			const id = Number(window.__ps_share_context.creationId);
			return id > 0 ? id : null;
		}
	}
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)$/);
	return match ? parseInt(match[1], 10) : null;
}

function isShareMountedView() {
	return Boolean(
		window.__ps_share_context &&
		typeof window.__ps_share_context === 'object' &&
		typeof window.location?.pathname === 'string' &&
		window.location.pathname.startsWith('/s/')
	);
}

function getPrimaryLinkUrl(creationId) {
	// When this page is served at a share URL (/s/...), keep the share URL as the primary link.
	// Otherwise, use the canonical in-app creation URL.
	if (isShareMountedView()) {
		return window.location.href;
	}
	return new URL(`/creations/${creationId}`, window.location.origin).toString();
}

const RELATED_BATCH_SIZE = 40;
const RELATED_STORAGE_KEY_PREFIX = 'related_transition_';
const RELATED_EXCLUDE_IDS_CAP = 200;
const RECSYS_RANDOM_ONLY_SEEN_THRESHOLD = 120;

function recordTransitionFromQuery(currentCreationId) {
	const params = new URLSearchParams(window.location.search);
	const fromRaw = params.get('from');
	const fromId = fromRaw != null ? parseInt(fromRaw, 10) : NaN;
	if (!Number.isFinite(fromId) || fromId < 1 || fromId === currentCreationId) return;
	const key = `${RELATED_STORAGE_KEY_PREFIX}${fromId}_${currentCreationId}`;
	try {
		if (sessionStorage.getItem(key)) return;
	} catch {
		return;
	}
	fetch('/api/creations/transitions', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from_created_image_id: fromId,
			to_created_image_id: currentCreationId
		})
	}).then((res) => {
		if (res.ok) {
			try {
				sessionStorage.setItem(key, '1');
			} catch {
				// ignore
			}
			const url = new URL(window.location.href);
			url.searchParams.delete('from');
			const newUrl = url.pathname + (url.search ? url.search : '') + (url.hash || '');
			window.history.replaceState(window.history.state, '', newUrl);
		}
	}).catch(() => { });
}

function initRelatedSection(root, currentCreationId, options = {}) {
	const container = root.querySelector('[data-related-container]');
	const grid = root.querySelector('[data-related-grid]');
	const sentinel = root.querySelector('[data-related-sentinel]');
	if (!container || !grid || !sentinel) return;
	const showRecsysDebug = options?.showRecsysDebug === true;

	function escapeHtml(val) {
		return String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function decodeHtmlEntities(val) {
		const text = String(val ?? '');
		if (!text.includes('&')) return text;
		const textarea = document.createElement('textarea');
		textarea.innerHTML = text;
		return textarea.value;
	}

	let relatedIds = [];
	const relatedIdsSet = new Set();
	let hasMore = false;
	let isLoading = false;
	let randomMode = false;
	let relatedObserver = null;

	function relatedCardUrl(createdImageId) {
		return `/creations/${createdImageId}?from=${currentCreationId}`;
	}

	function isSentinelNearViewport() {
		if (!sentinel) return false;
		const rect = sentinel.getBoundingClientRect();
		return rect.top <= (window.innerHeight + 240);
	}

	function setRelatedMediaBackground(mediaEl, url) {
		if (!mediaEl || !url) return;
		if (mediaEl.dataset.bgLoadedUrl === url) return;
		const img = new Image();
		img.onload = () => {
			mediaEl.dataset.bgLoadedUrl = url;
			mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
		};
		img.src = url;
	}

	function buildRelatedReasonRows(item) {
		const rows = [];
		if (Number.isFinite(Number(item?.recsys_score))) {
			let scoreLine = `Score ${Number(item.recsys_score).toFixed(2)}`;
			if (Number.isFinite(Number(item?.recsys_click_score))) {
				const shareText = Number.isFinite(Number(item?.recsys_click_share))
					? ` (${(Number(item.recsys_click_share) * 100).toFixed(1)}%)`
					: '';
				scoreLine += ` | Click ${Number(item.recsys_click_score).toFixed(4)}${shareText}`;
			}
			rows.push(scoreLine);
		}
		const details = Array.isArray(item?.reason_details) ? item.reason_details : [];
		for (const d of details.slice(0, 3)) {
			if (!d?.label) continue;
			const relId = d.related_creation_id;
			const relTitle = d.related_creation_title;
			if (relId || relTitle) {
				rows.push(`${d.label}: ${relTitle || 'Untitled'}${relId ? ` (#${relId})` : ''}`);
			} else {
				rows.push(String(d.label));
			}
		}
		if (rows.length === 0) {
			const labels = Array.isArray(item?.reason_labels) ? item.reason_labels : [];
			for (const label of labels.slice(0, 3)) rows.push(String(label));
		}
		return rows;
	}

	function appendRelatedCards(items) {
		if (!items || items.length === 0) return;
		const startIndex = grid.querySelectorAll('.route-card').length;
		items.forEach((item, i) => {
			if (!item || typeof item !== 'object') return;
			const cid = item.created_image_id ?? item.id;
			if (!cid) return;
			const card = document.createElement('div');
			card.className = 'route-card route-card-image';
			card.setAttribute('role', 'listitem');
			const authorUserId = item.user_id != null ? Number(item.user_id) : null;
			const profileHref = buildProfilePath({ userName: item.author_user_name, userId: authorUserId });
			const authorLabel = item.author_display_name || item.author_user_name || item.author || 'User';
			const handleText = item.author_user_name || '';
			const handle = handleText ? `@${handleText}` : '';
			const href = relatedCardUrl(cid);
			const reasonRows = showRecsysDebug ? buildRelatedReasonRows(item) : [];
			const reasonsHtml = showRecsysDebug && reasonRows.length > 0
				? `<div class="creation-detail-related-reasons">${reasonRows.map((line) => `<div class="creation-detail-related-reason-line">${escapeHtml(line)}</div>`).join('')}</div>`
				: '';
			const detailsContent = html`
						<div class="route-title">${escapeHtml(decodeHtmlEntities(item.title != null ? item.title : 'Untitled'))}</div>
						<div class="route-summary">${escapeHtml(decodeHtmlEntities(item.summary != null ? item.summary : ''))}</div>
						<div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
						<div class="route-meta">
							By ${profileHref ? html`<a class="user-link" href="${profileHref}"
								data-related-profile-link>${escapeHtml(decodeHtmlEntities(authorLabel))}</a>` :
							escapeHtml(decodeHtmlEntities(authorLabel))}${handle ? html` <span>(${handle})</span>` : ''}
						</div>
						${reasonsHtml}
						<div class="route-meta route-meta-spacer"></div>
						<div class="route-tags">${escapeHtml(item.tags ?? '')}</div>`;
			card.innerHTML = buildCreationCardShell({
				mediaAttrs: { 'data-related-media': true, 'data-image-id': cid, 'data-status': 'completed' },
				detailsContentHtml: detailsContent,
				nsfw: Boolean(item.nsfw),
			});
			card.style.cursor = 'pointer';
			card.addEventListener('click', (e) => {
				if (e.target.closest('.user-link')) return;
				window.location.href = href;
			});
			const mediaEl = card.querySelector('[data-related-media]');
			const bgUrl = (item.thumbnail_url || item.image_url || '').trim();
			if (mediaEl && bgUrl) {
				mediaEl.dataset.bgUrl = bgUrl;
				if (startIndex + i < 6) setRelatedMediaBackground(mediaEl, bgUrl);
				else {
					const io = new IntersectionObserver((entries) => {
						entries.forEach((entry) => {
							if (entry.isIntersecting && mediaEl.dataset.bgUrl) {
								setRelatedMediaBackground(mediaEl, mediaEl.dataset.bgUrl);
								io.disconnect();
							}
						});
					}, { rootMargin: '100px', threshold: 0 });
					io.observe(mediaEl);
				}
			}
			const profileLink = card.querySelector('[data-related-profile-link]');
			if (profileLink) {
				profileLink.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					window.location.href = profileLink.getAttribute('href') || '#';
				});
			}
			grid.appendChild(card);
		});
	}

	async function loadRelated(excludeIds = null) {
		if (isLoading) return;
		isLoading = true;
		try {
			const params = new URLSearchParams();
			params.set('limit', String(RELATED_BATCH_SIZE));
			if (excludeIds && excludeIds.length > 0) params.set('exclude_ids', excludeIds.join(','));
			if (randomMode) params.set('force_random', '1');
			else if (relatedIds.length >= RECSYS_RANDOM_ONLY_SEEN_THRESHOLD) params.set('seen_count', String(relatedIds.length));
			const res = await fetch(`/api/creations/${currentCreationId}/related?${params}`, { credentials: 'include' });
			if (!res.ok) {
				container.style.display = 'none';
				return;
			}
			const data = await res.json();
			const rawItems = Array.isArray(data?.items) ? data.items : [];
			let items = [];
			hasMore = Boolean(data?.hasMore);
			if (randomMode) {
				// In random mode, allow previously seen IDs so the feed never stalls.
				items = rawItems.filter((it) => {
					const id = it?.created_image_id ?? it?.id;
					if (id == null) return false;
					relatedIds.push(id);
					return true;
				});
			} else {
				// Deterministic mode: dedupe strictly across what we've already rendered.
				items = rawItems.filter((it) => {
					const id = it?.created_image_id ?? it?.id;
					if (id == null || relatedIdsSet.has(id)) return false;
					relatedIdsSet.add(id);
					relatedIds.push(id);
					return true;
				});
			}
			if (items.length > 0) {
				container.style.display = '';
				appendRelatedCards(items);
			}
			if (!hasMore) {
				randomMode = true;
				hasMore = true;
				if (sentinel) sentinel.style.display = '';
			}
		} finally {
			isLoading = false;
			// If the sentinel remains in view, continue auto-loading.
			// Use a small delay to avoid tight request loops when responses are sparse.
			if (hasMore && relatedIds.length > 0 && isSentinelNearViewport()) {
				window.setTimeout(() => {
					loadMoreRelated();
				}, 180);
			}
		}
	}

	function loadMoreRelated() {
		if (!hasMore || isLoading || relatedIds.length === 0) return;
		// Keep excludes tighter in random mode to reduce request lock-in.
		const excludeTail = randomMode
			? Math.min(40, RELATED_EXCLUDE_IDS_CAP)
			: RELATED_EXCLUDE_IDS_CAP;
		const excludeIds = [currentCreationId, ...relatedIds.slice(-excludeTail)];
		loadRelated(excludeIds);
	}

	function observeSentinel() {
		if (!sentinel || !hasMore) return;
		relatedObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) loadMoreRelated();
			});
		}, { rootMargin: '200px', threshold: 0 });
		relatedObserver.observe(sentinel);
	}

	void loadRelated().then(() => {
		if (hasMore) observeSentinel();
	});
}

// Store original history methods before anything else modifies them
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

function setActionsLoadingState() {
	const actionsEl = document.querySelector('.creation-detail-actions');
	if (!actionsEl) return;
	actionsEl.classList.remove('is-ready');
	actionsEl.style.display = '';
	// Also enforce hidden state in case inline styles exist.
	actionsEl.style.opacity = '0';
	actionsEl.style.visibility = 'hidden';
	actionsEl.style.pointerEvents = 'none';
}

async function loadCreation() {
	const detailContent = document.querySelector('[data-detail-content]');
	const imageEl = document.querySelector('[data-image]');
	const backgroundEl = document.querySelector('[data-background]');
	const imageWrapper = imageEl?.closest?.('.creation-detail-image-wrapper');

	if (!detailContent || !imageEl || !backgroundEl) return;

	// Render actions + skeleton so we have a live actions element; hide until ownership is resolved.
	detailContent.innerHTML = renderCreationDetailActions() + renderCreationDetailSkeleton();
	let actionsEl = detailContent.querySelector('.creation-detail-actions');
	if (actionsEl) {
		actionsEl.classList.remove('is-ready');
		actionsEl.style.display = '';
		actionsEl.style.opacity = '0';
		actionsEl.style.visibility = 'hidden';
		actionsEl.style.pointerEvents = 'none';
	}

	// Attach image load/error handlers once, so broken-image icons never show
	if (!imageEl.dataset.fallbackAttached) {
		imageEl.dataset.fallbackAttached = '1';

		imageEl.addEventListener('load', () => {
			const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
			if (modIcon) modIcon.remove();
			imageWrapper?.classList.remove('image-loading', 'image-error', 'image-error-moderated');
			if (imageEl.dataset.currentUrl) {
				backgroundEl.style.backgroundImage = `url('${imageEl.dataset.currentUrl}')`;
			}
			imageEl.style.visibility = 'visible';
		});

		imageEl.addEventListener('error', () => {
			// Show error placeholder; do not clear moderated state — loadCreation() may have already set it for a failed creation
			imageWrapper?.classList.remove('image-loading');
			imageWrapper?.classList.add('image-error');
			backgroundEl.style.backgroundImage = '';
			// Hide default browser broken-image UI
			imageEl.style.visibility = 'hidden';
		});
	}

	const creationId = getCreationId();
	if (!creationId) {
		imageWrapper?.classList.remove('image-loading', 'nsfw', 'image-error-moderated');
		imageWrapper?.classList.add('image-error');
		imageWrapper?.removeAttribute('data-creation-id');
		backgroundEl.style.backgroundImage = '';
		imageEl.style.visibility = 'hidden';
		imageEl.src = '';
		delete imageEl.dataset.currentUrl;
		detailContent.innerHTML = renderCreationDetailActions() + renderEmptyState({ title: 'Invalid creation ID' });
		actionsEl = detailContent.querySelector('.creation-detail-actions');
		if (actionsEl) actionsEl.style.display = 'none';
		return;
	}

	detailContent.innerHTML = renderCreationDetailActions() + renderCreationDetailSkeleton();
	actionsEl = detailContent.querySelector('.creation-detail-actions');

	try {
		const headers = {};
		if (window.__ps_share_context && typeof window.__ps_share_context === 'object') {
			const shareVersion = typeof window.__ps_share_context.version === 'string' ? window.__ps_share_context.version : '';
			const shareToken = typeof window.__ps_share_context.token === 'string' ? window.__ps_share_context.token : '';
			if (shareVersion && shareToken) {
				headers['x-share-version'] = shareVersion;
				headers['x-share-token'] = shareToken;
			}
		}

		const response = await fetch(`/api/create/images/${creationId}`, {
			credentials: 'include',
			headers
		});
		if (!response.ok) {
			if (response.status === 404) {
				// Show image-error state (rectangle-with-slash icon), not loading animation
				imageWrapper?.classList.remove('image-loading', 'nsfw', 'image-error-moderated');
				imageWrapper?.classList.add('image-error');
				imageWrapper?.removeAttribute('data-creation-id');
				backgroundEl.style.backgroundImage = '';
				imageEl.style.visibility = 'hidden';
				imageEl.src = '';
				delete imageEl.dataset.currentUrl;
				detailContent.innerHTML = renderCreationDetailActions() + renderEmptyState({
					title: 'Creation not found',
					message: "The creation you're looking for doesn't exist or you don't have access to it.",
				});
				actionsEl = detailContent.querySelector('.creation-detail-actions');
				if (actionsEl) actionsEl.style.display = 'none';
				return;
			}
			throw new Error('Failed to load creation');
		}

		const creation = await response.json();

		// Fetch direct children (published creations with mutate_of_id = this id), order by created_at
		const childrenPromise = fetch(`/api/create/images/${creationId}/children`, { credentials: 'include' })
			.then((r) => (r.ok ? r.json() : []))
			.catch(() => []);

		const status = creation.status || 'completed';
		const meta = creation.meta || null;
		const timeoutAt = meta && typeof meta.timeout_at === 'string' ? new Date(meta.timeout_at).getTime() : NaN;
		const isTimedOut = status === 'creating' && Number.isFinite(timeoutAt) && Date.now() > timeoutAt;
		const isFailed = status === 'failed' || isTimedOut;
		const shareMounted = isShareMountedView();

		// Load like metadata from backend (no localStorage fallback).
		let likeMeta = { like_count: 0, viewer_liked: false };
		// When the detail page is served at a share URL (/s/...), don't touch likes for private/unpublished creations.
		// Likes are a "public surface area" and we don't want extra API calls here.
		if (!shareMounted) {
			try {
				const likeRes = await fetch(`/api/created-images/${creationId}/like`, { credentials: 'include' });
				if (likeRes.ok) {
					const meta = await likeRes.json();
					likeMeta = {
						like_count: Number(meta?.like_count ?? 0),
						viewer_liked: Boolean(meta?.viewer_liked)
					};
				}
			} catch {
				// ignore like meta load failures
			}
		}

		const creationWithLikes = { ...creation, ...likeMeta, created_image_id: creationId };
		lastCreationMeta = creation;
		const likeCount = getCreationLikeCount(creationWithLikes);

		// Set image and blurred background depending on status
		imageWrapper?.classList.remove('image-error');
		imageWrapper?.classList.remove('image-loading');
		imageWrapper?.classList.toggle('nsfw', !!(creation.nsfw ?? creation.meta?.nsfw));
		if (imageWrapper) {
			if (creation.nsfw ?? creation.meta?.nsfw) {
				imageWrapper.setAttribute('data-creation-id', String(creationId));
			} else {
				imageWrapper.removeAttribute('data-creation-id');
			}
		}
		backgroundEl.style.backgroundImage = '';
		imageEl.style.visibility = 'hidden';
		imageEl.dataset.currentUrl = '';
		imageEl.src = '';

		if (status === 'completed' && creation.url) {
			const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
			if (modIcon) modIcon.remove();
			imageWrapper?.classList.remove('image-error-moderated');
			imageWrapper?.classList.add('image-loading');
			imageEl.dataset.currentUrl = creation.url;
			imageEl.src = creation.url;
		} else if (status === 'creating' && !isTimedOut) {
			const modIcon = imageWrapper?.querySelector('.creation-detail-error-icon-moderated');
			if (modIcon) modIcon.remove();
			imageWrapper?.classList.remove('image-error-moderated');
			imageWrapper?.classList.add('image-loading');
		} else if (isFailed) {
			// Failed or timed out: show error placeholder (use imageWrapper so we target the same hero element we cleared)
			if (imageWrapper) {
				const isModerated = creation.is_moderated_error === true;
				if (!isModerated) {
					const existingModIcon = imageWrapper.querySelector('.creation-detail-error-icon-moderated');
					if (existingModIcon) existingModIcon.remove();
					imageWrapper.classList.remove('image-error-moderated');
				}
				imageWrapper.classList.add('image-error');
				if (isModerated) {
					imageWrapper.classList.add('image-error-moderated');
					if (!imageWrapper.querySelector('.creation-detail-error-icon-moderated')) {
						const moderatedIconEl = document.createElement('span');
						moderatedIconEl.className = 'creation-detail-error-icon-moderated';
						moderatedIconEl.setAttribute('role', 'img');
						moderatedIconEl.setAttribute('aria-label', 'Content moderated');
						moderatedIconEl.innerHTML = eyeHiddenIcon();
						imageWrapper.appendChild(moderatedIconEl);
					}
				}
			} else {
				imageWrapper?.classList.add('image-error');
			}
		}

		// Format date (tooltip only; no visible "time ago" on this page)
		const date = new Date(creation.created_at);
		const createdAtTitle = formatDateTime(date);

		// Generate title from published title or use default
		const isPublished = creation.published === true || creation.published === 1;
		const shareMountedPrivate = shareMounted && !isPublished;
		const displayTitle = creation.title || 'Untitled';
		const isUntitled = !creation.title;

		// Check if current user owns this creation
		let currentUserId = null;
		let currentUser = null;
		let currentUserProfile = null;
		try {
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
			if (profile.ok) {
				currentUser = profile.data ?? null;
				currentUserProfile = currentUser?.profile ?? null;
				currentUserId = currentUser?.id ?? null;
			}
		} catch {
			// ignore
		}

		const isOwner = currentUserId && creation.user_id && currentUserId === creation.user_id;
		const isAdmin = currentUser?.role === 'admin';
		const canEdit = isOwner || isAdmin;
		const enableNsfw = currentUser?.enableNsfw === true;
		const showUnobscured = !getNsfwObscure() || document.body.classList.contains(NSFW_VIEW_BODY_CLASS);
		// Let global NSFW click handler know whether click-to-reveal is allowed on this page
		document.body.dataset.enableNsfw = enableNsfw ? '1' : '0';

		function escapeHtml(value) {
			return String(value ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		async function fetchCreationThumbUrl(id) {
			try {
				const res = await fetch(`/api/create/images/${id}`, { credentials: 'include' });
				if (!res.ok) return null;
				const c = await res.json().catch(() => null);
				const thumb = c?.thumbnail_url || c?.url || null;
				return (typeof thumb === 'string' && thumb.trim()) ? thumb.trim() : null;
			} catch {
				return null;
			}
		}

		// Action buttons: visibility and disabled state (matches original DOM-update logic for all roles and creation states).
		// Publish/Edit/Unpublish/Retry/Delete: canEdit (owner or admin). Mutate: non-admin viewers only. Share: any viewer when not private share.
		// When admin is viewing a user-deleted creation, hide Publish and Edit (admin only gets e.g. Permanently delete).
		const userDeleted = Boolean(creation.user_deleted);
		const adminViewingUserDeleted = isAdmin && userDeleted;
		const showQueueForLater = !isAdmin && status === 'completed' && !isFailed && Boolean(creation.url);
		const normalizedImageUrlForQueue = showQueueForLater ? normalizeImageUrlForQueue(creation.url) : '';
		let isQueuedForLater = false;
		if (showQueueForLater && normalizedImageUrlForQueue) {
			try {
				const queueItems = loadMutateQueue();
				const creationIdNum = Number(creationId);
				isQueuedForLater = queueItems.some((item) => {
					const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl : '';
					const itemSourceIdNum = Number(item?.sourceId);
					const matchesSourceId = Number.isFinite(itemSourceIdNum) && itemSourceIdNum > 0 && itemSourceIdNum === creationIdNum;
					const matchesUrl = itemUrl === normalizedImageUrlForQueue || normalizeImageUrlForQueue(itemUrl) === normalizedImageUrlForQueue;
					return matchesSourceId || matchesUrl;
				});
			} catch {
				// ignore storage errors
			}
		}
		const queueForLaterLabel = isQueuedForLater ? 'Remove from queue' : 'Queue for later';
		const hasDetailsForFailed = isFailed && (Object.keys(meta?.args || {}).length > 0 || (meta?.provider_error != null && typeof meta.provider_error === 'object'));
		const actionsContext = {
			showPublish: canEdit && !isPublished && status === 'completed' && !isFailed && !adminViewingUserDeleted,
			showEdit: canEdit && status === 'completed' && !isFailed && !adminViewingUserDeleted,
			showUnpublish: canEdit && isPublished && !isFailed && !adminViewingUserDeleted,
			showMutate: !isAdmin && status === 'completed' && !isFailed && Boolean(creation.url),
			showShare: !shareMountedPrivate && status === 'completed' && !isFailed,
			showRetry: canEdit && isFailed,
			showMoreInfoPill: hasDetailsForFailed,
			showDelete: canEdit && !(isAdmin && !userDeleted),
			showQueueForLater,
			queueForLaterLabel,
			isFailed,
			deleteDisabled: (userDeleted && isAdmin) ? false : !(!isPublished && (status === 'failed' || (status === 'creating' && isTimedOut) || status === 'completed')),
			deletePermanent: userDeleted && isAdmin,
			deleteLabel: userDeleted && isAdmin ? ' Permanently delete' : ' Delete'
		};

		// User-deleted notice (admin only; owner gets 404)
		let userDeletedNotice = '';
		if (creation.user_deleted) {
			userDeletedNotice = html`
				<div class="creation-detail-user-deleted-notice" role="status">
					User deleted this creation. Visible to admin only.
				</div>
			`;
		}

		// Published display:
		// - Show "Published {time ago}" directly under the user identification line.
		// - Keep description as its own block further down.
		const publishedDateRaw = creation.published_at || creation.created_at || null;
		const publishedDate = publishedDateRaw ? new Date(publishedDateRaw) : null;
		const hasPublishedDate = publishedDate instanceof Date && Number.isFinite(publishedDate.valueOf());
		const publishedTimeAgo = hasPublishedDate ? formatRelativeTime(publishedDate) : '';
		const publishedAtTitle = hasPublishedDate ? formatDateTime(publishedDate) : '';

		let publishedLabel = '';
		if (isPublished) {
			publishedLabel = html`
				<div class="creation-detail-author-published" ${publishedAtTitle ? `title="${publishedAtTitle}" ` : ''}>
					Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}
				</div>
			`;
		}

		// Mobile-only byline under title: "@handle Published 3 hr. ago" or "@handle Not Published"
		const mobileBylineText = isPublished ? (`Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}`) : 'Not Published';

		// Show description whenever it exists, regardless of publication status
		// History thumbnails (mutations lineage)
		const historyRaw = meta?.history;
		const historyIds = Array.isArray(historyRaw)
			? historyRaw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
			: [];

		const historyChainIds = [];
		const seenHistoryIds = new Set();
		for (const id of historyIds) {
			if (seenHistoryIds.has(id)) continue;
			seenHistoryIds.add(id);
			historyChainIds.push(id);
		}
		if (!seenHistoryIds.has(creationId)) {
			historyChainIds.push(creationId);
		}

		const currentIndicatorHtml = `
			<span class="creation-detail-history-current" aria-label="Current creation">
				<span class="creation-detail-history-current-text">current</span>
			</span>
		`;

		// Ancestors: lineage chain (current "lineage" content). NSFW ancestors: blank + no link when !enableNsfw; blurred/unobscured when enableNsfw.
		let ancestorsHtml = '';
		let nsfwById = new Map();
		if (historyIds.length > 0 && historyChainIds.length >= 2) {
			const nonCurrentIds = historyChainIds.filter((id) => id !== creationId);
			try {
				const flagsRes = await fetch(`/api/creations/nsfw-flags?ids=${nonCurrentIds.join(',')}`, { credentials: 'include' });
				if (flagsRes.ok) {
					const flags = await flagsRes.json();
					if (flags && typeof flags === 'object') {
						for (const [k, v] of Object.entries(flags)) nsfwById.set(k, v === true);
					}
				}
			} catch {
				// ignore
			}
			const directParentIds = Array.isArray(meta?.direct_parent_ids)
				? meta.direct_parent_ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
				: [];
			const directParentSet = new Set(directParentIds);
			const usePlusBetween = directParentSet.size >= 2;

			const parts = nonCurrentIds.map((id, index) => {
				const isLastAncestor = index === nonCurrentIds.length - 1;
				const nextId = nonCurrentIds[index + 1];
				const bothDirect = usePlusBetween && !isLastAncestor && directParentSet.has(id) && directParentSet.has(nextId);
				const separator = bothDirect ? '+' : '→';
				const nsfw = nsfwById.get(String(id)) === true;
				if (!enableNsfw && nsfw) {
					return `<span class="creation-detail-history-thumb-link creation-detail-history-nsfw-blank" data-history-id="${id}" aria-label="${escapeHtml(`Creation #${id} (hidden)`)}">#${id}</span><span class="creation-detail-history-arrow" aria-hidden="true">${separator}</span>`;
				}
				const nsfwClass = enableNsfw && nsfw ? (showUnobscured ? ' nsfw nsfw-revealed' : ' nsfw') : '';
				const dataCreationId = enableNsfw && nsfw ? ` data-creation-id="${id}"` : '';
				return `
				<a
					class="creation-detail-history-thumb-link${nsfwClass}"
					href="/creations/${id}"
					aria-label="${escapeHtml(`Go to creation #${id}`)}"
					data-history-id="${id}"${dataCreationId}
				>
					<span class="creation-detail-history-fallback" data-history-fallback>#${id}</span>
					<img class="creation-detail-history-thumb" data-history-img alt="" loading="lazy" style="display: none;" />
				</a>
				<span class="creation-detail-history-arrow" aria-hidden="true">${separator}</span>
			`;
			}).join('');

			ancestorsHtml = html`
				<div class="creation-detail-history-wrap">
					<div class="creation-detail-history-label">Ancestors</div>
					<div class="creation-detail-history" data-creation-history>
						${parts}${currentIndicatorHtml}
					</div>
				</div>
			`;
		}

		// Children: direct derivatives (mutate_of_id = this creation). NSFW children: blank + no link when !enableNsfw; blurred/unobscured when enableNsfw.
		const childrenList = await childrenPromise;
		let childrenHtml = '';
		if (Array.isArray(childrenList) && childrenList.length > 0) {
			const childParts = childrenList.map((child) => {
				const cid = child.id;
				const childNsfw = !!child.nsfw;
				const thumbUrl = (child.thumbnail_url || child.url || '').trim();
				if (!enableNsfw && childNsfw) {
					return `<span class="creation-detail-history-thumb-link creation-detail-history-nsfw-blank" data-child-id="${cid}" aria-label="${escapeHtml(`Creation #${cid} (hidden)`)}">#${cid}</span>`;
				}
				const nsfwClass = enableNsfw && childNsfw ? (showUnobscured ? ' nsfw nsfw-revealed' : ' nsfw') : '';
				const dataCreationId = enableNsfw && childNsfw ? ` data-creation-id="${cid}"` : '';
				return `
				<a
					class="creation-detail-history-thumb-link${nsfwClass}"
					href="/creations/${cid}"
					aria-label="${escapeHtml(`Go to creation #${cid}`)}"
					data-child-id="${cid}"${dataCreationId}
				>
					<span class="creation-detail-history-fallback" data-child-fallback>#${cid}</span>
					<img class="creation-detail-history-thumb" data-child-img alt="" loading="lazy" style="display: none;" data-bg-url="${escapeHtml(thumbUrl)}" />
				</a>
			`;
			}).join('');
			childrenHtml = html`
				<div class="creation-detail-history-wrap">
					<div class="creation-detail-history-label">Children</div>
					<div class="creation-detail-history" data-creation-children>
						${childParts}
					</div>
				</div>
			`;
		}

		const lineageSectionHtml = ancestorsHtml + (childrenHtml || '');

		// Meta-derived values for description section (Server, Method, Duration, Prompt)
		const args = meta?.args ?? null;
		const isPlainObject = args && typeof args === 'object' && !Array.isArray(args);
		const argKeys = isPlainObject ? Object.keys(args) : [];
		const isPromptOnly = isPlainObject && argKeys.length === 1 && Object.prototype.hasOwnProperty.call(args, 'prompt');
		// Show raw user prompt when stored (style flow); otherwise show args.prompt
		const storedUserPrompt = typeof meta?.user_prompt === 'string' ? meta.user_prompt.trim() : '';
		const promptText = storedUserPrompt !== ''
			? storedUserPrompt
			: (isPlainObject && Object.prototype.hasOwnProperty.call(args, 'prompt') && typeof args.prompt === 'string' ? args.prompt.trim() : '');
		const serverName = typeof meta?.server_name === 'string' && meta.server_name.trim()
			? meta.server_name.trim()
			: (meta?.server_id != null ? String(meta.server_id) : '');
		const methodName = typeof meta?.method_name === 'string' && meta.method_name.trim()
			? meta.method_name.trim()
			: (typeof meta?.method === 'string' ? meta.method : '');
		const durationStr = formatDuration(meta || {});

		// Display model from args (to the right of Method in meta bar). Strip after first colon if present.
		const rawModel = isPlainObject && Object.prototype.hasOwnProperty.call(args, 'model')
			? (typeof args.model === 'string' ? args.model.trim() : String(args.model ?? '').trim())
			: '';
		const displayModel = rawModel === ''
			? ''
			: (rawModel.includes(':') ? rawModel.split(':')[0] : rawModel);

		// Style from meta (stored when created via create.html with a style)
		const styleMeta = meta?.style && typeof meta.style === 'object' ? meta.style : null;
		const styleLabel = styleMeta && typeof styleMeta.label === 'string' ? styleMeta.label.trim() : '';
		const styleModifiers = styleMeta && typeof styleMeta.modifiers === 'string' ? styleMeta.modifiers.trim() : '';
		const hasStyle = styleLabel.length > 0;

		// Show description block if we have user description, lineage (ancestors/children), prompt, style, or meta (server/method/duration).
		let descriptionHtml = '';
		const descriptionText = typeof creation.description === 'string' ? creation.description.trim() : '';
		const hasDescription = descriptionText.length > 0;
		const hasPrompt = promptText.length > 0;
		const hasMetaInDescription = !!(serverName || methodName || displayModel || durationStr);
		const showDescriptionBlock = descriptionText || promptText || hasStyle || lineageSectionHtml || hasMetaInDescription;

		if (showDescriptionBlock) {
			const descriptionParts = [];
			const sameAsPrompt = hasDescription && hasPrompt && textsSameWithinTolerance(descriptionText, promptText);

			if (hasDescription && !sameAsPrompt) {
				// Show description first (only when it differs from prompt)
				descriptionParts.push(processUserText(descriptionText));
			}

			if (hasPrompt) {
				// Show prompt section: when same as description, only show this; when different, show after description
				if (hasDescription && !sameAsPrompt) {
					descriptionParts.push('<br><br>');
				}
				descriptionParts.push(html`<div class="creation-detail-prompt-label">Prompt</div>`);
				descriptionParts.push(escapeHtml(promptText));
			}

			if (hasStyle) {
				if (descriptionParts.length) descriptionParts.push('<br><br>');
				descriptionParts.push(html`<div class="creation-detail-prompt-label">Style</div>`);
				descriptionParts.push(escapeHtml(styleLabel));
				if (styleModifiers) {
					descriptionParts.push(html`<div class="creation-detail-style-modifiers">${escapeHtml(styleModifiers)}</div>`);
				}
			}

			const descriptionInnerHtml = descriptionParts.length ? descriptionParts.join('') : '';

			// Build Server/Method/Duration line (outside collapsible)
			let metaLineHtml = '';
			if (serverName || methodName || displayModel || durationStr) {
				const metaItems = [];
				if (serverName && serverName !== 'Parascene') metaItems.push(html`<span class="creation-detail-description-meta-label">Server</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(serverName)}</span>`);
				if (methodName && methodName !== 'Replicate') metaItems.push(html`<span class="creation-detail-description-meta-label">Method</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(methodName)}</span>`);
				if (displayModel) metaItems.push(html`<span class="creation-detail-description-meta-label">Model</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(displayModel)}</span>`);
				if (durationStr) metaItems.push(html`<span class="creation-detail-description-meta-label">Duration</span> <span
	class="creation-detail-description-meta-value">${escapeHtml(durationStr)}</span>`);
				metaLineHtml = html`<div class="creation-detail-description-meta-line">${metaItems.join(' • ')}</div>`;
			}

			descriptionHtml = html`
				<div class="creation-detail-published${lineageSectionHtml ? ' has-history' : ''}">
					${descriptionInnerHtml ? html`
					<div class="creation-detail-description-wrap" data-description-wrap>
						<div class="creation-detail-description" data-description>${descriptionInnerHtml}</div>
						<div class="creation-detail-description-toggle-row">
							<button type="button" class="btn-secondary creation-detail-description-toggle" data-description-toggle
								hidden>View Full</button>
						</div>
					</div>
					` : ''}
					${lineageSectionHtml}
					${metaLineHtml}
				</div>
			`;
		}

		// More Info: show only when the details modal would have content (filtered args or provider error).
		const providerError = meta?.provider_error ?? null;
		let hasDetailsModalContent = false;

		if (args && !isPromptOnly && isPlainObject) {
			const hasHistory = historyIds.length > 0;
			const promptTextInArgs = Object.prototype.hasOwnProperty.call(args, 'prompt') && typeof args.prompt === 'string' ? args.prompt.trim() : '';
			const hasPromptInArgs = promptTextInArgs.length > 0;
			const shouldHidePrompt = hasPromptInArgs;

			const filteredArgs = { ...args };
			if (hasHistory && Object.prototype.hasOwnProperty.call(filteredArgs, 'image_url')) {
				delete filteredArgs.image_url;
			}
			if (shouldHidePrompt && Object.prototype.hasOwnProperty.call(filteredArgs, 'prompt')) {
				delete filteredArgs.prompt;
			}
			if (Object.prototype.hasOwnProperty.call(filteredArgs, 'model')) {
				const mv = filteredArgs.model;
				if (mv != null && String(mv).trim() !== '') {
					delete filteredArgs.model;
				}
			}
			hasDetailsModalContent = Object.keys(filteredArgs).length > 0;
		}
		if (!hasDetailsModalContent && providerError && typeof providerError === 'object') {
			hasDetailsModalContent = true;
		}


		// Get creator information
		const creatorUserName = typeof creation?.creator?.user_name === 'string' ? creation.creator.user_name.trim() : '';
		const creatorDisplayName = typeof creation?.creator?.display_name === 'string' ? creation.creator.display_name.trim() : '';
		const creatorEmailPrefix = creation.creator?.email
			? creation.creator.email.split('@')[0]
			: 'User';
		const creatorName = creatorDisplayName || creatorUserName || creatorEmailPrefix || 'User';
		const creatorHandle = creatorUserName
			? `@${creatorUserName}`
			: (creation.creator?.email ? `@${creatorEmailPrefix}` : '@user');
		const creatorInitial = creatorName.charAt(0).toUpperCase();
		const creatorAvatarUrl = typeof creation?.creator?.avatar_url === 'string' ? creation.creator.avatar_url.trim() : '';
		const creatorId = Number(creation?.creator?.id ?? creation?.user_id ?? 0);
		const creatorColor = getAvatarColor(creatorUserName || creatorEmailPrefix || String(creatorId || '') || creatorName);
		const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
		const creatorPlan = creation?.creator?.plan === 'founder';

		let canShowFollowButton = false;
		let viewerFollowsCreator = false;
		let creatorFollowerCount = 0;

		if (Number.isFinite(creatorId) && creatorId > 0) {
			try {
				const profileSummary = await fetchJsonWithStatusDeduped(
					`/api/users/${creatorId}/profile`,
					{ credentials: 'include' },
					{ windowMs: 800 }
				);
				if (profileSummary.ok && profileSummary.data) {
					creatorFollowerCount = Number(profileSummary.data.stats?.followers_count ?? 0) || 0;
					if (currentUserId && currentUserId !== creatorId) {
						viewerFollowsCreator = Boolean(profileSummary.data.viewer_follows);
						canShowFollowButton = !viewerFollowsCreator;
					}
				}
			} catch {
				// ignore follow state load failures; follow button will be hidden
			}
		}

		const viewerUserName = typeof currentUserProfile?.user_name === 'string' ? currentUserProfile.user_name.trim() : '';
		const viewerDisplayName = typeof currentUserProfile?.display_name === 'string' ? currentUserProfile.display_name.trim() : '';
		const viewerEmailPrefix = currentUser?.email
			? String(currentUser.email).split('@')[0]
			: 'You';
		const viewerName = viewerDisplayName || viewerUserName || viewerEmailPrefix || 'You';
		const viewerInitial = viewerName.charAt(0).toUpperCase();
		const viewerAvatarUrl = typeof currentUserProfile?.avatar_url === 'string' ? currentUserProfile.avatar_url.trim() : '';
		const viewerColor = getAvatarColor(viewerUserName || viewerEmailPrefix || String(currentUserId || '') || viewerName);
		const viewerPlan = currentUser?.plan === 'founder';

		const creatorAvatarContent = creatorAvatarUrl ? html`<img class="creation-detail-author-avatar" src="${creatorAvatarUrl}" alt="">` : creatorInitial;
		const authorAvatar = creatorPlan ? html`
			<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
				<div class="founder-flair-avatar-ring">
					<div class="founder-flair-avatar-inner"
						style="background: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx;" aria-hidden="true">
						${creatorAvatarContent}
					</div>
				</div>
			</div>
		` : html`
			<span class="creation-detail-author-icon" style="background: xxxxxxxxxxxxxxx;">
				${creatorAvatarContent}
			</span>
		`;

		const authorIdentification = html`
			<span class="creation-detail-author-name${creatorPlan ? ' founder-name' : ''}">${creatorName}</span>
			<span class="creation-detail-author-handle${creatorPlan ? ' founder-name' : ''}">${creatorHandle}</span>
		`;

		const hasEngagementActions = !!(isPublished && !isFailed);
		const copyLinkButtonHtml = `
			<button class="feed-card-action" type="button" data-copy-link-button aria-label="Copy link">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
				</svg>
				<span data-copy-link-label>Copy link</span>
			</button>
		`;
		const setAvatarButtonHtml = isOwner ? `
			<button class="feed-card-action" type="button" data-set-avatar-button aria-label="Set as profile picture">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
				<span data-set-avatar-label>Set as profile picture</span>
			</button>
		` : '';

		detailContent.innerHTML = html`
			<div class="creation-detail-title-row">
				${(creation.nsfw ?? creation.meta?.nsfw) ? html`<span class="creation-detail-nsfw-tag">NSFW</span>` : ''}
				<div class="creation-detail-title${isUntitled ? ' creation-detail-title-untitled' : ''}">${escapeHtml(displayTitle)}
				</div>
			</div>
			<div class="creation-detail-title-byline creation-detail-title-byline-mobile">${escapeHtml(creatorHandle)}
				${escapeHtml(mobileBylineText)}</div>
			<div class="creation-detail-action-strip">
				<div class="creation-detail-action-strip-scroll">
					${creatorProfileHref ? html`
					<a class="creation-detail-action-strip-avatar" href="${creatorProfileHref}"
						aria-label="View ${escapeHtml(creatorName)} profile">${authorAvatar}</a>
					` : html`
					<div class="creation-detail-action-strip-avatar" aria-hidden="true">${authorAvatar}</div>
					`}
					<div class="creation-detail-action-strip-creator-info">
						<div class="creation-detail-action-strip-creator-name">${escapeHtml(creatorName)}</div>
						<div class="creation-detail-action-strip-creator-followers">${creatorFollowerCount} Followers</div>
					</div>
					${!isAdmin && canShowFollowButton && !viewerFollowsCreator ? html`
					<button type="button" class="creation-detail-action-strip-follow" data-follow-button
						data-follow-user-id="${escapeHtml(creatorId)}">Follow</button>
					` : ''}
					${hasEngagementActions && !shareMountedPrivate ? html`
					<button type="button" class="creation-detail-action-strip-pill" aria-label="Like" data-like-button>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
							stroke-linejoin="round" aria-hidden="true">
							<path
								d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z">
							</path>
						</svg>
						<span class="creation-detail-action-strip-pill-count" data-like-count>${likeCount}</span>
					</button>
					` : ''}
					${renderCreationDetailMobilePills(actionsContext)}
					${!isOwner && !isAdmin ? html`
					<button type="button" class="creation-detail-action-strip-pill" data-tip-creator-button
						aria-label="Tip Creator">
						<span class="creation-detail-action-strip-pill-icon">${creditIcon('')}</span>
						<span>Tip Creator</span>
					</button>
					` : ''}
					${!isFailed ? html`
					<button type="button" class="creation-detail-more-btn" aria-label="More options" data-creation-more-btn>
						<span class="creation-detail-more-dots" aria-hidden="true"></span>
					</button>
					` : ''}
				</div>
			</div>
			<div class="creation-detail-more-menu" data-creation-more-menu aria-hidden="true" role="menu">
				${!isFailed ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem" data-creation-more-action="copy-link">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
						<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
					</svg>
					<span>Copy link</span>
				</button>
				${actionsContext?.showQueueForLater ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem"
					data-creation-more-action="queue-for-later">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
						<line x1="16" y1="2" x2="16" y2="6"></line>
						<line x1="8" y1="2" x2="8" y2="6"></line>
						<line x1="3" y1="10" x2="21" y2="10"></line>
					</svg>
					<span data-queue-for-later-label>${actionsContext.queueForLaterLabel}</span>
				</button>
				` : ''}
				${isOwner ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem" data-creation-more-action="set-avatar">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
						<circle cx="12" cy="7" r="4"></circle>
					</svg>
					<span>Set as profile picture</span>
				</button>
				` : ''}
				${isOwner && !isAdmin ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem" data-creation-more-action="landscape">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<rect x="2" y="6" width="20" height="12" rx="1.5" /></svg>
					<span>Landscape</span>
				</button>
				` : ''}
				${hasDetailsModalContent ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem" data-creation-more-action="more-info">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 8v8"></path>
						<path d="M12 6h.01"></path>
					</svg>
					<span>More Info</span>
				</button>
				` : ''}
				${actionsContext?.showUnpublish ? html`
				<button type="button" class="creation-detail-more-menu-item" role="menuitem" data-creation-more-action="unpublish">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z"></path>
					</svg>
					<span>Un-publish</span>
				</button>
				` : ''}
				${actionsContext?.showDelete ? html`
				<button type="button" class="creation-detail-more-menu-item creation-detail-more-menu-item-danger" role="menuitem"
					data-creation-more-action="delete">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						<line x1="10" y1="11" x2="10" y2="17"></line>
						<line x1="14" y1="11" x2="14" y2="17"></line>
					</svg>
					<span>${typeof actionsContext?.deleteLabel === 'string' ? actionsContext.deleteLabel.trim() : 'Delete'}</span>
				</button>
				` : ''}
				` : ''}
			</div>
			${renderCreationDetailActions(actionsContext)}
			${userDeletedNotice}
			
			${descriptionHtml}
			<div class="creation-detail-meta-hidden" aria-hidden="true">
				${hasDetailsModalContent ? `
				<button class="feed-card-action" type="button" data-creation-details-link>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 8v8"></path>
						<path d="M12 6h.01"></path>
					</svg>
					<span>More Info</span>
				</button>
				` : ''}
				${copyLinkButtonHtml}
				${setAvatarButtonHtml}
				<button class="feed-card-action" type="button" data-landscape-btn aria-label="Landscape" style="display: none;">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
						stroke-linejoin="round" aria-hidden="true">
						<rect x="2" y="6" width="20" height="12" rx="1.5" /></svg>
					<span data-landscape-btn-text>Landscape</span>
				</button>
			</div>
			
			${isPublished && !isFailed ? html`
			<div class="comment-input" data-comment-input>
				<div class="comment-avatar" ${!viewerPlan ? `style="background: ${viewerColor};" ` : '' }>
					${viewerPlan ? html`
					<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
						<div class="founder-flair-avatar-ring">
							<div class="founder-flair-avatar-inner"
								style="background: ${viewerAvatarUrl ? 'var(--surface-strong)' : viewerColor};" aria-hidden="true">
								${viewerAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">` :
								viewerInitial}
							</div>
						</div>
					</div>
					` : (viewerAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(viewerAvatarUrl)}" alt="">` :
					viewerInitial)}
				</div>
				<div class="comment-input-body">
					<textarea class="comment-textarea" rows="1" placeholder="What do you like about this creation?"
						data-comment-textarea></textarea>
					<div class="comment-submit-row" data-comment-submit-row style="display: none;">
						<button class="btn-primary comment-submit-btn" type="button" data-comment-submit>Post</button>
					</div>
				</div>
			</div>
			
			<div class="comments-toolbar">
				<h3 class="comments-heading"><span data-comment-count>0 Comments</span></h3>
				<div class="comments-sort">
					<label class="comments-sort-label" for="comments-sort">Sort by</label>
			
					<select class="comments-sort-select" id="comments-sort" data-comments-sort>
						<option value="asc">Oldest</option>
						<option value="desc">Most recent</option>
					</select>
				</div>
			</div>
			<div id="comments" data-comments-anchor></div>
			<div class="comment-list" data-comment-list>
				${renderEmptyLoading({})}
			</div>
			
			<section class="creation-detail-related" data-related-container aria-label="More like this" style="display: none;">
				<div class="creation-detail-related-inner">
					<h2 class="creation-detail-related-heading">More like this</h2>
					<div class="route-cards content-cards-image-grid creation-detail-related-grid" data-related-grid role="list">
					</div>
					<div class="creation-detail-related-sentinel" data-related-sentinel aria-hidden="true"></div>
				</div>
			</section>
			` : ''}
		`;
		actionsEl = detailContent.querySelector('.creation-detail-actions');

		// Landscape (hidden trigger): only for owner, not admin, when published and completed.
		const landscapeBtn = detailContent.querySelector('[data-landscape-btn]');
		if (landscapeBtn) {
			const lurl = meta?.landscapeUrl;
			const hasLandscapeUrl = typeof lurl === 'string' && lurl !== 'loading' && !lurl.startsWith('error:') && (lurl.startsWith('http') || lurl.startsWith('/'));
			const showLandscape = isPublished && isOwner && !isAdmin && status === 'completed' && !isFailed;
			if (!showLandscape) {
				landscapeBtn.style.display = 'none';
			} else {
				landscapeBtn.style.display = '';
				landscapeBtn.disabled = false;
				landscapeBtn.dataset.landscapeHasUrl = hasLandscapeUrl ? '1' : '0';
				landscapeBtn.dataset.landscapeIsSelf = isOwner ? '1' : '0';
				const labelEl = landscapeBtn.querySelector('[data-landscape-btn-text]');
				if (labelEl) labelEl.textContent = 'Landscape';
			}
		}

		// After rendering description (and initial scaffold), hydrate any special link labels.
		hydrateUserTextLinks(detailContent);
		setupCollapsibleDescription(detailContent);

		// Hydrate history thumbnails (best-effort). Skip fetching thumbs for NSFW ancestors when user has not enabled NSFW (they are blank spans).
		if (historyIds.length > 0) {
			const historyRoot = detailContent.querySelector('[data-creation-history]');
			if (historyRoot) {
				const thumbMap = new Map();
				const nonCurrentIds = historyChainIds.filter((id) => id !== creationId);
				const idsToFetch = nonCurrentIds.filter((id) => enableNsfw || nsfwById.get(String(id)) !== true);
				const results = await Promise.allSettled(idsToFetch.map((id) => fetchCreationThumbUrl(id)));
				for (let i = 0; i < idsToFetch.length; i++) {
					const id = idsToFetch[i];
					const r = results[i];
					const url = r.status === 'fulfilled' ? r.value : null;
					if (url) thumbMap.set(id, url);
				}

				const links = Array.from(historyRoot.querySelectorAll('a[data-history-id]'));
				for (const a of links) {
					if (!(a instanceof HTMLAnchorElement)) continue;
					const id = Number(a.dataset.historyId);
					if (!Number.isFinite(id) || id <= 0) continue;
					const url = thumbMap.get(id) || null;
					if (!url) continue;

					const img = a.querySelector('img[data-history-img]');
					const fallback = a.querySelector('[data-history-fallback]');
					if (img instanceof HTMLImageElement) {
						img.src = url;
						img.style.display = '';
					}
					if (fallback instanceof HTMLElement) {
						fallback.style.display = 'none';
					}
				}
			}
		}

		// Hydrate children thumbnails (URLs from API). NSFW blanks are spans with no img; for NSFW links add nsfw-revealed when showUnobscured.
		const childrenRoot = detailContent.querySelector('[data-creation-children]');
		if (childrenRoot) {
			const imgs = childrenRoot.querySelectorAll('img[data-child-img][data-bg-url]');
			for (const img of imgs) {
				if (!(img instanceof HTMLImageElement)) continue;
				const bgUrl = (img.getAttribute('data-bg-url') || '').trim();
				if (!bgUrl) continue;
				img.src = bgUrl;
				img.style.display = '';
				const link = img.closest('a');
				if (link && showUnobscured && link.classList.contains('nsfw')) {
					link.classList.add('nsfw-revealed');
				}
				const fallback = link?.querySelector('[data-child-fallback]');
				if (fallback instanceof HTMLElement) fallback.style.display = 'none';
			}
		}

		const likeButtons = detailContent.querySelectorAll('button[data-like-button]');
		if (!shareMountedPrivate) {
			likeButtons.forEach((btn) => initLikeButton(btn, creationWithLikes));
		} else {
			likeButtons.forEach((btn) => { btn.style.display = 'none'; });
		}

		const copyLinkBtn = detailContent.querySelector('button[data-copy-link-button]');
		const copyLinkLabel = detailContent.querySelector('[data-copy-link-label]');
		if (copyLinkBtn instanceof HTMLButtonElement) {
			if (shareMountedPrivate) {
				copyLinkBtn.style.display = 'none';
			}
			copyLinkBtn.addEventListener('click', async () => {
				const url = getPrimaryLinkUrl(creationId);
				const ok = await copyTextToClipboard(url);
				if (!copyLinkLabel) return;

				if (ok) {
					copyLinkLabel.textContent = 'Copied';
				} else {
					copyLinkLabel.textContent = 'Copy failed';
				}

				window.setTimeout(() => {
					// Only reset if the element still exists
					if (copyLinkLabel && copyLinkLabel.isConnected) {
						copyLinkLabel.textContent = 'Copy link';
					}
				}, 1500);
			});
		}

		const setAvatarBtn = detailContent.querySelector('button[data-set-avatar-button]');
		const setAvatarLabel = detailContent.querySelector('[data-set-avatar-label]');
		if (setAvatarBtn instanceof HTMLButtonElement && setAvatarLabel) {
			let setAvatarBusy = false;
			setAvatarBtn.addEventListener('click', async () => {
				if (setAvatarBusy) return;
				setAvatarBusy = true;
				setAvatarBtn.disabled = true;
				const originalText = setAvatarLabel.textContent;
				try {
					const result = await fetchJsonWithStatusDeduped('/api/profile/avatar-from-creation', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ creation_id: creationId })
					}, { windowMs: 0 });
					if (result.ok) {
						window.location.reload();
						return;
					} else {
						setAvatarLabel.textContent = result.data?.error || 'Failed';
						window.setTimeout(() => {
							if (setAvatarLabel?.isConnected) setAvatarLabel.textContent = originalText;
						}, 3000);
					}
				} catch {
					setAvatarLabel.textContent = 'Failed';
					window.setTimeout(() => {
						if (setAvatarLabel?.isConnected) setAvatarLabel.textContent = originalText;
					}, 3000);
				} finally {
					setAvatarBusy = false;
					setAvatarBtn.disabled = false;
				}
			});
		}

		const tipCreatorBtn = detailContent.querySelector('button[data-tip-creator-button]');
		if (tipCreatorBtn instanceof HTMLButtonElement) {
			// Hide tip button for private shares, when viewer is the creator, or when credits are below threshold.
			const currentUserCredits = typeof currentUser?.credits === 'number' ? currentUser.credits : null;
			if (
				shareMountedPrivate ||
				currentUserId === creatorId ||
				(currentUserCredits !== null && currentUserCredits < TIP_MIN_VISIBLE_BALANCE)
			) {
				tipCreatorBtn.style.display = 'none';
			}
			tipCreatorBtn.addEventListener('click', () => {
				document.dispatchEvent(new CustomEvent('open-tip-creator-modal', {
					detail: {
						userId: creatorId,
						userName: creatorHandle || creatorName,
						createdImageId: creationId,
						viewerBalance: typeof currentUser?.credits === 'number' ? currentUser.credits : null
					}
				}));
			});
		}

		const detailsBtn = detailContent.querySelector('[data-creation-details-link]');
		const openDetailsModal = () => {
			document.dispatchEvent(new CustomEvent('open-creation-details-modal', {
				detail: {
					creationId,
					meta,
					description: descriptionText
				}
			}));
		};
		if (detailsBtn && meta && hasDetailsModalContent) {
			detailsBtn.addEventListener('click', openDetailsModal);
		}
		detailContent.querySelectorAll('[data-more-info-btn]').forEach((btn) => {
			if (btn instanceof HTMLButtonElement && meta) {
				btn.addEventListener('click', openDetailsModal);
			}
		});

		const followButtons = detailContent.querySelectorAll('[data-follow-button]');
		followButtons.forEach((followButton) => {
			if (!(followButton instanceof HTMLButtonElement)) return;
			let busy = false;

			followButton.addEventListener('click', async () => {
				if (busy) return;

				const targetIdRaw = followButton.getAttribute('data-follow-user-id') || '';
				const targetId = Number.parseInt(targetIdRaw, 10);
				if (!Number.isFinite(targetId) || targetId <= 0) return;

				busy = true;
				followButtons.forEach((btn) => { btn.disabled = true; });

				const result = await fetchJsonWithStatusDeduped(
					`/api/users/${targetId}/follow`,
					{
						method: 'POST',
						credentials: 'include'
					},
					{ windowMs: 0 }
				).catch(() => ({ ok: false, status: 0, data: null }));

				if (!result.ok) {
					busy = false;
					followButtons.forEach((btn) => { btn.disabled = false; });
					return;
				}

				// Once the viewer follows the creator, hide all follow buttons.
				followButtons.forEach((btn) => { btn.style.display = 'none'; });
			});
		});

		// Mobile more button popup: open/close and trigger same actions as meta row
		const moreBtn = detailContent.querySelector('[data-creation-more-btn]');
		const moreMenu = detailContent.querySelector('[data-creation-more-menu]');
		if (moreBtn instanceof HTMLButtonElement && moreMenu instanceof HTMLElement) {
			const closeMobileMoreMenu = () => {
				moreMenu.setAttribute('aria-hidden', 'true');
				moreMenu.style.display = 'none';
				document.body.style.overflow = '';
				document.removeEventListener('click', onDocumentClick);
			};
			const onDocumentClick = (e) => {
				if (!moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
					closeMobileMoreMenu();
				}
			};
			moreBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const isOpen = moreMenu.getAttribute('aria-hidden') !== 'true';
				if (isOpen) {
					closeMobileMoreMenu();
					return;
				}
				const rect = moreBtn.getBoundingClientRect();
				const gap = 8;
				moreMenu.style.position = 'fixed';
				moreMenu.style.display = 'block';
				moreMenu.style.bottom = '';
				const menuW = moreMenu.offsetWidth || 200;
				const menuH = moreMenu.offsetHeight || 200;
				const spaceBelow = window.innerHeight - rect.bottom - gap;
				const openAbove = spaceBelow < menuH && rect.top >= menuH + gap;
				if (openAbove) {
					moreMenu.style.top = `${Math.max(gap, rect.top - menuH - 4)}px`;
				} else {
					moreMenu.style.top = `${Math.min(window.innerHeight - menuH - gap, rect.bottom + 4)}px`;
				}
				moreMenu.style.left = `${Math.max(gap, Math.min(rect.right - menuW, window.innerWidth - menuW - gap))}px`;
				moreMenu.setAttribute('aria-hidden', 'false');
				document.body.style.overflow = 'hidden';
				setTimeout(() => document.addEventListener('click', onDocumentClick), 0);
			});
			moreMenu.addEventListener('click', (e) => {
				const item = e.target?.closest?.('[data-creation-more-action]');
				if (!item) return;
				e.preventDefault();
				e.stopPropagation();
				const action = item.getAttribute('data-creation-more-action');
				const targets = {
					'more-info': () => detailContent.querySelector('[data-creation-details-link]')?.click(),
					'copy-link': () => detailContent.querySelector('[data-copy-link-button]')?.click(),
					'set-avatar': () => detailContent.querySelector('button[data-set-avatar-button]')?.click(),
					'landscape': () => { const b = detailContent.querySelector('[data-landscape-btn]'); if (b && !b.disabled) b.click(); },
					'unpublish': () => { const b = detailContent.querySelector('[data-unpublish-btn]'); if (b && !b.disabled) b.click(); },
					'delete': () => { const b = detailContent.querySelector('[data-delete-btn]'); if (b && !b.disabled) b.click(); },
					'queue-for-later': () => {
						if (!showQueueForLater || !normalizedImageUrlForQueue) return;
						const sourceId = Number(creationId);
						const labelEl = item.querySelector('[data-queue-for-later-label]');
						const currentlyQueued = loadMutateQueue().some((q) => {
							const sid = Number(q?.sourceId);
							const url = typeof q?.imageUrl === 'string' ? q.imageUrl : '';
							return (Number.isFinite(sid) && sid === sourceId) || url === normalizedImageUrlForQueue || normalizeImageUrlForQueue(url) === normalizedImageUrlForQueue;
						});
						if (currentlyQueued) {
							try {
								removeFromMutateQueueByImageUrl(normalizedImageUrlForQueue);
								if (labelEl) labelEl.textContent = 'Queue for later';
							} catch {
								// ignore storage errors
							}
						} else {
							try {
								addToMutateQueue({ sourceId, imageUrl: normalizedImageUrlForQueue, published: isPublished });
								if (labelEl) labelEl.textContent = 'Remove from queue';
							} catch {
								// ignore storage errors
							}
						}
					}
				};
				if (typeof targets[action] === 'function') targets[action]();
				closeMobileMoreMenu();
			});
		}

		if (!shareMountedPrivate) {
			enableLikeButtons(detailContent);
		}

		function scrollToComments() {
			const el = detailContent.querySelector('#comments');
			if (!el) return;
			el.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}

		let commentsDidInitialHashScroll = false;

		const commentsState = {
			order: 'asc',
			activity: [],
			commentCount: 0
		};

		const commentCountEl = detailContent.querySelector('[data-comment-count]');
		const commentListEl = detailContent.querySelector('[data-comment-list]');
		const commentsSortEl = detailContent.querySelector('[data-comments-sort]');
		const commentsToolbarEl = detailContent.querySelector('.comments-toolbar');
		const commentTextarea = detailContent.querySelector('[data-comment-textarea]');
		const commentSubmitRow = detailContent.querySelector('[data-comment-submit-row]');
		const commentSubmitBtn = detailContent.querySelector('[data-comment-submit]');

		function setCommentCount(nextCount) {
			const n = Number(nextCount ?? 0);
			commentsState.commentCount = Number.isFinite(n) ? Math.max(0, n) : 0;
			if (commentCountEl) {
				const c = commentsState.commentCount;
				commentCountEl.textContent = c === 1 ? '1 Comment' : `${c} Comments`;
			}
		}

		function renderComments() {
			if (!commentListEl) return;

			const list = Array.isArray(commentsState.activity) ? commentsState.activity : [];
			if (list.length === 0) {
				if (commentsToolbarEl instanceof HTMLElement) {
					commentsToolbarEl.style.display = 'none';
				}
				commentListEl.innerHTML = renderEmptyState({
					className: 'comments-empty',
					title: 'No comments yet',
					message: 'Be the first to say something.',
				});
				return;
			}

			if (commentsToolbarEl instanceof HTMLElement) {
				commentsToolbarEl.style.display = '';
			}
			commentListEl.innerHTML = list.map((item) => {
				if (item?.type === 'tip') {
					const t = item;
					const userName = typeof t?.user_name === 'string' ? t.user_name.trim() : '';
					const displayName = typeof t?.display_name === 'string' ? t.display_name.trim() : '';
					const fallbackName = userName ? userName : 'User';
					const name = displayName || fallbackName;
					const handle = userName ? `@${userName}` : '';
					const avatarUrl = typeof t?.avatar_url === 'string' ? t.avatar_url.trim() : '';
					const tipperId = Number(t?.user_id ?? 0);
					const profileHref = buildProfilePath({ userName, userId: tipperId });
					const seed = userName || String(t?.user_id ?? '') || name;
					const color = getAvatarColor(seed);
					const initial = name.charAt(0).toUpperCase() || '?';
					const date = t?.created_at ? new Date(t.created_at) : null;
					const timeAgo = date ? (formatRelativeTime(date) || '') : '';
					const timeTitle = date ? formatDateTime(date) : '';
					const amount = Number(t?.amount ?? 0);
					const safeMessage = t?.message ? processUserText(String(t.message)) : '';
					const amountLabel = `${amount.toFixed(1)} credits`;
					const isFounder = t?.plan === 'founder';
					const tipAvatarHtml = renderCommentAvatarHtml({
						avatarUrl,
						displayName: name,
						color,
						href: profileHref,
						isFounder,
						flairSize: 'sm',
					});

					return `
						<div class="comment-item comment-item-tip">
							${tipAvatarHtml}
							<div class="comment-body">
								<div class="comment-top">
									${profileHref ? `
										<a class="user-link comment-top-left comment-author-link" href="${profileHref}">
											<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
											${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
										</a>
									` : `
										<div class="comment-top-left">
											<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
											${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
										</div>
									`}
								</div>
								<div class="comment-text comment-tip-text">
									<div class="comment-tip-row">
										<span class="comment-tip-icon">${creditIcon('comment-tip-icon-svg')}</span>
										<span class="comment-tip-label">AMT:</span>
										<span class="comment-tip-value">${escapeHtml(amountLabel)}</span>
									</div>
									${safeMessage ? `
									<div class="comment-tip-row">
										<span class="comment-tip-icon">${creditIcon('comment-tip-icon-svg')}</span>
										<span class="comment-tip-label">MSG:</span>
										<span class="comment-tip-value">${safeMessage}</span>
									</div>
									` : ''}
								</div>
								${timeAgo ? `<div class="comment-time-row"><span class="comment-time" title="${escapeHtml(timeTitle)}">${escapeHtml(timeAgo)}</span></div>` : ''}
							</div>
						</div>
					`;
				}

				const c = item;
				const userName = typeof c?.user_name === 'string' ? c.user_name.trim() : '';
				const displayName = typeof c?.display_name === 'string' ? c.display_name.trim() : '';
				const fallbackName = userName ? userName : 'User';
				const name = displayName || fallbackName;
				const handle = userName ? `@${userName}` : '';
				const avatarUrl = typeof c?.avatar_url === 'string' ? c.avatar_url.trim() : '';
				const commenterId = Number(c?.user_id ?? 0);
				const profileHref = buildProfilePath({ userName, userId: commenterId });
				const seed = userName || String(c?.user_id ?? '') || name;
				const color = getAvatarColor(seed);
				const initial = name.charAt(0).toUpperCase() || '?';
				const date = c?.created_at ? new Date(c.created_at) : null;
				const timeAgo = date ? (formatRelativeTime(date) || '') : '';
				const timeTitle = date ? formatDateTime(date) : '';
				const safeText = processUserText(c?.text ?? '');
				const isFounder = c?.plan === 'founder';
				const commentAvatarHtml = renderCommentAvatarHtml({
					avatarUrl,
					displayName: name,
					color,
					href: profileHref,
					isFounder,
					flairSize: 'sm',
				});

				return `
					<div class="comment-item">
						${commentAvatarHtml}
						<div class="comment-body">
							<div class="comment-top">
								${profileHref ? `
									<a class="user-link comment-top-left comment-author-link" href="${profileHref}">
										<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
									</a>
								` : `
									<div class="comment-top-left">
										<span class="comment-author-name${isFounder ? ' founder-name' : ''}">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</span>` : ''}
									</div>
								`}
							</div>
							<div class="comment-text">${safeText}</div>
							${timeAgo ? `<div class="comment-time-row"><span class="comment-time" title="${escapeHtml(timeTitle)}">${escapeHtml(timeAgo)}</span></div>` : ''}
						</div>
					</div>
				`;
			}).join('');

			// Comments were re-rendered; hydrate any special link labels within them.
			hydrateUserTextLinks(commentListEl);
		}

		async function loadComments({ scrollIfHash = false } = {}) {
			if (!commentListEl) return;
			commentListEl.innerHTML = renderEmptyLoading({});
			if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';

			const res = await fetchCreatedImageActivity(creationId, { order: commentsState.order, limit: 50, offset: 0 })
				.catch(() => ({ ok: false, status: 0, data: null }));

			if (!res.ok) {
				if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';
				commentListEl.innerHTML = renderEmptyState({ className: 'comments-empty', title: 'Unable to load comments' });
				return;
			}

			const items = Array.isArray(res.data?.items) ? res.data.items : [];
			const commentCount = Number(res.data?.comment_count ?? items.length);
			commentsState.activity = items;
			setCommentCount(commentCount);
			renderComments();

			if (scrollIfHash && window.location.hash === '#comments' && !commentsDidInitialHashScroll) {
				commentsDidInitialHashScroll = true;
				scrollToComments();
			}
		}

		if (commentsSortEl instanceof HTMLSelectElement) {
			commentsSortEl.value = commentsState.order;
			commentsSortEl.addEventListener('change', () => {
				commentsState.order = commentsSortEl.value === 'desc' ? 'desc' : 'asc';
				void loadComments({ scrollIfHash: false });
			});
		}

		function setSubmitVisibility() {
			if (!(commentTextarea instanceof HTMLTextAreaElement)) return;
			if (!(commentSubmitRow instanceof HTMLElement)) return;
			const hasText = commentTextarea.value.trim().length > 0;
			commentSubmitRow.style.display = hasText ? '' : 'none';
		}
		const refreshCommentTextarea = commentTextarea instanceof HTMLTextAreaElement
			? attachAutoGrowTextarea(commentTextarea)
			: () => { };

		if (commentTextarea instanceof HTMLTextAreaElement) {
			commentTextarea.addEventListener('input', () => {
				refreshCommentTextarea();
				setSubmitVisibility();
			});
		}

		if (commentSubmitBtn instanceof HTMLButtonElement && commentTextarea instanceof HTMLTextAreaElement) {
			commentSubmitBtn.addEventListener('click', async () => {
				const text = commentTextarea.value.trim();
				if (!text) return;
				commentSubmitBtn.disabled = true;
				try {
					const res = await postCreatedImageComment(creationId, text)
						.catch(() => ({ ok: false, status: 0, data: null }));
					if (!res.ok) {
						const message = typeof res.data?.error === 'string' ? res.data.error : 'Failed to post comment';
						throw new Error(message);
					}

					commentTextarea.value = '';
					refreshCommentTextarea();
					setSubmitVisibility();

					// Reload list to ensure correct ordering + count.
					await loadComments({ scrollIfHash: false });
				} catch (err) {
					alert(err?.message || 'Failed to post comment');
				} finally {
					commentSubmitBtn.disabled = false;
				}
			});
		}

		window.addEventListener('hashchange', () => {
			if (window.location.hash === '#comments') {
				scrollToComments();
			}
		});

		// Initial load + deep-link scroll support.
		refreshCommentTextarea();
		setSubmitVisibility();
		void loadComments({ scrollIfHash: true });

		// Related section and transition recording: only when creation is published and not failed.
		if (isPublished && !isFailed) {
			recordTransitionFromQuery(creationId);
			const query = new URLSearchParams(window.location.search);
			const debugRelated = query.get('debug_related') === '1';
			const showRecsysDebug = isAdmin && debugRelated;
			initRelatedSection(detailContent.parentElement, creationId, { showRecsysDebug });
		}

		// Now that the creation detail view is fully resolved, show actions.
		if (actionsEl && actionsEl.style.display !== 'none') {
			// Clear inline hidden styles (set in HTML / loading state) so CSS can reveal.
			actionsEl.style.opacity = '';
			actionsEl.style.visibility = '';
			actionsEl.style.pointerEvents = '';
			actionsEl.classList.add('is-ready');
		}

	} catch (error) {
		console.error("Error loading creation detail:", error);
		detailContent.innerHTML = renderCreationDetailActions() + renderEmptyState({
			title: 'Unable to load creation',
			message: 'An error occurred while loading the creation.',
		});
		actionsEl = detailContent.querySelector('.creation-detail-actions');
		if (actionsEl) actionsEl.style.display = 'none';
	}
}

let currentCreationId = null;
let lastCreationMeta = null;

function checkAndLoadCreation() {
	const creationId = getCreationId();
	// console.log('checkAndLoadCreation called, creationId:', creationId, 'currentCreationId:', currentCreationId);
	// Only reload if the creation ID has changed
	if (creationId && creationId !== currentCreationId) {
		setActionsLoadingState();
		// console.log('Creation ID changed, loading new creation');
		currentCreationId = creationId;
		loadCreation();
		// Reset scroll to top
		window.scrollTo(0, 0);
	} else if (!creationId && currentCreationId !== null) {
		// If we're no longer on a creation detail page, reset
		// console.log('No longer on creation detail page');
		currentCreationId = null;
	}
}

// Set up modal event listeners
document.addEventListener('DOMContentLoaded', () => {
	checkAndLoadCreation();
});

// Open modal when publish button is clicked
document.addEventListener('click', (e) => {
	const publishBtn = e.target.closest('[data-publish-btn]');
	if (publishBtn && !publishBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		document.dispatchEvent(new CustomEvent('open-publish-modal', {
			detail: { creationId }
		}));
	}
});

// Delete button handler
document.addEventListener('click', (e) => {
	const deleteBtn = e.target.closest('[data-delete-btn]');
	if (deleteBtn && !deleteBtn.disabled) {
		e.preventDefault();
		handleDelete();
	}
});

// Edit button handler
document.addEventListener('click', (e) => {
	const editBtn = e.target.closest('[data-edit-btn]');
	if (editBtn && !editBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		document.dispatchEvent(new CustomEvent('open-edit-modal', {
			detail: { creationId }
		}));
	}
});

// Un-publish button handler
document.addEventListener('click', (e) => {
	const unpublishBtn = e.target.closest('[data-unpublish-btn]');
	if (unpublishBtn && !unpublishBtn.disabled) {
		e.preventDefault();
		handleUnpublish();
	}
});

// Retry button handler
document.addEventListener('click', (e) => {
	const retryBtn = e.target.closest('[data-retry-btn]');
	if (retryBtn && !retryBtn.disabled) {
		e.preventDefault();
		handleRetry();
	}
});

// Mutate button handler
document.addEventListener('click', (e) => {
	const mutateBtn = e.target.closest('[data-mutate-btn]');
	if (mutateBtn && !mutateBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		if (!creationId) return;
		window.location.href = `/creations/${creationId}/mutate`;
	}
});

// Share button handler
document.addEventListener('click', (e) => {
	const shareBtn = e.target.closest('[data-share-btn]');
	if (shareBtn && !shareBtn.disabled) {
		e.preventDefault();
		const creationId = getCreationId();
		if (!creationId) return;
		document.dispatchEvent(new CustomEvent('open-share-modal', {
			detail: { creationId }
		}));
	}
});

// Landscape: single modal — opens with placeholder or image; cost query only when user clicks Generate/Re-generate
const landscapeModal = document.querySelector('[data-landscape-modal]');
const landscapeGeneratePrompt = document.querySelector('[data-landscape-generate-prompt]');
const landscapePlaceholder = document.querySelector('[data-landscape-placeholder]');
const landscapePlaceholderSpinner = document.querySelector('[data-landscape-placeholder-spinner]');
const landscapeImage = document.querySelector('[data-landscape-image]');
const landscapeErrorEl = document.querySelector('[data-landscape-error]');
const landscapeCostDialog = document.querySelector('[data-landscape-cost-dialog]');
const landscapeCostDialogMessage = document.querySelector('[data-landscape-cost-dialog-message]');
const landscapeCostCancel = document.querySelector('[data-landscape-cost-cancel]');
const landscapeCostContinue = document.querySelector('[data-landscape-cost-continue]');
const landscapePrimaryBtn = document.querySelector('[data-landscape-primary-btn]');
const landscapePrimaryBtnText = document.querySelector('[data-landscape-btn-text]');
const landscapePrimaryBtnSpinner = document.querySelector('[data-landscape-btn-spinner]');
const landscapeRemoveBtn = document.querySelector('[data-landscape-remove-btn]');
const landscapeCloseBtn = document.querySelector('[data-landscape-close-btn]');
const landscapeCopyDebugBtn = document.querySelector('[data-landscape-copy-debug]');
const debugCopiedModal = document.querySelector('[data-debug-copied-modal]');
const debugCopiedMessage = document.querySelector('[data-debug-copied-message]');
const debugCopiedSummary = document.querySelector('[data-debug-copied-summary]');
const debugCopiedStatus = document.querySelector('[data-debug-copied-status]');
const debugCopiedCancel = document.querySelector('[data-debug-copied-cancel]');
const debugCopiedSend = document.querySelector('[data-debug-copied-send]');

let landscapeModalCreationId = null;
let landscapeModalIsOwner = false;
let landscapePendingCost = null;
/** Last modal open state, for "Copy debug info" (remote troubleshooting without DevTools). */
let lastLandscapeDiagnostic = null;

function setLandscapePrimaryButtonLoading(loading) {
	if (!landscapePrimaryBtn) return;
	landscapePrimaryBtn.classList.toggle('is-loading', !!loading);
	landscapePrimaryBtn.disabled = !!loading;
	if (landscapePrimaryBtnSpinner) landscapePrimaryBtnSpinner.style.display = loading ? 'block' : 'none';
	if (landscapePrimaryBtnText) landscapePrimaryBtnText.style.visibility = loading ? 'hidden' : '';
}

function openLandscapeModal(creationId, { landscapeUrl, isOwner, isLoading, errorMsg } = {}) {
	landscapeModalCreationId = creationId;
	landscapeModalIsOwner = isOwner;
	landscapePendingCost = null;
	setLandscapePrimaryButtonLoading(false);

	const hasImage = typeof landscapeUrl === 'string' && (landscapeUrl.startsWith('http') || landscapeUrl.startsWith('/'));
	const showPlaceholder = !hasImage || isLoading;
	const showSpinner = isLoading;

	lastLandscapeDiagnostic = { creationId, isOwner: !!isOwner, hasImage, isLoading: !!isLoading, errorMsg: errorMsg || null };
	if (typeof console !== 'undefined' && console.debug) {
		console.debug('[Landscape modal]', { ...lastLandscapeDiagnostic, generateButtonShown: lastLandscapeDiagnostic.isOwner });
	}

	if (landscapeGeneratePrompt) {
		landscapeGeneratePrompt.style.display = !hasImage && !showSpinner && !errorMsg ? 'block' : 'none';
	}
	if (landscapePlaceholder) {
		landscapePlaceholder.style.display = showPlaceholder ? 'flex' : 'none';
		landscapePlaceholder.classList.toggle('is-loading', !!showSpinner);
	}
	if (landscapePlaceholderSpinner) {
		landscapePlaceholderSpinner.style.display = showSpinner ? 'block' : 'none';
	}
	if (landscapeImage) {
		landscapeImage.style.display = hasImage && !showSpinner ? 'block' : 'none';
		if (hasImage && landscapeUrl) landscapeImage.src = landscapeUrl;
	}
	if (landscapeErrorEl) {
		landscapeErrorEl.style.display = errorMsg ? 'block' : 'none';
		landscapeErrorEl.textContent = errorMsg || '';
	}

	if (landscapePrimaryBtn) {
		landscapePrimaryBtn.style.display = isOwner ? '' : 'none';
		landscapePrimaryBtn.disabled = !!isLoading;
		if (landscapePrimaryBtnText) landscapePrimaryBtnText.textContent = hasImage ? 'Re-generate' : 'Generate';
	}
	if (landscapeRemoveBtn) {
		landscapeRemoveBtn.style.display = isOwner && hasImage ? '' : 'none';
		landscapeRemoveBtn.disabled = !!isLoading;
	}
	if (landscapeCloseBtn) {
		landscapeCloseBtn.onclick = () => landscapeModal?.close();
	}

	document.body.classList.add('modal-open');
	landscapeModal?.showModal();
}

function buildSupportReportPayload() {
	const d = lastLandscapeDiagnostic || (() => {
		const creationId = getCreationId();
		const meta = lastCreationMeta?.meta || {};
		const lurl = meta.landscapeUrl;
		const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
		const isLoading = lurl === 'loading';
		const errorMsg = typeof lurl === 'string' && lurl.startsWith('error:') ? lurl.slice(6).trim() : null;
		return { creationId: creationId || 0, isOwner: !!landscapeModalIsOwner, hasImage, isLoading, errorMsg };
	})();
	const genBtnExists = !!landscapePrimaryBtn;
	const genBtnDisplay = genBtnExists && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapePrimaryBtn).display
		: (genBtnExists ? (landscapePrimaryBtn.style.display || '') || 'inline-block' : 'n/a');
	const genBtnVisible = genBtnExists && genBtnDisplay !== 'none' && !landscapePrimaryBtn.disabled;
	const genPromptDisplay = landscapeGeneratePrompt && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapeGeneratePrompt).display
		: (landscapeGeneratePrompt ? (landscapeGeneratePrompt.style.display || '') : 'n/a');
	const placeholderDisplay = landscapePlaceholder && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapePlaceholder).display
		: (landscapePlaceholder ? (landscapePlaceholder.style.display || '') : 'n/a');
	const errorDisplay = landscapeErrorEl && typeof getComputedStyle === 'function'
		? getComputedStyle(landscapeErrorEl).display
		: (landscapeErrorEl ? (landscapeErrorEl.style.display || '') : 'n/a');

	const landscape = {
		creationId: d.creationId,
		isOwner: d.isOwner,
		hasImage: d.hasImage,
		loading: d.isLoading,
		errorMsg: d.errorMsg || null,
		genBtnExists,
		genBtnVisible,
		genBtnDisplay,
		genPromptDisplay,
		placeholderDisplay,
		errorElDisplay: errorDisplay
	};

	const domSummary = {};
	if (landscapeModal) {
		try {
			const cs = typeof getComputedStyle === 'function' ? getComputedStyle(landscapeModal) : null;
			domSummary.modalDisplay = cs ? cs.display : (landscapeModal.style?.display || '');
			domSummary.modalOpen = landscapeModal.open;
		} catch (e) {
			domSummary.modalError = String(e?.message || e);
		}
		if (landscapePlaceholder) {
			try {
				domSummary.placeholderDisplay = typeof getComputedStyle === 'function'
					? getComputedStyle(landscapePlaceholder).display : landscapePlaceholder.style?.display;
				domSummary.placeholderVisible = landscapePlaceholder.offsetParent != null;
			} catch (e) {
				domSummary.placeholderError = String(e?.message || e);
			}
		}
		if (landscapePrimaryBtn) {
			try {
				domSummary.primaryBtnDisplay = typeof getComputedStyle === 'function'
					? getComputedStyle(landscapePrimaryBtn).display : landscapePrimaryBtn.style?.display;
				domSummary.primaryBtnVisible = landscapePrimaryBtn.offsetParent != null;
				domSummary.primaryBtnDisabled = landscapePrimaryBtn.disabled;
			} catch (e) {
				domSummary.primaryBtnError = String(e?.message || e);
			}
		}
		// Truncated HTML snippet of modal content for deep debugging (no user content)
		try {
			const content = landscapeModal.querySelector('[data-landscape-content]');
			if (content) {
				const raw = content.innerHTML.replace(/\s+/g, ' ').trim();
				domSummary.modalContentLength = raw.length;
				domSummary.modalContentSnippet = raw.slice(0, 800) + (raw.length > 800 ? '…' : '');
			}
		} catch (e) {
			domSummary.contentError = String(e?.message || e);
		}
	}

	const context = {
		url: typeof window?.location?.href === 'string' ? window.location.href : '',
		viewportWidth: typeof window?.innerWidth === 'number' ? window.innerWidth : null,
		viewportHeight: typeof window?.innerHeight === 'number' ? window.innerHeight : null,
		screenWidth: typeof window?.screen?.width === 'number' ? window.screen.width : null,
		screenHeight: typeof window?.screen?.height === 'number' ? window.screen.height : null,
		devicePixelRatio: typeof window?.devicePixelRatio === 'number' ? window.devicePixelRatio : null
	};

	return {
		creationId: d.creationId,
		landscape,
		domSummary,
		context
	};
}

function openSupportReportModal() {
	if (debugCopiedStatus) debugCopiedStatus.textContent = '';
	if (debugCopiedSend) debugCopiedSend.disabled = false;
	debugCopiedModal?.showModal();
}

async function sendSupportReport() {
	if (!debugCopiedSend) return;
	debugCopiedSend.disabled = true;
	if (debugCopiedStatus) debugCopiedStatus.textContent = 'Sending…';
	const report = buildSupportReportPayload();
	const userSummary = debugCopiedSummary?.value?.trim() ?? '';
	if (userSummary) report.userSummary = userSummary;
	try {
		const res = await fetch('/api/support-report', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ report })
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok && data?.ok) {
			if (debugCopiedStatus) debugCopiedStatus.textContent = 'Report sent.';
			if (debugCopiedSummary) debugCopiedSummary.value = '';
			setTimeout(() => {
				debugCopiedModal?.close();
				if (debugCopiedStatus) debugCopiedStatus.textContent = '';
				if (debugCopiedSend) debugCopiedSend.disabled = false;
			}, 1500);
		} else {
			if (debugCopiedStatus) debugCopiedStatus.textContent = data?.error || 'Failed to send report.';
			debugCopiedSend.disabled = false;
		}
	} catch (err) {
		if (debugCopiedStatus) debugCopiedStatus.textContent = err?.message || 'Failed to send report.';
		debugCopiedSend.disabled = false;
	}
}

async function landscapePollUntilDone(creationId) {
	const pollMs = 2500;
	const maxPolls = 120;
	for (let i = 0; i < maxPolls; i++) {
		await new Promise(r => setTimeout(r, pollMs));
		const res = await fetch(`/api/create/images/${creationId}`, { credentials: 'include' });
		if (!res.ok) continue;
		const creation = await res.json();
		const meta = creation?.meta || {};
		const lurl = meta.landscapeUrl;
		if (typeof lurl === 'string' && lurl.startsWith('error:')) {
			const msg = lurl.slice(6).trim() || 'The image failed to generate.';
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: msg });
			return;
		}
		if (typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'))) {
			lastCreationMeta = creation;
			openLandscapeModal(creationId, { landscapeUrl: lurl, isOwner: landscapeModalIsOwner, isLoading: false });
			loadCreation();
			return;
		}
	}
	openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: 'Taking longer than usual. You can close and check back later.' });
}

function landscapeStartGenerate(creationId, cost) {
	landscapePendingCost = null;
	openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: true });
	fetch('/api/create/landscape', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ creation_id: creationId, credit_cost: cost })
	})
		.then(async (res) => {
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: data?.message || data?.error || 'Failed to start' });
				return;
			}
			landscapePollUntilDone(creationId);
		})
		.catch((err) => {
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: landscapeModalIsOwner, isLoading: false, errorMsg: err?.message || 'Failed to start landscape' });
		});
}

// Prevent background scroll when landscape or cost dialog is open (same as other modals)
if (landscapeModal) {
	landscapeModal.addEventListener('close', () => document.body.classList.remove('modal-open'));
}
if (landscapeCostDialog) {
	landscapeCostDialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
}

if (landscapeCostCancel) {
	landscapeCostCancel.addEventListener('click', () => {
		landscapePendingCost = null;
		landscapeCostDialog?.close();
		const meta = lastCreationMeta?.meta || {};
		const lurl = meta?.landscapeUrl;
		const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
		openLandscapeModal(landscapeModalCreationId, { landscapeUrl: hasImage ? lurl : null, isOwner: landscapeModalIsOwner, isLoading: false });
	});
}

if (landscapeCostContinue) {
	landscapeCostContinue.addEventListener('click', () => {
		if (!landscapePendingCost) return;
		const { creationId, cost } = landscapePendingCost;
		landscapePendingCost = null;
		landscapeCostDialog?.close();
		landscapeStartGenerate(creationId, cost);
	});
}

if (landscapePrimaryBtn) {
	landscapePrimaryBtn.addEventListener('click', async () => {
		const creationId = landscapeModalCreationId;
		if (!creationId || !landscapeModalIsOwner) return;
		landscapePendingCost = null;
		setLandscapePrimaryButtonLoading(true);
		try {
			const queryRes = await fetch('/api/create/landscape/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ creation_id: creationId })
			});
			const queryData = await queryRes.json().catch(() => ({}));
			const meta = lastCreationMeta?.meta || {};
			const lurl = meta?.landscapeUrl;
			const hasImage = typeof lurl === 'string' && (lurl.startsWith('http') || lurl.startsWith('/'));
			if (!queryRes.ok) {
				setLandscapePrimaryButtonLoading(false);
				openLandscapeModal(creationId, { landscapeUrl: hasImage ? lurl : null, isOwner: true, isLoading: false, errorMsg: queryData?.message || queryData?.error || 'Failed to query' });
				return;
			}
			const supported = queryData?.supported === true || queryData?.supported === 'true';
			const cost = typeof queryData.cost === 'number' ? queryData.cost : Number(queryData.cost);
			if (!supported || !Number.isFinite(cost) || cost <= 0) {
				setLandscapePrimaryButtonLoading(false);
				openLandscapeModal(creationId, { landscapeUrl: hasImage ? lurl : null, isOwner: true, isLoading: false, errorMsg: 'This server does not support landscape for this creation.' });
				return;
			}
			landscapePendingCost = { creationId, cost };
			setLandscapePrimaryButtonLoading(false);
			if (landscapeCostDialogMessage) landscapeCostDialogMessage.textContent = `This will cost ${cost} credit${cost === 1 ? '' : 's'}.`;
			document.body.classList.add('modal-open');
			landscapeCostDialog?.showModal();
		} catch (err) {
			setLandscapePrimaryButtonLoading(false);
			openLandscapeModal(creationId, { landscapeUrl: null, isOwner: true, isLoading: false, errorMsg: err?.message || 'Failed to query' });
		}
	});
}

if (landscapeRemoveBtn) {
	landscapeRemoveBtn.addEventListener('click', async () => {
		const creationId = landscapeModalCreationId;
		if (!creationId || !landscapeModalIsOwner) return;
		landscapeRemoveBtn.disabled = true;
		try {
			const res = await fetch(`/api/create/images/${creationId}/landscape`, { method: 'DELETE', credentials: 'include' });
			if (!res.ok) throw new Error('Failed to remove');
			landscapeModal?.close();
			loadCreation();
		} catch (err) {
			alert(err?.message || 'Failed to remove landscape');
		} finally {
			landscapeRemoveBtn.disabled = false;
		}
	});
}

if (landscapeCopyDebugBtn) {
	landscapeCopyDebugBtn.addEventListener('click', openSupportReportModal);
}

if (debugCopiedCancel) {
	debugCopiedCancel.addEventListener('click', () => debugCopiedModal?.close());
}

if (debugCopiedSend) {
	debugCopiedSend.addEventListener('click', () => void sendSupportReport());
}

document.addEventListener('click', (e) => {
	const landscapeBtn = e.target.closest('[data-landscape-btn]');
	if (!landscapeBtn || landscapeBtn.disabled) return;
	e.preventDefault();
	const creationId = getCreationId();
	if (!creationId) return;
	const isOwner = landscapeBtn.dataset.landscapeIsSelf === '1';
	const hasUrl = landscapeBtn.dataset.landscapeHasUrl === '1';
	// Diagnostic: button state when opening modal (helps troubleshoot Brave/Windows "no Generate" reports).
	if (typeof console !== 'undefined' && console.debug) {
		console.debug('[Landscape click]', {
			creationId,
			'data-landscape-is-self': landscapeBtn.dataset.landscapeIsSelf,
			'data-landscape-has-url': landscapeBtn.dataset.landscapeHasUrl,
			derivedIsOwner: isOwner,
			derivedHasUrl: hasUrl
		});
	}
	const meta = lastCreationMeta?.meta || {};
	const landscapeUrl = meta.landscapeUrl;
	const isLoading = landscapeUrl === 'loading';
	const hasImage = typeof landscapeUrl === 'string' && (landscapeUrl.startsWith('http') || landscapeUrl.startsWith('/'));
	const errorMsg = typeof landscapeUrl === 'string' && landscapeUrl.startsWith('error:') ? landscapeUrl.slice(6).trim() : null;

	openLandscapeModal(creationId, {
		landscapeUrl: hasImage ? landscapeUrl : null,
		isOwner,
		isLoading,
		errorMsg: errorMsg || null
	});
});

async function handleDelete() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	const deleteBtn = document.querySelector('[data-delete-btn]');
	const isPermanent = deleteBtn?.dataset?.permanentDelete === '1';

	if (!confirm(isPermanent
		? 'Permanently delete this creation? This cannot be undone.'
		: 'Are you sure you want to delete this creation? This action cannot be undone.')) {
		return;
	}

	if (deleteBtn) {
		deleteBtn.disabled = true;
	}

	const deleteUrl = isPermanent ? `/api/create/images/${creationId}?permanent=1` : `/api/create/images/${creationId}`;
	try {
		const response = await fetch(deleteUrl, {
			method: 'DELETE',
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to delete creation');
		}

		// Success: after permanent delete (admin), go back to that user's profile; otherwise creations list
		if (isPermanent && lastCreationMeta?.user_id) {
			const profilePath = buildProfilePath({
				userName: lastCreationMeta?.creator?.user_name || lastCreationMeta?.user_name || null,
				userId: lastCreationMeta.user_id
			});
			window.location.href = profilePath || `/user/${lastCreationMeta.user_id}`;
		} else {
			window.location.href = '/creations';
		}
	} catch (error) {
		// console.error('Error deleting creation:', error);
		alert(error.message || 'Failed to delete creation. Please try again.');

		if (deleteBtn) {
			deleteBtn.disabled = false;
		}
	}
}

async function handleRetry() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	const meta = lastCreationMeta && lastCreationMeta.meta ? lastCreationMeta.meta : null;
	const serverId = meta && meta.server_id;
	const method = meta && meta.method;
	const args = (meta && meta.args) ? meta.args : {};

	if (!serverId || !method) {
		alert('Cannot retry this creation because server or method information is missing.');
		return;
	}

	const retryBtn = document.querySelector('[data-retry-btn]');
	if (retryBtn) {
		retryBtn.disabled = true;
	}

	const creationToken = `crt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

	try {
		const response = await fetch("/api/create", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			credentials: "include",
			body: JSON.stringify({
				server_id: serverId,
				method,
				args: args || {},
				creation_token: creationToken,
				retry_of_id: Number(creationId)
			})
		});

		if (!response.ok) {
			const error = await response.json();
			if (response.status === 402) {
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: error.current ?? 0 }
				}));
				alert(error.message || "Insufficient credits");
				return;
			}
			throw new Error(error.error || "Failed to retry creation");
		}

		const data = await response.json();
		if (typeof data.credits_remaining === 'number') {
			document.dispatchEvent(new CustomEvent('credits-updated', {
				detail: { count: data.credits_remaining }
			}));
		}

		// Same creation row is now "creating"; navigate and refresh list
		const creationsRoute = document.querySelector("app-route-creations");
		if (creationsRoute && typeof creationsRoute.loadCreations === "function") {
			await creationsRoute.loadCreations({ force: true, background: false });
		}
		const header = document.querySelector('app-navigation');
		if (header && typeof header.navigateToRoute === 'function') {
			header.navigateToRoute('creations');
		} else {
			window.location.href = '/creations';
		}
	} catch (error) {
		alert(error.message || 'Failed to retry creation. Please try again.');
	} finally {
		if (retryBtn) {
			retryBtn.disabled = false;
		}
	}
}


async function handleUnpublish() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	// Confirm unpublishing
	if (!confirm('Are you sure you want to un-publish this creation? It will be removed from the feed and no longer visible to other users. You will also lose all likes and comments.')) {
		return;
	}

	const unpublishBtn = document.querySelector('[data-unpublish-btn]');
	if (unpublishBtn) {
		unpublishBtn.disabled = true;
	}

	try {
		const response = await fetch(`/api/create/images/${creationId}/unpublish`, {
			method: 'POST',
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to unpublish creation');
		}

		// Success - reload the page to show updated state
		window.location.reload();
	} catch (error) {
		// console.error('Error unpublishing creation:', error);
		alert(error.message || 'Failed to unpublish creation. Please try again.');

		if (unpublishBtn) {
			unpublishBtn.disabled = false;
		}
	}
}

// Listen for URL changes (browser back/forward navigation)
// Use capture phase to ensure we get the event before header handles it
window.addEventListener('popstate', (e) => {
	// console.log('popstate event fired', window.location.pathname);
	// Check if we're still on a creation detail page
	const creationId = getCreationId();
	if (creationId) {
		checkAndLoadCreation();
	}
}, true);

// Override pushState and replaceState to detect programmatic navigation
history.pushState = function (...args) {
	// console.log('pushState called', args);
	originalPushState(...args);
	// Check if URL changed to a different creation
	setTimeout(() => {
		const creationId = getCreationId();
		// console.log('After pushState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

history.replaceState = function (...args) {
	// console.log('replaceState called', args);
	originalReplaceState(...args);
	setTimeout(() => {
		const creationId = getCreationId();
		// console.log('After replaceState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

// Listen for the route-change event from the header component
document.addEventListener('route-change', (e) => {
	// console.log('route-change event fired', e.detail?.route);
	const route = e.detail?.route;
	if (route && route.startsWith('creations/')) {
		setActionsLoadingState();
		checkAndLoadCreation();
	}
});

// Also monitor pathname changes directly as a fallback
let lastPathname = window.location.pathname;
const pathnameCheck = setInterval(() => {
	const currentPathname = window.location.pathname;
	if (currentPathname !== lastPathname) {
		lastPathname = currentPathname;
		const creationId = getCreationId();
		if (creationId) {
			checkAndLoadCreation();
		} else {
			// If we're no longer on a creation detail page, clear interval
			clearInterval(pathnameCheck);
		}
	}
}, 100);

