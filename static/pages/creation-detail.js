import { formatDateTime, formatRelativeTime } from '/shared/datetime.js';
import { enableLikeButtons, getCreationLikeCount, initLikeButton } from '/shared/likes.js';
import { fetchJsonWithStatusDeduped } from '/shared/api.js';
import { getAvatarColor } from '/shared/avatar.js';
import { fetchCreatedImageComments, postCreatedImageComment } from '/shared/comments.js';
import { hydrateYoutubeLinkTitles, hydrateXLinkTitles, textWithCreationLinks } from '/shared/urls.js';
import { attachAutoGrowTextarea } from '/shared/autogrow.js';
import '../components/modals/publish.js';
import '../components/modals/creation-details.js';
import '../components/modals/share.js';

const html = String.raw;

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
	const actionsEl = document.querySelector('.creation-detail-actions');

	if (!detailContent || !imageEl || !backgroundEl) return;

	// Hide actions until the page has loaded and ownership is resolved (prevents flash).
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
			imageWrapper?.classList.remove('image-loading');
			imageWrapper?.classList.remove('image-error');
			if (imageEl.dataset.currentUrl) {
				backgroundEl.style.backgroundImage = `url('${imageEl.dataset.currentUrl}')`;
			}
			imageEl.style.visibility = 'visible';
		});

		imageEl.addEventListener('error', () => {
			imageWrapper?.classList.remove('image-loading');
			imageWrapper?.classList.add('image-error');
			backgroundEl.style.backgroundImage = '';
			// Hide default browser broken-image UI
			imageEl.style.visibility = 'hidden';
		});
	}

	const creationId = getCreationId();
	if (!creationId) {
		detailContent.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">Invalid creation ID</div>
			</div>
		`;
		if (actionsEl) actionsEl.style.display = 'none';
		return;
	}

	detailContent.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';

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
				detailContent.innerHTML = html`
					<div class="route-empty">
						<div class="route-empty-title">Creation not found</div>
						<div class="route-empty-message">The creation you're looking for doesn't exist or you don't have access to it.</div>
					</div>
				`;
				if (actionsEl) actionsEl.style.display = 'none';
				return;
			}
			throw new Error('Failed to load creation');
		}

		const creation = await response.json();

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
		backgroundEl.style.backgroundImage = '';
		imageEl.style.visibility = 'hidden';
		imageEl.dataset.currentUrl = '';
		imageEl.src = '';

		if (status === 'completed' && creation.url) {
			imageWrapper?.classList.add('image-loading');
			imageEl.dataset.currentUrl = creation.url;
			imageEl.src = creation.url;
		} else if (status === 'creating' && !isTimedOut) {
			// Still creating: show loading placeholder
			imageWrapper?.classList.add('image-loading');
		} else if (isFailed) {
			// Failed or timed out: show error placeholder
			imageWrapper?.classList.add('image-error');
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

		// Update publish button - hide if not owner/admin, already published, or creation not successfully completed
		const publishBtn = document.querySelector('[data-publish-btn]');
		if (publishBtn) {
			if (!canEdit || isPublished || status !== 'completed' || isFailed) {
				// Hide publish button if user doesn't own/admin, if already published,
				// or if the creation is not a successfully completed image (creating/failed/etc.)
				publishBtn.style.display = 'none';
			} else {
				// Button is active (enabled) when not already published
				publishBtn.style.display = '';
				publishBtn.disabled = false;

				// Create SVG icon
				const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				svgIcon.setAttribute('width', '16');
				svgIcon.setAttribute('height', '16');
				svgIcon.setAttribute('viewBox', '0 0 16 16');
				svgIcon.setAttribute('fill', 'none');
				svgIcon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
				svgIcon.style.marginRight = '6px';
				svgIcon.style.verticalAlign = 'middle';

				const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				path.setAttribute('d', 'M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z');
				path.setAttribute('stroke', 'currentColor');
				path.setAttribute('stroke-width', '1.5');
				path.setAttribute('stroke-linecap', 'round');
				path.setAttribute('stroke-linejoin', 'round');
				path.setAttribute('fill', 'none');
				svgIcon.appendChild(path);

				// Update button content
				publishBtn.innerHTML = '';
				publishBtn.appendChild(svgIcon);
				publishBtn.appendChild(document.createTextNode(' Publish'));
			}
		}

		// Update edit button - show for completed creations if owner/admin and not failed (published or not)
		const editBtn = document.querySelector('[data-edit-btn]');
		if (editBtn) {
			if (!canEdit || status !== 'completed' || isFailed) {
				editBtn.style.display = 'none';
			} else {
				editBtn.style.display = '';
				editBtn.disabled = false;
			}
		}

		// Update unpublish button - show for published creations if owner/admin and not failed
		const unpublishBtn = document.querySelector('[data-unpublish-btn]');
		if (unpublishBtn) {
			if (!canEdit || !isPublished || isFailed) {
				unpublishBtn.style.display = 'none';
			} else {
				unpublishBtn.style.display = '';
				unpublishBtn.disabled = false;
			}
		}

		// Update mutate button - show for completed images with a URL (published or unpublished; backend uses share URL for unpublished)
		const mutateBtn = document.querySelector('[data-mutate-btn]');
		if (mutateBtn) {
			const canMutate = canEdit && status === 'completed' && !isFailed && Boolean(creation.url);
			if (!canMutate) {
				mutateBtn.style.display = 'none';
			} else {
				mutateBtn.style.display = '';
				mutateBtn.disabled = false;
			}
		}

		// Update share button - show for completed images (works for private via tokenized share page)
		const shareBtn = document.querySelector('[data-share-btn]');
		if (shareBtn) {
			const canShare = !shareMountedPrivate && status === 'completed' && !isFailed;
			if (!canShare) {
				shareBtn.style.display = 'none';
			} else {
				shareBtn.style.display = '';
				shareBtn.disabled = false;
			}
		}

		// Update delete / retry buttons
		const deleteBtn = document.querySelector('[data-delete-btn]');
		const retryBtn = document.querySelector('[data-retry-btn]');

		if (deleteBtn) {
			if (!canEdit) {
				// Hide delete button if user doesn't own the creation and isn't admin
				deleteBtn.style.display = 'none';
			} else {
				deleteBtn.style.display = '';
				// Allow delete for failed or creating+timed-out or unpublished completed; disable otherwise.
				const deletable = !isPublished && (status === 'failed' || (status === 'creating' && isTimedOut) || status === 'completed');
				deleteBtn.disabled = !deletable;
			}
		}

		if (retryBtn) {
			if (!canEdit || !isFailed) {
				retryBtn.style.display = 'none';
			} else {
				retryBtn.style.display = '';
				retryBtn.disabled = false;
			}
		}

		// If no actions are visible, hide the whole actions row to avoid empty spacing.
		if (actionsEl) {
			const actionButtons = Array.from(actionsEl.querySelectorAll('button'));
			const anyVisible = actionButtons.some(btn => btn.style.display !== 'none');
			actionsEl.style.display = anyVisible ? '' : 'none';
		}

		// Published display:
		// - Show "Published {time ago}" directly under the user identification line.
		// - Keep description as its own block further down.
		let publishedLabel = '';
		if (isPublished) {
			const publishedDateRaw = creation.published_at || creation.created_at || null;
			const publishedDate = publishedDateRaw ? new Date(publishedDateRaw) : null;
			const hasPublishedDate = publishedDate instanceof Date && Number.isFinite(publishedDate.valueOf());
			const publishedTimeAgo = hasPublishedDate ? formatRelativeTime(publishedDate) : '';
			const publishedAtTitle = hasPublishedDate ? formatDateTime(publishedDate) : '';

			publishedLabel = html`
				<div class="creation-detail-author-published" ${publishedAtTitle ? `title="${publishedAtTitle}"` : ''}>
					Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}
				</div>
			`;
		}

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

		let historyStripHtml = '';
		if (historyIds.length > 0 && historyChainIds.length >= 2) {
			const nonCurrentIds = historyChainIds.filter((id) => id !== creationId);
			const parts = nonCurrentIds.map((id) => `
				<a
					class="creation-detail-history-thumb-link"
					href="/creations/${id}"
					aria-label="${escapeHtml(`Go to creation #${id}`)}"
					data-history-id="${id}"
				>
					<span class="creation-detail-history-fallback" data-history-fallback>#${id}</span>
					<img class="creation-detail-history-thumb" data-history-img alt="" loading="lazy" style="display: none;" />
				</a>
				<span class="creation-detail-history-arrow" aria-hidden="true">→</span>
			`).join('');

			historyStripHtml = html`
				<div class="creation-detail-history-wrap">
					<div class="creation-detail-history-label">LINEAGE</div>
					<div class="creation-detail-history" data-creation-history>
						${parts}${currentIndicatorHtml}
					</div>
				</div>
			`;
		}

		// Show description block if we have either description or history.
		let descriptionHtml = '';
		const descriptionText = typeof creation.description === 'string' ? creation.description.trim() : '';
		if (descriptionText || historyStripHtml) {
			descriptionHtml = html`
				<div class="creation-detail-published${historyStripHtml ? ' has-history' : ''}">
					${descriptionText ? html`
						<div class="creation-detail-description-wrap" data-description-wrap>
							<div class="creation-detail-description" data-description>${textWithCreationLinks(descriptionText)}</div>
							<div class="creation-detail-description-toggle-row">
								<button type="button" class="btn-secondary creation-detail-description-toggle" data-description-toggle hidden>View Full</button>
							</div>
						</div>
					` : ''}
					${historyStripHtml}
				</div>
			`;
		}

		// (Keep `historyStripHtml` empty now; it lives inside `descriptionHtml` above the border line.)
		historyStripHtml = '';

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
		const creatorProfileHref = Number.isFinite(creatorId) && creatorId > 0 ? `/user/${creatorId}` : null;

		const viewerUserName = typeof currentUserProfile?.user_name === 'string' ? currentUserProfile.user_name.trim() : '';
		const viewerDisplayName = typeof currentUserProfile?.display_name === 'string' ? currentUserProfile.display_name.trim() : '';
		const viewerEmailPrefix = currentUser?.email
			? String(currentUser.email).split('@')[0]
			: 'You';
		const viewerName = viewerDisplayName || viewerUserName || viewerEmailPrefix || 'You';
		const viewerInitial = viewerName.charAt(0).toUpperCase();
		const viewerAvatarUrl = typeof currentUserProfile?.avatar_url === 'string' ? currentUserProfile.avatar_url.trim() : '';
		const viewerColor = getAvatarColor(viewerUserName || viewerEmailPrefix || String(currentUserId || '') || viewerName);

		const authorAvatar = html`
			<span class="creation-detail-author-icon" style="background: ${creatorColor};">
				${creatorAvatarUrl ? html`<img class="creation-detail-author-avatar" src="${creatorAvatarUrl}" alt="">` : creatorInitial}
			</span>
		`;

		const authorIdentification = html`
			<span class="creation-detail-author-name">${creatorName}</span>
			<span class="creation-detail-author-handle">${creatorHandle}</span>
		`;

		const hasDetails = !!(meta && (meta.server_id !== undefined || meta.method || meta.args));
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

		detailContent.innerHTML = html`
			<div class="creation-detail-author">
				${creatorProfileHref ? html`
					<a class="user-link creation-detail-author-avatar-slot" href="${creatorProfileHref}" aria-label="View ${creatorName} profile">
						${authorAvatar}
					</a>
				` : html`
					<div class="creation-detail-author-avatar-slot" aria-hidden="true">
						${authorAvatar}
					</div>
				`}

				<div class="creation-detail-author-id">
					${creatorProfileHref ? html`
						<a class="user-link creation-detail-author-id-link" href="${creatorProfileHref}">
							${authorIdentification}
						</a>
					` : authorIdentification}
				</div>

				${publishedLabel}
			</div>
			<div class="creation-detail-title${isUntitled ? ' creation-detail-title-untitled' : ''}">${escapeHtml(displayTitle)}</div>
			${descriptionHtml}
			<div class="creation-detail-meta">
				<div class="creation-detail-meta-left">
					${hasDetails ? `
					<button class="feed-card-action" type="button" data-creation-details-link>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<circle cx="12" cy="12" r="10"></circle>
							<path d="M12 8v8"></path>
							<path d="M12 6h.01"></path>
						</svg>
						<span>More Info</span>
					</button>
					` : ``}
					${copyLinkButtonHtml}
				</div>
				<div class="creation-detail-meta-spacer" aria-hidden="true"></div>
				<div class="creation-detail-meta-right">
					${hasEngagementActions ? `
					<a class="feed-card-action creation-detail-comments-link" href="#comments" data-comments-link aria-label="Comments">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M21 15a4 4 0 0 1-4 4H8l-5 5V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
						</svg>
						<span class="feed-card-action-count" data-comment-count>0</span>
					</a>
					<button class="feed-card-action" type="button" aria-label="Like" data-like-button>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
						</svg>
						<span class="feed-card-action-count" data-like-count>${likeCount}</span>
					</button>
					` : ``}
					${'' /*
					Creation detail kebab menu (disabled for now)
					<div class="creation-detail-more">
						<button class="feed-card-action feed-card-action-more" type="button" aria-label="More" data-creation-more-button>
							<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<circle cx="12" cy="5" r="1.6"></circle>
								<circle cx="12" cy="12" r="1.6"></circle>
								<circle cx="12" cy="19" r="1.6"></circle>
							</svg>
						</button>
						<div class="feed-card-menu" data-creation-menu style="display: none;">
							${hasDetails ? `<button class="feed-card-menu-item" type="button" data-creation-menu-info>More Info</button>` : ``}
							<button class="feed-card-menu-item" type="button" data-creation-menu-copy>Copy link</button>
						</div>
					</div>
					*/ }
				</div>
			</div>

			${isPublished && !isFailed ? `
			<div class="comment-input" data-comment-input>
				<div class="comment-avatar" style="background: ${viewerColor};">
					${viewerAvatarUrl ? `<img class="comment-avatar-img" src="${viewerAvatarUrl}" alt="">` : viewerInitial}
				</div>
				<div class="comment-input-body">
					<textarea class="comment-textarea" rows="1" placeholder="What do you like about this creation?" data-comment-textarea></textarea>
					<div class="comment-submit-row" data-comment-submit-row style="display: none;">
						<button class="btn-primary comment-submit-btn" type="button" data-comment-submit>Post</button>
					</div>
				</div>
			</div>

			<div class="comments-toolbar">
				<div class="comments-sort">
					<label class="comments-sort-label" for="comments-sort">Sort:</label>

					<select class="comments-sort-select" id="comments-sort" data-comments-sort>
						<option value="asc">Oldest</option>
						<option value="desc">Most recent</option>
					</select>
				</div>
			</div>
			<div id="comments" data-comments-anchor></div>
			<div class="comment-list" data-comment-list>
				<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
			</div>
			` : ''}
		`;

		// After rendering description (and initial scaffold), hydrate any YouTube link labels.
		hydrateYoutubeLinkTitles(detailContent);
		hydrateXLinkTitles(detailContent);
		setupCollapsibleDescription(detailContent);

		// Hydrate history thumbnails (best-effort).
		if (historyIds.length > 0) {
			const historyRoot = detailContent.querySelector('[data-creation-history]');
			if (historyRoot) {
				const thumbMap = new Map();

				const idsToFetch = historyChainIds.filter((id) => id !== creationId);
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

		const likeButton = detailContent.querySelector('button[data-like-button]');
		if (likeButton && !shareMountedPrivate) {
			initLikeButton(likeButton, creationWithLikes);
		} else if (likeButton && shareMountedPrivate) {
			likeButton.style.display = 'none';
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

		const detailsBtn = detailContent.querySelector('[data-creation-details-link]');
		if (detailsBtn && meta && (meta.server_id !== undefined || meta.method || meta.args)) {
			detailsBtn.addEventListener('click', () => {
				document.dispatchEvent(new CustomEvent('open-creation-details-modal', {
					detail: {
						creationId,
						meta
					}
				}));
			});
		}

		/*
		Creation detail kebab menu handlers (disabled for now)
		const moreBtn = detailContent.querySelector('[data-creation-more-button]');
		const menu = detailContent.querySelector('[data-creation-menu]');
		const menuInfoBtn = detailContent.querySelector('[data-creation-menu-info]');
		const copyLinkMenuBtn = detailContent.querySelector('[data-creation-menu-copy]');
		const moreWrap = detailContent.querySelector('.creation-detail-more');

		if (moreBtn instanceof HTMLButtonElement && menu instanceof HTMLElement && moreWrap instanceof HTMLElement) {
			const closeMenu = (e) => {
				if (!menu.contains(e.target) && !moreBtn.contains(e.target)) {
					menu.style.display = 'none';
					document.removeEventListener('click', closeMenu);
				}
			};

			moreBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();

				const isVisible = menu.style.display !== 'none';
				menu.style.display = isVisible ? 'none' : 'block';

				if (!isVisible) {
					const buttonRect = moreBtn.getBoundingClientRect();
					const wrapRect = moreWrap.getBoundingClientRect();
					menu.style.position = 'absolute';
					menu.style.right = `${wrapRect.right - buttonRect.right}px`;
					menu.style.bottom = `${wrapRect.bottom - buttonRect.top + 4}px`;
					menu.style.zIndex = '1000';

					setTimeout(() => {
						document.addEventListener('click', closeMenu);
					}, 0);
				} else {
					document.removeEventListener('click', closeMenu);
				}
			});

			if (menuInfoBtn instanceof HTMLButtonElement && detailsBtn) {
				menuInfoBtn.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					menu.style.display = 'none';
					document.removeEventListener('click', closeMenu);
					detailsBtn.click();
				});
			}

			if (copyLinkMenuBtn instanceof HTMLButtonElement) {
				copyLinkMenuBtn.addEventListener('click', async (e) => {
					e.preventDefault();
					e.stopPropagation();
					menu.style.display = 'none';
					document.removeEventListener('click', closeMenu);
					const url = getPrimaryLinkUrl(creationId);
					await copyTextToClipboard(url);
				});
			}
		}
		*/

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
			comments: [],
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
			if (commentCountEl) commentCountEl.textContent = String(commentsState.commentCount);
		}

		function renderComments() {
			if (!commentListEl) return;

			const list = Array.isArray(commentsState.comments) ? commentsState.comments : [];
			if (list.length === 0) {
				if (commentsToolbarEl instanceof HTMLElement) {
					commentsToolbarEl.style.display = 'none';
				}
				commentListEl.innerHTML = html`
					<div class="route-empty comments-empty">
						<div class="route-empty-title">No comments yet</div>
						<div class="route-empty-message">Be the first to say something.</div>
					</div>
				`;
				return;
			}

			if (commentsToolbarEl instanceof HTMLElement) {
				commentsToolbarEl.style.display = '';
			}
			commentListEl.innerHTML = list.map((c) => {
				const userName = typeof c?.user_name === 'string' ? c.user_name.trim() : '';
				const displayName = typeof c?.display_name === 'string' ? c.display_name.trim() : '';
				const fallbackName = userName ? userName : 'User';
				const name = displayName || fallbackName;
				const handle = userName ? `@${userName}` : '';
				const avatarUrl = typeof c?.avatar_url === 'string' ? c.avatar_url.trim() : '';
				const commenterId = Number(c?.user_id ?? 0);
				const profileHref = Number.isFinite(commenterId) && commenterId > 0 ? `/user/${commenterId}` : null;
				const seed = userName || String(c?.user_id ?? '') || name;
				const color = getAvatarColor(seed);
				const initial = name.charAt(0).toUpperCase() || '?';
				const date = c?.created_at ? new Date(c.created_at) : null;
				const timeAgo = date ? (formatRelativeTime(date) || '') : '';
				const timeTitle = date ? formatDateTime(date) : '';
				const safeText = textWithCreationLinks(c?.text ?? '');

				return `
					<div class="comment-item">
						${profileHref ? `
							<a class="user-link user-avatar-link comment-avatar" href="${profileHref}" aria-label="View ${escapeHtml(name)} profile" style="background: ${color};">
								${avatarUrl ? `<img class="comment-avatar-img" src="${avatarUrl}" alt="">` : initial}
							</a>
						` : `
							<div class="comment-avatar" style="background: ${color};">
								${avatarUrl ? `<img class="comment-avatar-img" src="${avatarUrl}" alt="">` : initial}
							</div>
						`}
						<div class="comment-body">
							<div class="comment-top">
								${profileHref ? `
									<a class="user-link comment-top-left comment-author-link" href="${profileHref}">
										<span class="comment-author-name">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle">${escapeHtml(handle)}</span>` : ''}
									</a>
								` : `
									<div class="comment-top-left">
										<span class="comment-author-name">${escapeHtml(name)}</span>
										${handle ? `<span class="comment-author-handle">${escapeHtml(handle)}</span>` : ''}
									</div>
								`}
							</div>
							<div class="comment-text">${safeText}</div>
							${timeAgo ? `<div class="comment-time-row"><span class="comment-time" title="${escapeHtml(timeTitle)}">${escapeHtml(timeAgo)}</span></div>` : ''}
						</div>
					</div>
				`;
			}).join('');

			// Comments were re-rendered; hydrate any YouTube link labels within them.
			hydrateYoutubeLinkTitles(commentListEl);
			hydrateXLinkTitles(commentListEl);
		}

		async function loadComments({ scrollIfHash = false } = {}) {
			if (!commentListEl) return;
			commentListEl.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';
			if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';

			const res = await fetchCreatedImageComments(creationId, { order: commentsState.order, limit: 50, offset: 0 })
				.catch(() => ({ ok: false, status: 0, data: null }));

			if (!res.ok) {
				if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';
				commentListEl.innerHTML = html`
					<div class="route-empty comments-empty">
						<div class="route-empty-title">Unable to load comments</div>
					</div>
				`;
				return;
			}

			const comments = Array.isArray(res.data?.comments) ? res.data.comments : [];
			const commentCount = Number(res.data?.comment_count ?? comments.length);
			commentsState.comments = comments;
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

		// Now that the creation detail view is fully resolved, show actions.
		if (actionsEl && actionsEl.style.display !== 'none') {
			// Clear inline hidden styles (set in HTML / loading state) so CSS can reveal.
			actionsEl.style.opacity = '';
			actionsEl.style.visibility = '';
			actionsEl.style.pointerEvents = '';
			actionsEl.classList.add('is-ready');
		}
	} catch (error) {
		// console.error("Error loading creation detail:", error);
		detailContent.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">Unable to load creation</div>
				<div class="route-empty-message">An error occurred while loading the creation.</div>
			</div>
		`;
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


async function handleDelete() {
	const creationId = getCreationId();
	if (!creationId) {
		alert('Invalid creation ID');
		return;
	}

	// Confirm deletion
	if (!confirm('Are you sure you want to delete this creation? This action cannot be undone.')) {
		return;
	}

	const deleteBtn = document.querySelector('[data-delete-btn]');
	if (deleteBtn) {
		deleteBtn.disabled = true;
	}

	try {
		const response = await fetch(`/api/create/images/${creationId}`, {
			method: 'DELETE',
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to delete creation');
		}

		// Success - navigate to creations page
		window.location.href = '/creations';
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

