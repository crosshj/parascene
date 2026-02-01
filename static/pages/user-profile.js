import { formatDate, formatDateTime, formatRelativeTime } from '../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../shared/api.js';
import { getAvatarColor } from '../shared/avatar.js';

const html = String.raw;

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = String(text ?? '');
	return div.innerHTML;
}

function safeJsonParse(text, fallback) {
	if (text == null) return fallback;
	if (typeof text === 'object') return text;
	if (typeof text !== 'string') return fallback;
	const trimmed = text.trim();
	if (!trimmed) return fallback;
	try {
		return JSON.parse(trimmed);
	} catch {
		return fallback;
	}
}

function getPathUserId() {
	const pathname = window.location.pathname || '';
	if (pathname === '/user') return { kind: 'me', userId: null };
	const match = pathname.match(/^\/user\/(\d+)$/);
	if (!match) return { kind: 'invalid', userId: null };
	const id = Number.parseInt(match[1], 10);
	if (!Number.isFinite(id) || id <= 0) return { kind: 'invalid', userId: null };
	return { kind: 'other', userId: id };
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

function guessHandle({ user, profile }) {
	const userName = profile?.user_name ? String(profile.user_name) : '';
	if (userName) return `@${userName}`;
	const emailPrefix =
		(user?.email_prefix ? String(user.email_prefix) : '') ||
		(user?.email ? String(user.email).split('@')[0] : '');
	if (emailPrefix) return `@${emailPrefix}`;
	const id = user?.id != null ? String(user.id) : 'user';
	return `@user-${id}`;
}

function buildBannerStyle(coverImageUrl) {
	const url = typeof coverImageUrl === 'string' ? coverImageUrl.trim() : '';
	if (!url) return '';
	// IMPORTANT: This string is injected into an HTML attribute wrapped in double quotes.
	// So we must avoid double quotes inside the value, otherwise the attribute breaks.
	const safeUrl = url.replace(/'/g, "\\'");
	return `background-image: linear-gradient(135deg, rgba(124, 58, 237, 0.32), rgba(5, 199, 111, 0.22)), linear-gradient(180deg, rgba(0, 0, 0, 0.15), transparent), url('${safeUrl}');`;
}

function normalizeWebsite(raw) {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return null;

	let href = value;
	if (!/^https?:\/\//i.test(href)) href = `https://${href}`;

	try {
		const url = new URL(href);
		const label = value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
		return { href: url.href, label: label || url.host || url.href };
	} catch {
		return { href, label: value };
	}
}

function renderProfilePage(container, { user, profile, stats, isSelf, viewerFollows, isAdmin = false }) {
	const fallbackName =
		(user?.email_prefix && String(user.email_prefix).trim()) ||
		(isSelf && user?.email ? String(user.email).split('@')[0] : '') ||
		'';
	const displayName =
		(profile?.display_name && String(profile.display_name).trim()) ||
		(profile?.user_name && String(profile.user_name).trim()) ||
		(fallbackName || `User ${user?.id ?? ''}`);

	const handle = guessHandle({ user, profile });
	const about = typeof profile?.about === 'string' ? profile.about.trim() : '';
	const website = normalizeWebsite(profile?.socials?.website);
	const avatarUrl = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
	const coverUrl = typeof profile?.cover_image_url === 'string' ? profile.cover_image_url.trim() : '';
	const userNameValue = profile?.user_name && String(profile.user_name).trim() ? String(profile.user_name).trim() : '';
	const userNameLocked = Boolean(userNameValue);

	const avatarInitial = displayName.trim().charAt(0).toUpperCase() || '?';
	const avatarColor = getAvatarColor(profile?.user_name || user?.email_prefix || user?.email || String(user?.id || ''));

	const memberSince = stats?.member_since ? formatDate(stats.member_since) : null;
	const creationsPublished = Number(stats?.creations_published ?? 0);
	const likesReceived = Number(stats?.likes_received ?? 0);

	container.innerHTML = html`
		<div class="user-profile-hero">
			<div class="user-profile-banner" style="${buildBannerStyle(coverUrl)}"></div>
			<div class="user-profile-hero-inner">
				<div class="user-profile-avatar">
					${avatarUrl ? html`
						<img class="user-profile-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">
					` : html`
						<div class="user-profile-avatar-fallback" style="background: ${avatarColor};" aria-hidden="true">${escapeHtml(avatarInitial)}</div>
					`}
				</div>

				<div class="user-profile-identity">
					<div class="user-profile-title-row">
						<div class="user-profile-name">${escapeHtml(displayName)}</div>
						<div class="user-profile-actions">
							${isSelf ? html`<button class="btn-primary user-profile-edit" type="button">Edit Profile</button>` : ''}
							${!isSelf ? html`
								<button class="${viewerFollows ? 'btn-secondary' : 'btn-primary'} user-profile-follow" type="button" data-follow-button data-follow-user-id="${escapeHtml(user?.id ?? '')}">
									${viewerFollows ? 'Unfollow' : 'Follow'}
								</button>
							` : ''}
							<!--
							<button class="btn-secondary user-profile-share" type="button">Share</button>
							-->
						</div>
					</div>
					<div class="user-profile-handle">${escapeHtml(handle)}</div>

					<div class="user-profile-stats">
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${creationsPublished}</div>
							<div class="user-profile-stat-label">Published</div>
						</div>
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${likesReceived}</div>
							<div class="user-profile-stat-label">Likes</div>
						</div>
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${escapeHtml(memberSince || '—')}</div>
							<div class="user-profile-stat-label">Member Since</div>
						</div>
					</div>

					${(about || website) ? html`
						<div class="user-profile-meta">
							${about ? html`
								<div class="user-profile-meta-row">
									<span class="user-profile-meta-label">About</span>
									<span class="user-profile-meta-text">${escapeHtml(about)}</span>
								</div>
							` : ''}
							${website ? html`
								<div class="user-profile-meta-row">
									<span class="user-profile-meta-label">Website</span>
									<a class="user-profile-meta-link" href="${escapeHtml(website.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(website.label)}</a>
								</div>
							` : ''}
						</div>
					` : ''}
				</div>
			</div>
		</div>

		<div class="user-profile-content">
			${(isSelf || isAdmin) ? html`
				<div class="user-profile-tabs">
					<button type="button" class="user-profile-tab is-active" data-tab="published">Published</button>
					<button type="button" class="user-profile-tab" data-tab="all">All</button>
				</div>
			` : ''}
			<div class="route-cards route-cards-image-grid" data-profile-grid>
				<div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
			</div>
		</div>

		<div class="modal-overlay" data-profile-edit-overlay>
			<div class="modal modal-large">
				<div class="modal-header">
					<h2>Edit profile</h2>
					<button class="modal-close" type="button" aria-label="Close" data-profile-edit-close>
						<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<form class="user-profile-edit-form" data-profile-edit-form>
						<div class="user-profile-form-section">
						<div class="field">
							<label>Username</label>
							<input name="user_name" placeholder="e.g. oceanman" value="${escapeHtml(userNameValue)}" ${userNameLocked ? 'disabled' : ''}>
							<div class="user-profile-help">
								${userNameLocked
			? 'Username is permanent and cannot be changed.'
			: '3–24 characters. Lowercase letters, numbers, and underscores only. This cannot be changed later.'}
							</div>
						</div>
						<div class="field">
							<label>Display name</label>
							<input name="display_name" placeholder="e.g. OceanMan" value="${escapeHtml(profile?.display_name || '')}">
							<div class="user-profile-help">Shown on your profile. You can use spaces and caps here.</div>
						</div>
						</div>

						<div class="user-profile-form-section">
						<div class="field">
							<label>Bio</label>
							<textarea name="about" rows="4" placeholder="A short bio...">${escapeHtml(profile?.about || '')}</textarea>
							<div class="user-profile-help">Keep it short and readable. Line breaks are allowed.</div>
						</div>
						</div>

						<div class="user-profile-form-section">
						<div class="grid-2-col">
							<div class="field">
								<label>Avatar</label>
								<div class="user-profile-upload" data-upload="avatar">
									<input class="user-profile-file-input" type="file" name="avatar_file" accept="image/*" data-upload-input="avatar">
									<input type="hidden" name="avatar_remove" value="" data-upload-remove="avatar">
									<button class="user-profile-upload-button btn-secondary" type="button" data-upload-trigger="avatar">Upload avatar</button>
									<div class="user-profile-upload-preview" data-upload-preview="avatar" hidden>
										<img class="user-profile-upload-img" alt="Avatar preview" data-upload-img="avatar">
										<button class="user-profile-upload-remove" type="button" aria-label="Remove avatar" data-upload-clear="avatar">✕</button>
									</div>
								</div>
								${profile?.avatar_url ? html`
									<div class="user-profile-upload-hydrate" data-upload-existing="avatar" data-url="${escapeHtml(profile.avatar_url)}"></div>
								` : ''}
							</div>
							<div class="field">
								<label>Cover</label>
								<div class="user-profile-upload" data-upload="cover">
									<input class="user-profile-file-input" type="file" name="cover_file" accept="image/*" data-upload-input="cover">
									<input type="hidden" name="cover_remove" value="" data-upload-remove="cover">
									<button class="user-profile-upload-button btn-secondary" type="button" data-upload-trigger="cover">Upload cover</button>
									<div class="user-profile-upload-preview user-profile-upload-preview-cover" data-upload-preview="cover" hidden>
										<img class="user-profile-upload-img" alt="Cover preview" data-upload-img="cover">
										<button class="user-profile-upload-remove" type="button" aria-label="Remove cover image" data-upload-clear="cover">✕</button>
									</div>
								</div>
								${profile?.cover_image_url ? html`
									<div class="user-profile-upload-hydrate" data-upload-existing="cover" data-url="${escapeHtml(profile.cover_image_url)}"></div>
								` : ''}
							</div>
						</div>
						</div>

						<div class="user-profile-form-section">
						<div class="field">
							<label>Website</label>
							<input name="social_website" placeholder="https://example.com" value="${escapeHtml(profile?.socials?.website || '')}">
						</div>
						</div>

						<div class="alert error" data-profile-edit-error style="display: none;"></div>
					</form>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" type="button" data-profile-edit-cancel>Cancel</button>
					<button class="btn-primary" type="button" data-profile-edit-save>Save</button>
				</div>
			</div>
		</div>
	`;
}

function setModalOpen(overlay, open) {
	if (!overlay) return;
	overlay.classList.toggle('open', Boolean(open));
	if (open) {
		document.body.classList.add('modal-open');
		document.dispatchEvent(new CustomEvent('modal-opened'));
	} else {
		document.body.classList.remove('modal-open');
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}
}

function setRouteMediaBackgroundImage(mediaEl, url) {
	if (!mediaEl || !url) return;
	mediaEl.classList.remove('route-media-error');
	mediaEl.style.backgroundImage = '';

	const probe = new Image();
	probe.decoding = 'async';
	if ('fetchPriority' in probe) {
		probe.fetchPriority = document.visibilityState === 'visible' ? 'auto' : 'low';
	}
	probe.onload = () => {
		mediaEl.classList.remove('route-media-error');
		mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
	};
	probe.onerror = () => {
		mediaEl.classList.add('route-media-error');
		mediaEl.style.backgroundImage = '';
	};
	probe.src = url;
}

function renderImageGrid(grid, images, showBadge = false) {
	if (!grid) return;

	const list = Array.isArray(images) ? images : [];
	if (list.length === 0) {
		grid.innerHTML = html`
			<div class="route-empty route-empty-image-grid">
				<div class="route-empty-title">No published creations yet</div>
				<div class="route-empty-message">When this user publishes creations, they’ll show up here.</div>
			</div>
		`;
		return;
	}

	grid.innerHTML = '';

	// Lazy load images into route-media tiles.
	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			const el = entry.target;
			const url = el.dataset.bgUrl;
			if (!url) return;
			observer.unobserve(el);
			setRouteMediaBackgroundImage(el, url);
		});
	}, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

	list.forEach((item) => {
		const card = document.createElement('div');
		card.className = 'route-card route-card-image';
		card.style.cursor = 'pointer';
		card.addEventListener('click', () => {
			window.location.href = `/creations/${item.id}`;
		});

		const isPublished = item.published === true || item.published === 1;
		let publishedBadge = '';
		let publishedInfo = '';

		if (isPublished && showBadge) {
			publishedBadge = html`
				<div class="creation-published-badge" title="Published">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"></circle>
						<line x1="2" y1="12" x2="22" y2="12"></line>
						<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
					</svg>
				</div>
			`;
		}

		if (isPublished && item.published_at) {
			const publishedDate = new Date(item.published_at);
			const publishedTimeAgo = formatRelativeTime(publishedDate);
			publishedInfo = html`<div class="route-meta" title="${formatDateTime(publishedDate)}">Published ${publishedTimeAgo}</div>`;
		}

		card.innerHTML = html`
			<div class="route-media" aria-hidden="true"></div>
			${publishedBadge}
			<div class="route-details">
				<div class="route-details-content">
					<div class="route-title">${escapeHtml(item.title || 'Untitled')}</div>
					<div class="route-summary">${escapeHtml(item.width)} × ${escapeHtml(item.height)}px</div>
					${publishedInfo}
					<div class="route-meta">${escapeHtml(formatDate(item.created_at) || '')}</div>
				</div>
			</div>
		`;

		const mediaEl = card.querySelector('.route-media');
		const url = item.thumbnail_url || item.url;
		if (mediaEl && url) {
			mediaEl.dataset.bgUrl = url;
			observer.observe(mediaEl);
		}

		grid.appendChild(card);
	});
}

async function loadProfileSummary(targetUserId) {
	const result = await fetchJsonWithStatusDeduped(`/api/users/${targetUserId}/profile`, {
		credentials: 'include'
	}, { windowMs: 1000 });
	if (!result.ok) {
		throw new Error('Failed to load profile');
	}
	return result.data;
}

async function loadUserImages(targetUserId, { includeAll = false } = {}) {
	const url = includeAll ? `/api/users/${targetUserId}/created-images?include=all` : `/api/users/${targetUserId}/created-images`;
	const result = await fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 800 });
	if (!result.ok) {
		throw new Error('Failed to load images');
	}
	return Array.isArray(result.data?.images) ? result.data.images : [];
}

async function init() {
	const container = document.querySelector('.user-profile-page');
	if (!container) return;

	const info = getPathUserId();
	let targetUserId = info.userId;

	if (info.kind === 'me') {
		const me = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 500 })
			.catch(() => ({ ok: false, status: 0, data: null }));
		if (!me.ok) {
			container.innerHTML = html`<div class="route-empty">Please log in to view your profile.</div>`;
			return;
		}
		targetUserId = me.data?.id ?? null;
	}

	if (!targetUserId) {
		container.innerHTML = html`<div class="route-empty">User not found.</div>`;
		return;
	}

	let summary;
	try {
		summary = await loadProfileSummary(targetUserId);
	} catch {
		container.innerHTML = html`<div class="route-empty">Unable to load profile.</div>`;
		return;
	}

	const user = summary.user || {};
	const profile = summary.profile || {};
	const stats = summary.stats || {};
	const isSelf = Boolean(summary.is_self);
	const viewerFollows = Boolean(summary.viewer_follows);

	// Get current user to check admin role
	let isAdmin = false;
	try {
		const currentUser = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 500 });
		if (currentUser.ok && currentUser.data) {
			isAdmin = currentUser.data.role === 'admin';
		}
	} catch {
		// ignore errors
	}

	// Normalize json fields in case adapter returned strings (sqlite)
	profile.socials = safeJsonParse(profile.socials, {});
	profile.badges = safeJsonParse(profile.badges, []);
	profile.meta = safeJsonParse(profile.meta, {});

	renderProfilePage(container, { user, profile, stats, isSelf, viewerFollows, isAdmin });

	const grid = container.querySelector('[data-profile-grid]');
	const tabButtons = Array.from(container.querySelectorAll('.user-profile-tab'));
	const overlay = container.querySelector('[data-profile-edit-overlay]');

	const publishedImages = await loadUserImages(targetUserId, { includeAll: false }).catch(() => []);
	renderImageGrid(grid, publishedImages, false);

	let allImagesCache = null;

	tabButtons.forEach((btn) => {
		btn.addEventListener('click', async () => {
			tabButtons.forEach((b) => b.classList.remove('is-active'));
			btn.classList.add('is-active');

			const tab = btn.getAttribute('data-tab');
			if (!grid) return;

			grid.innerHTML = html`<div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>`;

			if (tab === 'all' && (isSelf || isAdmin)) {
				if (!allImagesCache) {
					allImagesCache = await loadUserImages(targetUserId, { includeAll: true }).catch(() => []);
				}
				renderImageGrid(grid, allImagesCache, true);
				return;
			}

			renderImageGrid(grid, publishedImages, false);
		});
	});

	const shareButton = container.querySelector('.user-profile-share');
	if (shareButton) {
		shareButton.addEventListener('click', async () => {
			const link = window.location.href;
			const ok = await copyTextToClipboard(link);
			shareButton.textContent = ok ? 'Copied' : 'Copy failed';
			setTimeout(() => { shareButton.textContent = 'Share'; }, 1200);
		});
	}

	const followButton = container.querySelector('[data-follow-button]');
	if (followButton && !isSelf) {
		let busy = false;
		let following = viewerFollows;

		function updateButton() {
			followButton.textContent = following ? 'Unfollow' : 'Follow';
			followButton.classList.toggle('btn-secondary', following);
			followButton.classList.toggle('btn-primary', !following);
			followButton.disabled = busy;
		}

		updateButton();

		followButton.addEventListener('click', async () => {
			if (busy) return;
			const targetIdRaw = followButton.getAttribute('data-follow-user-id') || '';
			const targetId = Number.parseInt(targetIdRaw, 10);
			if (!Number.isFinite(targetId) || targetId <= 0) return;

			busy = true;
			const prev = following;
			// Optimistic toggle
			following = !following;
			updateButton();

			const method = prev ? 'DELETE' : 'POST';
			const result = await fetchJsonWithStatusDeduped(`/api/users/${targetId}/follow`, {
				method,
				credentials: 'include'
			}, { windowMs: 0 }).catch(() => ({ ok: false, status: 0, data: null }));

			if (!result.ok) {
				// Roll back optimistic change
				following = prev;
			}
			busy = false;
			updateButton();
		});
	}

	const editButton = container.querySelector('.user-profile-edit');
	if (editButton && overlay) {
		editButton.addEventListener('click', () => setModalOpen(overlay, true));
	}

	const closeButton = container.querySelector('[data-profile-edit-close]');
	const cancelButton = container.querySelector('[data-profile-edit-cancel]');
	const saveButton = container.querySelector('[data-profile-edit-save]');
	const form = container.querySelector('[data-profile-edit-form]');
	const errorBox = container.querySelector('[data-profile-edit-error]');

	// Image upload UX (avatar/cover): button -> file picker, preview -> remove X
	const objectUrls = { avatar: null, cover: null };
	function revoke(kind) {
		const current = objectUrls[kind];
		if (current) {
			try { URL.revokeObjectURL(current); } catch { /* ignore */ }
			objectUrls[kind] = null;
		}
	}

	function setUploadState(kind, { showPreview, src, removed }) {
		const preview = container.querySelector(`[data-upload-preview="${kind}"]`);
		const img = container.querySelector(`[data-upload-img="${kind}"]`);
		const trigger = container.querySelector(`[data-upload-trigger="${kind}"]`);
		const removeField = container.querySelector(`[data-upload-remove="${kind}"]`);
		if (removeField) removeField.value = removed ? '1' : '';

		if (img && typeof src === 'string') {
			img.src = src;
		}
		if (preview) {
			preview.hidden = !showPreview;
		}
		if (trigger) {
			trigger.hidden = showPreview;
		}
	}

	function hydrateExisting(kind) {
		const existing = container.querySelector(`[data-upload-existing="${kind}"]`);
		const url = existing?.getAttribute('data-url') || '';
		if (url) {
			setUploadState(kind, { showPreview: true, src: url, removed: false });
		}
	}

	function setupUpload(kind) {
		const input = container.querySelector(`[data-upload-input="${kind}"]`);
		const trigger = container.querySelector(`[data-upload-trigger="${kind}"]`);
		const clear = container.querySelector(`[data-upload-clear="${kind}"]`);

		if (trigger && input) {
			trigger.addEventListener('click', () => input.click());
		}

		if (input) {
			input.addEventListener('change', () => {
				const file = input.files && input.files[0] ? input.files[0] : null;
				revoke(kind);
				if (!file) {
					// If no file selected, keep existing preview (if any) and don't mark removed.
					hydrateExisting(kind);
					return;
				}
				const url = URL.createObjectURL(file);
				objectUrls[kind] = url;
				setUploadState(kind, { showPreview: true, src: url, removed: false });
			});
		}

		if (clear && input) {
			clear.addEventListener('click', () => {
				revoke(kind);
				// Clear selected file
				try { input.value = ''; } catch { /* ignore */ }
				// Mark removal; hide preview and show button again
				setUploadState(kind, { showPreview: false, src: '', removed: true });
			});
		}

		hydrateExisting(kind);
	}

	setupUpload('avatar');
	setupUpload('cover');

	function closeModal() {
		setModalOpen(overlay, false);
	}

	if (overlay) {
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeModal();
		});
	}

	[closeButton, cancelButton].forEach((btn) => {
		if (!btn) return;
		btn.addEventListener('click', closeModal);
	});

	async function saveProfile() {
		if (!form) return;
		if (errorBox) {
			errorBox.style.display = 'none';
			errorBox.textContent = '';
		}

		const fd = new FormData(form);
		const result = await fetchJsonWithStatusDeduped('/api/profile', {
			method: 'POST',
			credentials: 'include',
			body: fd,
		}, { windowMs: 0 }).catch(() => ({ ok: false, status: 0, data: null }));

		if (!result.ok) {
			const message = result.data?.error || 'Failed to save profile.';
			if (errorBox) {
				errorBox.style.display = 'block';
				errorBox.textContent = message;
			}
			return;
		}

		closeModal();
		// Reload page to reflect new hero/avatar quickly (simple + robust)
		window.location.reload();
	}

	if (saveButton) {
		saveButton.addEventListener('click', () => { void saveProfile(); });
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void init();
});

