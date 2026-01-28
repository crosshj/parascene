import { formatDateTime, formatRelativeTime } from '/shared/datetime.js';
import { enableLikeButtons, getCreationLikeCount, initLikeButton } from '/shared/likes.js';
import { fetchJsonWithStatusDeduped } from '/shared/api.js';
import { getAvatarColor } from '/shared/avatar.js';
import { fetchCreatedImageComments, postCreatedImageComment } from '/shared/comments.js';
import '../components/modals/publish.js';
import '../components/modals/creation-details.js';

// Set up URL change detection BEFORE header component loads
// This ensures we capture navigation events

// Get creation ID from URL
function getCreationId() {
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)$/);
	return match ? parseInt(match[1], 10) : null;
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
		detailContent.innerHTML = `
			<div class="route-empty">
				<div class="route-empty-title">Invalid creation ID</div>
			</div>
		`;
		if (actionsEl) actionsEl.style.display = 'none';
		return;
	}

	detailContent.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';

	try {
		const response = await fetch(`/api/create/images/${creationId}`, {
			credentials: 'include'
		});
		if (!response.ok) {
			if (response.status === 404) {
				detailContent.innerHTML = `
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

		// Load like metadata from backend (no localStorage fallback).
		let likeMeta = { like_count: 0, viewer_liked: false };
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

		// Update edit button - show for published creations if owner/admin and not failed
		const editBtn = document.querySelector('[data-edit-btn]');
		if (editBtn) {
			if (!canEdit || !isPublished || isFailed) {
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

			publishedLabel = `
				<div class="creation-detail-author-published" ${publishedAtTitle ? `title="${publishedAtTitle}"` : ''}>
					Published${publishedTimeAgo ? ` ${publishedTimeAgo}` : ''}
				</div>
			`;
		}

		// Show description whenever it exists, regardless of publication status
		let descriptionHtml = '';
		const descriptionText = typeof creation.description === 'string' ? creation.description.trim() : '';
		if (descriptionText) {
			descriptionHtml = `
				<div class="creation-detail-published">
					<div class="creation-detail-description">${escapeHtml(descriptionText)}</div>
				</div>
			`;
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

		const authorAvatar = `
			<span class="creation-detail-author-icon" style="background: ${creatorColor};">
				${creatorAvatarUrl ? `<img class="creation-detail-author-avatar" src="${creatorAvatarUrl}" alt="">` : creatorInitial}
			</span>
		`;

		const authorIdentification = `
			<span class="creation-detail-author-name">${creatorName}</span>
			<span class="creation-detail-author-handle">${creatorHandle}</span>
		`;

		detailContent.innerHTML = `
			<div class="creation-detail-author">
				${creatorProfileHref ? `
					<a class="user-link creation-detail-author-avatar-slot" href="${creatorProfileHref}" aria-label="View ${creatorName} profile">
						${authorAvatar}
					</a>
				` : `
					<div class="creation-detail-author-avatar-slot" aria-hidden="true">
						${authorAvatar}
					</div>
				`}

				<div class="creation-detail-author-id">
					${creatorProfileHref ? `
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
				${meta && (meta.server_id !== undefined || meta.method || meta.args) ? `
				<button class="feed-card-action" type="button" data-creation-details-link>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 8v8"></path>
						<path d="M12 6h.01"></path>
					</svg>
					<span>Details</span>
				</button>
				${isPublished && !isFailed ? '<span>•</span>' : ''}
				` : ``}
				${isPublished && !isFailed ? `
				<a class="feed-card-action creation-detail-comments-link" href="#comments" data-comments-link aria-label="Comments">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 15a4 4 0 0 1-4 4H8l-5 5V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
					</svg>
					<span class="feed-card-action-count" data-comment-count>0</span>
				</a>
				<span>•</span>
				<button class="feed-card-action" type="button" aria-label="Like" data-like-button>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
					</svg>
					<span class="feed-card-action-count" data-like-count>${likeCount}</span>
				</button>
				` : ''}
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
						<option value="desc">Most recent</option>
						<option value="asc">Oldest</option>
					</select>
				</div>
			</div>
			<div id="comments" data-comments-anchor></div>
			<div class="comment-list" data-comment-list>
				<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
			</div>
			` : ''}
		`;

		const likeButton = detailContent.querySelector('button[data-like-button]');
		if (likeButton) {
			initLikeButton(likeButton, creationWithLikes);
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

		enableLikeButtons(detailContent);

		function scrollToComments() {
			const el = detailContent.querySelector('#comments');
			if (!el) return;
			el.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}

		let commentsDidInitialHashScroll = false;
		const commentsState = {
			order: 'desc',
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
				commentListEl.innerHTML = `
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
				const safeText = escapeHtml(c?.text ?? '');

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
		}

		async function loadComments({ scrollIfHash = false } = {}) {
			if (!commentListEl) return;
			commentListEl.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';
			if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';

			const res = await fetchCreatedImageComments(creationId, { order: commentsState.order, limit: 50, offset: 0 })
				.catch(() => ({ ok: false, status: 0, data: null }));

			if (!res.ok) {
				if (commentsToolbarEl instanceof HTMLElement) commentsToolbarEl.style.display = 'none';
				commentListEl.innerHTML = `
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

		function autoGrowTextarea() {
			if (!(commentTextarea instanceof HTMLTextAreaElement)) return;
			commentTextarea.style.height = 'auto';
			commentTextarea.style.height = `${commentTextarea.scrollHeight}px`;
		}

		if (commentTextarea instanceof HTMLTextAreaElement) {
			commentTextarea.addEventListener('input', () => {
				autoGrowTextarea();
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
					autoGrowTextarea();
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
		autoGrowTextarea();
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
		console.error("Error loading creation detail:", error);
		detailContent.innerHTML = `
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
	console.log('checkAndLoadCreation called, creationId:', creationId, 'currentCreationId:', currentCreationId);
	// Only reload if the creation ID has changed
	if (creationId && creationId !== currentCreationId) {
		setActionsLoadingState();
		console.log('Creation ID changed, loading new creation');
		currentCreationId = creationId;
		loadCreation();
		// Reset scroll to top
		window.scrollTo(0, 0);
	} else if (!creationId && currentCreationId !== null) {
		// If we're no longer on a creation detail page, reset
		console.log('No longer on creation detail page');
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
		console.error('Error deleting creation:', error);
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
	const pendingKey = "pendingCreations";
	const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const pendingItem = {
		id: pendingId,
		status: "pending",
		created_at: new Date().toISOString(),
		creation_token: creationToken
	};

	const pendingList = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
	pendingList.unshift(pendingItem);
	sessionStorage.setItem(pendingKey, JSON.stringify(pendingList));

	// Hide the failed creation we are retrying from the creations list view (session-only).
	try {
		const hiddenKey = 'hiddenFailedCreations';
		const rawHidden = sessionStorage.getItem(hiddenKey);
		const hiddenList = rawHidden ? JSON.parse(rawHidden) : [];
		const nextHidden = Array.isArray(hiddenList) ? hiddenList.slice() : [];
		const idValue = Number.isFinite(creationId) ? creationId : Number(creationId);
		const idString = String(idValue);
		if (!nextHidden.some((id) => String(id) === idString)) {
			nextHidden.push(idValue);
		}
		sessionStorage.setItem(hiddenKey, JSON.stringify(nextHidden));
	} catch {
		// Non-fatal: if sessionStorage fails, user will just see both tiles.
	}

	document.dispatchEvent(new CustomEvent("creations-pending-updated"));
	const creationsRoute = document.querySelector("app-route-creations");
	if (creationsRoute && typeof creationsRoute.loadCreations === "function") {
		await creationsRoute.loadCreations({ force: true, background: false });
	}

	// Navigate back to creations list view
	const header = document.querySelector('app-navigation');
	if (header && typeof header.navigateToRoute === 'function') {
		header.navigateToRoute('creations');
	} else {
		window.location.href = '/creations';
	}

	// Kick off new create job with same server/method/args but fresh creation_token
	fetch("/api/create", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		credentials: "include",
		body: JSON.stringify({
			server_id: serverId,
			method,
			args: args || {},
			creation_token: creationToken
		})
	})
		.then(async (response) => {
			if (!response.ok) {
				const error = await response.json();
				if (response.status === 402) {
					// Refresh credits to get updated balance
					document.dispatchEvent(new CustomEvent('credits-updated', {
						detail: { count: error.current ?? 0 }
					}));
					alert(error.message || "Insufficient credits");
					throw new Error(error.message || "Insufficient credits");
				}
				throw new Error(error.error || "Failed to retry creation");
			}
			const data = await response.json();
			if (typeof data.credits_remaining === 'number') {
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: data.credits_remaining }
				}));
			}
			return null;
		})
		.then(() => {
			const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
			const next = current.filter(item => item.id !== pendingId);
			sessionStorage.setItem(pendingKey, JSON.stringify(next));
			document.dispatchEvent(new CustomEvent("creations-pending-updated"));
		})
		.catch((error) => {
			const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
			const next = current.filter(item => item.id !== pendingId);
			sessionStorage.setItem(pendingKey, JSON.stringify(next));
			document.dispatchEvent(new CustomEvent("creations-pending-updated"));
			console.error('Error retrying creation:', error);
			alert(error.message || 'Failed to retry creation. Please try again.');
		})
		.finally(() => {
			const btn = document.querySelector('[data-retry-btn]');
			if (btn) {
				btn.disabled = false;
			}
		});
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
		console.error('Error unpublishing creation:', error);
		alert(error.message || 'Failed to unpublish creation. Please try again.');

		if (unpublishBtn) {
			unpublishBtn.disabled = false;
		}
	}
}

// Listen for URL changes (browser back/forward navigation)
// Use capture phase to ensure we get the event before header handles it
window.addEventListener('popstate', (e) => {
	console.log('popstate event fired', window.location.pathname);
	// Check if we're still on a creation detail page
	const creationId = getCreationId();
	if (creationId) {
		checkAndLoadCreation();
	}
}, true);

// Override pushState and replaceState to detect programmatic navigation
history.pushState = function (...args) {
	console.log('pushState called', args);
	originalPushState(...args);
	// Check if URL changed to a different creation
	setTimeout(() => {
		const creationId = getCreationId();
		console.log('After pushState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

history.replaceState = function (...args) {
	console.log('replaceState called', args);
	originalReplaceState(...args);
	setTimeout(() => {
		const creationId = getCreationId();
		console.log('After replaceState, creationId:', creationId);
		if (creationId) {
			checkAndLoadCreation();
		}
	}, 0);
};

// Listen for the route-change event from the header component
document.addEventListener('route-change', (e) => {
	console.log('route-change event fired', e.detail?.route);
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

