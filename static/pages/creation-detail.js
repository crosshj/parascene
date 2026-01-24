import { formatDateTime, formatRelativeTime } from '/shared/datetime.js';
import { enableLikeButtons, getCreationLikeCount, initLikeButton } from '/shared/likes.js';
import { fetchJsonWithStatusDeduped } from '/shared/api.js';

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
		const likeCount = getCreationLikeCount(creationWithLikes);

		// Set image and blurred background
		imageWrapper?.classList.remove('image-error');
		imageWrapper?.classList.add('image-loading');
		backgroundEl.style.backgroundImage = '';
		imageEl.style.visibility = 'hidden';
		imageEl.dataset.currentUrl = creation.url;
		imageEl.src = creation.url;

		// Format date
		const date = new Date(creation.created_at);
		const timeAgo = formatRelativeTime(date);
		const createdAtTitle = formatDateTime(date);

		// Generate title from published title, filename, or use default
		const isPublished = creation.published === true || creation.published === 1;
		const displayTitle = creation.title || (creation.filename
			? creation.filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
			: 'Creation');

		// Check if current user owns this creation
		let currentUserId = null;
		try {
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
			if (profile.ok) {
				currentUserId = profile.data?.id ?? null;
			}
		} catch {
			// ignore
		}

		const isOwner = currentUserId && creation.user_id && currentUserId === creation.user_id;

		// Update publish button - hide if not owner, disable if already published
		const publishBtn = document.querySelector('[data-publish-btn]');
		if (publishBtn) {
			if (!isOwner) {
				// Hide publish button if user doesn't own the creation
				publishBtn.style.display = 'none';
			} else {
				// Button is active (enabled) when not already published
				publishBtn.style.display = '';
				publishBtn.disabled = isPublished;

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
				publishBtn.appendChild(document.createTextNode(isPublished ? ' Published' : ' Publish'));
			}
		}

		// Update delete button - hide if not owner, disable if published
		const deleteBtn = document.querySelector('[data-delete-btn]');
		if (deleteBtn) {
			if (!isOwner) {
				// Hide delete button if user doesn't own the creation
				deleteBtn.style.display = 'none';
			} else {
				// Button is disabled if already published
				deleteBtn.style.display = '';
				deleteBtn.disabled = isPublished;
			}
		}

		// If no actions are visible, hide the whole actions row to avoid empty spacing.
		if (actionsEl) {
			const actionButtons = Array.from(actionsEl.querySelectorAll('button'));
			const anyVisible = actionButtons.some(btn => btn.style.display !== 'none');
			actionsEl.style.display = anyVisible ? '' : 'none';
		}

		// Build published info if published
		let publishedInfo = '';
		if (isPublished && creation.published_at) {
			const publishedDate = new Date(creation.published_at);
			const publishedTimeAgo = formatRelativeTime(publishedDate);
			const publishedAtTitle = formatDateTime(publishedDate);
			publishedInfo = `
				<div class="creation-detail-published">
					<div class="creation-detail-published-label" title="${publishedAtTitle}">Published ${publishedTimeAgo}</div>
					${creation.description ? `<div class="creation-detail-description">${creation.description}</div>` : ''}
				</div>
			`;
		}

		// Get creator information
		const creatorName = creation.creator?.email
			? creation.creator.email.split('@')[0]
			: 'User';
		const creatorHandle = creation.creator?.email
			? `@${creation.creator.email.split('@')[0]}`
			: '@user';
		const creatorInitial = creatorName.charAt(0).toUpperCase();

		detailContent.innerHTML = `
			<div class="creation-detail-author">
				<span class="creation-detail-author-icon">${creatorInitial}</span>
				<span class="creation-detail-author-name">${creatorName}</span>
				<span class="creation-detail-author-handle">${creatorHandle}</span>
				<span class="creation-detail-date" title="${createdAtTitle}">${timeAgo}</span>
			</div>
			<div class="creation-detail-title">${displayTitle}</div>
			${publishedInfo}
			<div class="creation-detail-meta">
				<span title="${createdAtTitle}">Created ${timeAgo}</span>
				<span>•</span>
				<span>0 comments</span>
				<span>•</span>
				<button class="feed-card-action" type="button" aria-label="Like" data-like-button>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
					</svg>
					<span class="feed-card-action-count" data-like-count>${likeCount}</span>
				</button>
			</div>
		`;

		const likeButton = detailContent.querySelector('button[data-like-button]');
		if (likeButton) {
			initLikeButton(likeButton, creationWithLikes);
		}

		enableLikeButtons(detailContent);

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

// Publish modal functionality
function openPublishModal() {
	const modal = document.querySelector('[data-publish-modal]');
	if (modal) {
		modal.classList.add('open');
		// Body scroll prevention is handled globally in global.js
		// Hide any existing alert
		hidePublishAlert();
		// Focus on title input
		const titleInput = document.getElementById('publish-title');
		if (titleInput) {
			setTimeout(() => titleInput.focus(), 100);
		}
	}
}

function closePublishModal() {
	const modal = document.querySelector('[data-publish-modal]');
	if (modal) {
		modal.classList.remove('open');
		// Body scroll restoration is handled globally in global.js
		// Clear form
		const titleInput = document.getElementById('publish-title');
		const descriptionTextarea = document.getElementById('publish-description');
		if (titleInput) titleInput.value = '';
		if (descriptionTextarea) descriptionTextarea.value = '';
		// Hide alert
		hidePublishAlert();
	}
}

function showPublishAlert(message, isError = true) {
	const alert = document.querySelector('[data-publish-alert]');
	const alertMessage = document.querySelector('[data-publish-alert-message]');
	if (alert && alertMessage) {
		alertMessage.textContent = message;
		alert.className = `publish-alert ${isError ? 'publish-alert-error' : 'publish-alert-success'}`;
		alert.style.display = 'flex';
	}
}

function hidePublishAlert() {
	const alert = document.querySelector('[data-publish-alert]');
	if (alert) {
		alert.style.display = 'none';
	}
}

// Close alert button handler
document.addEventListener('click', (e) => {
	if (e.target.closest('[data-publish-alert-close]')) {
		hidePublishAlert();
	}
});

// Set up modal event listeners
document.addEventListener('DOMContentLoaded', () => {
	checkAndLoadCreation();
});

// Open modal when publish button is clicked
document.addEventListener('click', (e) => {
	const publishBtn = e.target.closest('[data-publish-btn]');
	if (publishBtn && !publishBtn.disabled) {
		e.preventDefault();
		openPublishModal();
	}
});

// Close modal handlers - set up after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	const modal = document.querySelector('[data-publish-modal]');
	if (modal) {
		// Close on overlay click (but not when clicking inside the modal)
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				closePublishModal();
			}
		});

		// Close on X button or cancel link
		const closeButtons = document.querySelectorAll('[data-publish-modal-close]');
		closeButtons.forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				closePublishModal();
			});
		});
	}
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
	const modal = document.querySelector('[data-publish-modal]');
	if (e.key === 'Escape' && modal && modal.classList.contains('open')) {
		const loading = document.querySelector('[data-publish-loading]');
		if (!loading || !loading.classList.contains('active')) {
			closePublishModal();
		}
	}
});

// Publish submission handler
document.addEventListener('click', (e) => {
	if (e.target.closest('[data-publish-submit]')) {
		e.preventDefault();
		handlePublish();
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

async function handlePublish() {
	const creationId = getCreationId();
	if (!creationId) {
		showPublishAlert('Invalid creation ID');
		return;
	}

	const titleInput = document.getElementById('publish-title');
	const descriptionTextarea = document.getElementById('publish-description');
	const loadingOverlay = document.querySelector('[data-publish-loading]');
	const modal = document.querySelector('[data-publish-modal]');
	const submitBtn = document.querySelector('[data-publish-submit]');
	const cancelLink = document.querySelector('.publish-cancel-link');

	if (!titleInput || !loadingOverlay || !modal) return;

	const title = titleInput.value.trim();
	const description = descriptionTextarea ? descriptionTextarea.value.trim() : '';

	if (!title) {
		showPublishAlert('Title is required');
		titleInput.focus();
		return;
	}

	// Hide any existing alert
	hidePublishAlert();

	// Show loading state
	loadingOverlay.classList.add('active');
	titleInput.disabled = true;
	if (descriptionTextarea) descriptionTextarea.disabled = true;
	if (submitBtn) submitBtn.disabled = true;
	if (cancelLink) {
		cancelLink.style.pointerEvents = 'none';
		cancelLink.style.opacity = '0.5';
	}

	try {
		const response = await fetch(`/api/create/images/${creationId}/publish`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ title, description }),
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to publish creation');
		}

		// Success - navigate to creation detail page
		window.location.href = `/creations/${creationId}`;
	} catch (error) {
		console.error('Error publishing creation:', error);
		showPublishAlert(error.message || 'Failed to publish creation. Please try again.');

		// Hide loading state
		loadingOverlay.classList.remove('active');
		titleInput.disabled = false;
		if (descriptionTextarea) descriptionTextarea.disabled = false;
		if (submitBtn) submitBtn.disabled = false;
		if (cancelLink) {
			cancelLink.style.pointerEvents = '';
			cancelLink.style.opacity = '';
		}
	}
}

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

