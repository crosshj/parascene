/**
 * Feed card DOM builders shared by `app-route-feed` and chat `#feed` pseudo-channel.
 */
import { buildBlogPostPublicPath, BLOG_CAMPAIGN_INTERNAL } from './blogCampaignPath.js';
import { formatDateTime, formatRelativeTime } from './datetime.js';
import { initLikeButton } from './likes.js';
import { getAvatarColor } from './avatar.js';
import { buildProfilePath } from './profileLinks.js';
import { getHelpHref } from './helpUrl.js';
import { publishedBadgeHtml } from './creationBadges.js';

const html = String.raw;

export function getHiddenFeedItems() {
	try {
		const stored = localStorage.getItem('hiddenFeedItems');
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

export function addHiddenFeedItem(itemId) {
	try {
		const hidden = getHiddenFeedItems();
		if (!hidden.includes(itemId)) {
			hidden.push(itemId);
			localStorage.setItem('hiddenFeedItems', JSON.stringify(hidden));
		}
	} catch {
		// Ignore localStorage errors
	}
}

export function feedItemToUser(item) {
	return {
		user_id: item?.user_id,
		user_name: item?.author_user_name ?? item?.user_name,
		display_name: item?.author_display_name ?? item?.display_name,
		avatar_url: item?.author_avatar_url ?? item?.avatar_url
	};
}

/**
 * @param {boolean} [preferThumbnail] — When true, prefer CDN `thumbnail_url` (Explore / Creations browse grids). When false, full `image_url` first (home feed, chat #feed).
 */
export function feedItemCardImageUrl(item, preferThumbnail = false) {
	if (!item) return '';
	if (preferThumbnail) {
		return item.thumbnail_url || item.image_url || '';
	}
	return item.image_url || item.thumbnail_url || '';
}

/**
 * Distinct URLs to try for a feed image (full resolution vs thumbnail variant).
 * Browsers only fire img error once per final URL; trying the alternate often fixes CDN/transform edge cases.
 */
export function feedItemCardImageUrlCandidates(item, preferThumbnail = false) {
	if (!item) return [];
	const full = typeof item.image_url === 'string' ? item.image_url.trim() : '';
	const thumb = typeof item.thumbnail_url === 'string' ? item.thumbnail_url.trim() : '';
	const ordered = preferThumbnail ? [thumb, full] : [full, thumb];
	const out = [];
	const seen = new Set();
	for (const u of ordered) {
		if (!u || seen.has(u)) continue;
		seen.add(u);
		out.push(u);
	}
	return out;
}

/**
 * Show the same unavailable treatment as a failed <img> (chat browse + main feed).
 * @param {HTMLElement|null} imageContainer - .feed-card-image
 * @param {HTMLImageElement|null} imageEl
 * @param {{ state?: string, label?: string }} [attrs]
 */
export function markFeedCardImageUnavailable(imageContainer, imageEl, attrs = {}) {
	if (!imageContainer) return;
	const state = typeof attrs.state === 'string' && attrs.state.trim() ? attrs.state.trim() : 'unavailable';
	const label =
		typeof attrs.label === 'string' && attrs.label.trim()
			? attrs.label.trim()
			: state === 'missing'
				? 'No preview available'
				: 'Image could not be loaded';
	imageContainer.classList.remove('loading', 'loaded');
	imageContainer.classList.add('error');
	imageContainer.setAttribute('data-feed-img-state', state);
	imageContainer.setAttribute('role', 'img');
	imageContainer.setAttribute('aria-label', label);
	if (imageEl instanceof HTMLImageElement) {
		imageEl.style.opacity = '0';
		imageEl.removeAttribute('src');
		imageEl.removeAttribute('data-feed-image-url');
	}
}

/**
 * @param {HTMLImageElement|null} imageEl
 * @param {HTMLElement|null} imageContainer - .feed-card-image
 * @param {object} item - feed row
 * @param {number} itemIndex
 * @param {boolean} preferThumbnail
 */
export function attachFeedCardImage(imageEl, imageContainer, item, itemIndex, preferThumbnail = false) {
	const urls = feedItemCardImageUrlCandidates(item, preferThumbnail);
	if (!imageEl || !imageContainer) return;
	if (urls.length === 0) {
		markFeedCardImageUnavailable(imageContainer, imageEl, { state: 'missing' });
		return;
	}

	const isHighPriority = typeof itemIndex === 'number' && itemIndex >= 0 && itemIndex < 2;
	imageEl.loading = isHighPriority ? 'eager' : 'lazy';
	if ('fetchPriority' in imageEl) {
		imageEl.fetchPriority = isHighPriority ? 'high' : 'auto';
	}

	const tryLoad = (idx) => {
		const url = urls[idx];
		if (!url) {
			markFeedCardImageUnavailable(imageContainer, imageEl, { state: 'unavailable' });
			return;
		}

		const finishOk = () => {
			imageContainer.classList.remove('loading');
			imageContainer.classList.add('loaded');
			imageContainer.classList.remove('error');
			imageContainer.removeAttribute('data-feed-img-state');
			imageContainer.removeAttribute('aria-label');
			imageContainer.removeAttribute('role');
			if (imageEl instanceof HTMLImageElement) {
				imageEl.style.removeProperty('opacity');
			}
		};

		const failOrChain = () => {
			if (idx < urls.length - 1) {
				imageEl.removeAttribute('src');
				queueMicrotask(() => tryLoad(idx + 1));
			} else {
				markFeedCardImageUnavailable(imageContainer, imageEl, { state: 'unavailable' });
			}
		};

		imageEl.dataset.feedImageUrl = url;
		imageEl.onload = () => {
			finishOk();
		};
		imageEl.onerror = () => {
			failOrChain();
		};

		imageContainer.classList.add('loading');
		imageContainer.classList.remove('loaded', 'error');
		imageContainer.removeAttribute('data-feed-img-state');

		imageEl.src = url;

		if (imageEl.complete && imageEl.naturalHeight !== 0) {
			finishOk();
		}
	};

	tryLoad(0);
}

function buildFeedTipCard(item) {
	const card = document.createElement("div");
	card.className = "feed-card feed-card-tip";
	const title = item.title || "Tip";
	const message = item.message || "";
	const cta = item.cta || "Explore";
	const rawCta = (item.ctaRoute || "/explore").trim();
	const ctaRoute = rawCta.startsWith("/help") ? getHelpHref(rawCta) : rawCta;
	const isExternal = ctaRoute.startsWith("http://") || ctaRoute.startsWith("https://");
	const openInNewTab = isExternal && (item.ctaTarget === "_blank" || item.ctaRoute?.startsWith("http"));
	const targetAttr = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : "";
	card.innerHTML = html`
		<div class="feed-card-tip-inner">
			<div class="feed-card-tip-title">${title}</div>
			<div class="feed-card-tip-message">${message}</div>
			<a class="route-empty-button feed-card-tip-cta" href="${ctaRoute}"${targetAttr} data-tip-cta>${cta}</a>
		</div>
	`;
	const ctaEl = card.querySelector("[data-tip-cta]");
	if (ctaEl) {
		ctaEl.addEventListener("click", (e) => {
			e.preventDefault();
			if (isExternal && ctaEl.getAttribute("target") === "_blank") {
				window.open(ctaRoute, "_blank", "noopener,noreferrer");
			} else {
				window.location.href = ctaRoute;
			}
		});
	}

	const tipInner = card.querySelector(".feed-card-tip-inner");
	if (tipInner && typeof IntersectionObserver !== "undefined") {
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting) {
					card.classList.add("feed-card-tip-in-view");
					observer.disconnect();
				}
			},
			{ threshold: 0.25, rootMargin: "0px 0px -40px 0px" }
		);
		observer.observe(tipInner);
	}

	return card;
}

function buildFeedBlogPostCard(item) {
	const card = document.createElement("div");
	card.className = "feed-card feed-card-blog";
	const slug = typeof item.slug === "string" ? item.slug.trim() : "";
	const href = slug ? buildBlogPostPublicPath(slug, BLOG_CAMPAIGN_INTERNAL) : "/blog";
	const rawTitle = item.title || "Blog post";
	const safeTitle = String(rawTitle)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const plainSummary = String(item.summary || "")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const truncated =
		plainSummary.length > 220 ? `${plainSummary.slice(0, 217).trim()}…` : plainSummary;
	const safeSummary = truncated
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const authorUserName = typeof item.author_user_name === "string" ? item.author_user_name.trim() : "";
	const emailPrefix =
		typeof item.author === "string" && item.author.includes("@")
			? item.author.split("@")[0]
			: "";
	const handleForLabel = authorUserName ? `@${authorUserName}` : emailPrefix ? `@${emailPrefix}` : "";
	const initialSource = authorUserName || emailPrefix || "user";
	const avatarUrl = typeof item.author_avatar_url === "string" ? item.author_avatar_url.trim() : "";
	const avatarInitial = initialSource.replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
	const authorUserId = item.user_id != null ? Number(item.user_id) : null;
	const colorSeed = authorUserName || emailPrefix || String(authorUserId || "") || "blog";
	const avatarColor = getAvatarColor(colorSeed);
	const relativeTime = formatRelativeTime(item.created_at) || "recently";
	const profileHref = buildProfilePath({ userName: authorUserName, userId: authorUserId });
	const isFounder = item.author_plan === "founder";
	const avatarContent = avatarUrl ? html`<img src="${avatarUrl}" alt="">` : avatarInitial;
	const avatarBlock = isFounder
		? html`
          <div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
            <div class="founder-flair-avatar-ring">
              <div class="founder-flair-avatar-inner" style="background: ${avatarUrl ? 'var(--surface-strong)' : avatarColor};" aria-hidden="true">
                ${avatarContent}
              </div>
            </div>
          </div>
        `
		: html`
          <div class="feed-card-avatar feed-card-blog-avatar-chip" style="--feed-card-avatar-bg: ${avatarColor};" aria-hidden="true">
            ${avatarUrl ? html`<img class="feed-card-avatar-img" src="${avatarUrl}" alt="">` : avatarInitial}
          </div>
        `;
	const safeHandleForHtml = handleForLabel
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const handleLinkInner =
		isFounder && handleForLabel
			? html`<span class="founder-name">${safeHandleForHtml}</span>`
			: safeHandleForHtml;
	const metaLine =
		handleForLabel && profileHref
			? html`<a class="feed-card-blog-meta-link" href="${profileHref}" data-profile-link>${handleLinkInner}</a><span class="feed-card-blog-meta-sep" aria-hidden="true"> · </span><span>${relativeTime}</span>`
			: handleForLabel
				? html`<span>${handleLinkInner}</span><span class="feed-card-blog-meta-sep" aria-hidden="true"> · </span><span>${relativeTime}</span>`
				: html`<span>${relativeTime}</span>`;
	card.innerHTML = html`
		<div class="feed-card-blog-inner">
			<div class="feed-card-blog-kicker">Blog</div>
			<a href="${href}" class="feed-card-blog-card-title">${safeTitle}</a>
			${safeSummary ? html`<div class="feed-card-blog-message">${safeSummary}</div>` : ""}
			<div class="feed-card-blog-meta-row">
				${profileHref ? html`<a class="feed-card-blog-avatar-slot user-link user-avatar-link" href="${profileHref}" data-profile-link aria-label="View profile">${avatarBlock}</a>` : html`<span class="feed-card-blog-avatar-slot">${avatarBlock}</span>`}
				<div class="feed-card-blog-meta-text" title="${formatDateTime(item.created_at)}">${metaLine}</div>
			</div>
			<a class="route-empty-button feed-card-blog-cta" href="${href}">Read post</a>
		</div>
	`;
	const blogInner = card.querySelector(".feed-card-blog-inner");
	if (blogInner && typeof IntersectionObserver !== "undefined") {
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting) {
					card.classList.add("feed-card-blog-in-view");
					observer.disconnect();
				}
			},
			{ threshold: 0.25, rootMargin: "0px 0px -40px 0px" }
		);
		observer.observe(blogInner);
	}
	return card;
}

function buildFeedCreationCard(item, itemIndex, setupFeedVideo, hideFeedCardMetadata = false, preferThumbnail = false) {
	const card = document.createElement("div");
	const mediaType = typeof item.media_type === "string" ? item.media_type : "image";
	const isVideo = mediaType === "video" && typeof item.video_url === "string" && item.video_url;

	if (item.created_image_id) {
		card.setAttribute('data-creation-id', String(item.created_image_id));
	}

	if (hideFeedCardMetadata) {
		card.className = "feed-card feed-card--image-only";
		const isPublished = item.published === true || item.published === 1;
		const publishedOverlay = isPublished ? publishedBadgeHtml() : '';
		card.innerHTML = html`
      <div class="feed-card-image${item.nsfw ? ' nsfw' : ''}${isVideo ? ' feed-card-image-video' : ''}">
        <img class="feed-card-img" alt="${item.title || 'Creation'}" loading="lazy" decoding="async">
        ${publishedOverlay}
        ${isVideo ? html`<video class="feed-card-video" playsinline muted></video>` : ''}
      </div>
    `;
		finishFeedCreationCardMediaAndClick(card, item, itemIndex, setupFeedVideo, isVideo, preferThumbnail);
		return card;
	}

	card.className = "feed-card";

	const author = item.author || "Anonymous";
	const authorUserName = typeof item.author_user_name === "string" ? item.author_user_name.trim() : "";
	const authorDisplayName = typeof item.author_display_name === "string" ? item.author_display_name.trim() : "";
	const emailPrefix = typeof item.author === "string" && item.author.includes("@")
		? item.author.split("@")[0]
		: author;
	const handle = (authorUserName || emailPrefix || author)
		.toLowerCase()
		.slice(0, 48) || "user";
	const displayName = authorDisplayName || authorUserName || emailPrefix || author;
	const avatarUrl = typeof item.author_avatar_url === "string" ? item.author_avatar_url.trim() : "";
	const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "?";
	const authorUserId = item.user_id != null ? Number(item.user_id) : null;
	const colorSeed = authorUserName || emailPrefix || String(authorUserId || '') || displayName;
	const avatarColor = getAvatarColor(colorSeed);
	const relativeTime = formatRelativeTime(item.created_at) || "recently";
	const title = item.title || "";
	const profileHref = buildProfilePath({ userName: authorUserName, userId: authorUserId });
	const isFounder = item.author_plan === "founder";
	const avatarContent = avatarUrl ? html`<img src="${avatarUrl}" alt="">` : avatarInitial;
	const avatarBlock = isFounder
		? html`
          <div class="avatar-with-founder-flair avatar-with-founder-flair--md">
            <div class="founder-flair-avatar-ring">
              <div class="founder-flair-avatar-inner" style="background: ${avatarUrl ? 'var(--surface-strong)' : avatarColor};" aria-hidden="true">
                ${avatarContent}
              </div>
            </div>
          </div>
        `
		: html`
          <div class="feed-card-avatar" style="--feed-card-avatar-bg: ${avatarColor};" aria-hidden="true">
            ${avatarUrl ? html`<img class="feed-card-avatar-img" src="${avatarUrl}" alt="">` : avatarInitial}
          </div>
        `;

	card.innerHTML = html`
      <div class="feed-card-image${item.nsfw ? ' nsfw' : ''}${isVideo ? ' feed-card-image-video' : ''}">
        <img class="feed-card-img" alt="${item.title || 'Feed image'}" loading="lazy" decoding="async">
        ${isVideo ? html`<video class="feed-card-video" playsinline muted></video>` : ''}
      </div>
      <div class="feed-card-footer-grid">
        ${profileHref ? html`
          <a class="user-link user-avatar-link" href="${profileHref}" data-profile-link aria-label="View ${author} profile">
            ${avatarBlock}
          </a>
        ` : html`
          <div>
            ${avatarBlock}
          </div>
        `}
        <div class="feed-card-content">
          <div class="feed-card-title">${title}</div>
          <div class="feed-card-metadata" title="${formatDateTime(item.created_at)}">
            ${profileHref
			? html`<a class="user-link" href="${profileHref}" data-profile-link>${isFounder ? html`<span class="founder-name">${displayName}</span> <span class="founder-name">@${handle}</span>` : html`${displayName} @${handle}`}</a>`
			: html`${isFounder ? html`<span class="founder-name">${displayName}</span> <span class="founder-name">@${handle}</span>` : html`${displayName} @${handle}`}`} • ${relativeTime}
          </div>
        </div>
      </div>
      <div class="feed-card-actions">
        <div class="feed-card-actions-left">
          ${item.created_image_id ? html`
            <button class="feed-card-action" type="button" data-details-button aria-label="Details">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 8v8"></path>
                <path d="M12 6h.01"></path>
              </svg>
              <span>Details</span>
            </button>
          ` : ``}
          ${profileHref ? html`
            <button class="feed-card-action" type="button" data-creator-button aria-label="Creator">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Creator</span>
            </button>
          ` : ``}
        </div>
        <div class="feed-card-actions-right">
          <button class="feed-card-action" type="button" aria-label="Comment" data-comment-button>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 5V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
            </svg>
            <span class="feed-card-action-count">${item.comment_count ?? 0}</span>
          </button>
          <button class="feed-card-action" type="button" aria-label="Like" data-like-button>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
            </svg>
            <span class="feed-card-action-count" data-like-count>${item.like_count ?? 0}</span>
          </button>
          <button class="feed-card-action feed-card-action-more" type="button" aria-label="More" data-more-button data-item-id="${item.created_image_id || item.id}">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.6"></circle>
              <circle cx="12" cy="12" r="1.6"></circle>
              <circle cx="12" cy="19" r="1.6"></circle>
            </svg>
          </button>
          <div class="feed-card-menu" data-feed-menu style="display: none;">
            <button class="feed-card-menu-item" type="button" data-hide-item>Hide from my feed</button>
          </div>
        </div>
      </div>
    `;

	const likeButton = card.querySelector('button[data-like-button]');
	if (likeButton) {
		initLikeButton(likeButton, item);
	}

	const commentButton = card.querySelector('button[data-comment-button]');
	if (commentButton && item.created_image_id) {
		commentButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			window.location.href = `/creations/${item.created_image_id}#comments`;
		});
	}

	const detailsButton = card.querySelector('button[data-details-button]');
	if (detailsButton && item.created_image_id) {
		detailsButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			window.location.href = `/creations/${item.created_image_id}`;
		});
	}

	const creatorButton = card.querySelector('button[data-creator-button]');
	if (creatorButton && profileHref) {
		creatorButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			window.location.href = profileHref;
		});
	}

	// Setup more menu button
	const moreButton = card.querySelector('button[data-more-button]');
	const menu = card.querySelector('[data-feed-menu]');
	const hideButton = card.querySelector('button[data-hide-item]');
	const itemId = item.created_image_id || item.id;

	if (moreButton && menu && hideButton && itemId) {
		// Close any open menus when clicking outside
		const closeMenu = (e) => {
			if (!menu.contains(e.target) && !moreButton.contains(e.target)) {
				menu.style.display = 'none';
				document.removeEventListener('click', closeMenu);
			}
		};

		moreButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Close other open menus first
			document.querySelectorAll('[data-feed-menu]').forEach(m => {
				if (m !== menu) m.style.display = 'none';
			});

			// Toggle this menu
			const isVisible = menu.style.display !== 'none';
			menu.style.display = isVisible ? 'none' : 'block';

			if (!isVisible) {
				// Position menu above the button
				const buttonRect = moreButton.getBoundingClientRect();
				const cardRect = card.getBoundingClientRect();
				menu.style.position = 'absolute';
				menu.style.right = `${cardRect.right - buttonRect.right}px`;
				menu.style.bottom = `${cardRect.bottom - buttonRect.top + 4}px`;
				menu.style.zIndex = '1000';

				// Add click listener to close on outside click
				setTimeout(() => {
					document.addEventListener('click', closeMenu);
				}, 0);
			} else {
				document.removeEventListener('click', closeMenu);
			}
		});

		hideButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Add to hidden items
			addHiddenFeedItem(String(itemId));

			// Hide the card
			card.style.display = 'none';

			// Close menu
			menu.style.display = 'none';
			document.removeEventListener('click', closeMenu);
		});
	}

	finishFeedCreationCardMediaAndClick(card, item, itemIndex, setupFeedVideo, isVideo, preferThumbnail);
	return card;
}

/**
 * @param {boolean} isVideo
 * @param {boolean} preferThumbnail
 */
function finishFeedCreationCardMediaAndClick(card, item, itemIndex, setupFeedVideo, isVideo, preferThumbnail = false) {
	const imageEl = card.querySelector('.feed-card-img');
	const imageContainer = card.querySelector('.feed-card-image');
	const displayUrl = feedItemCardImageUrl(item, preferThumbnail);
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';

	if (imageEl && imageContainer) {
		const canShowVideo = isVideo && Boolean(videoUrl);
		if (!displayUrl && !canShowVideo) {
			markFeedCardImageUnavailable(imageContainer, imageEl, { state: 'missing' });
		} else if (displayUrl) {
			attachFeedCardImage(imageEl, imageContainer, item, itemIndex, preferThumbnail);
		}
	}

	// Auto-play looping preview for video feed items when in view.
	if (isVideo) {
		const videoEl = card.querySelector('.feed-card-video');
		if (videoEl) {
			const posterUrl = displayUrl || "";
			if (posterUrl) {
				videoEl.poster = posterUrl;
			}
			videoEl.muted = true;
			videoEl.playsInline = true;
			videoEl.loop = true;
			videoEl.setAttribute('playsinline', '');
			videoEl.setAttribute('muted', '');
			videoEl.setAttribute('loop', '');
			videoEl.dataset.feedVideoSrc = item.video_url;
				if (typeof setupFeedVideo === "function") setupFeedVideo(videoEl);
		}
	}

	if (item.created_image_id) {
		// Make the entire card clickable except the actions row (including when preview URL is missing)
		card.style.cursor = 'pointer';

		// Add click handler to the card
		card.addEventListener('click', (e) => {
			// Allow profile links to navigate without triggering card click
			const profileLink = e.target?.closest?.('[data-profile-link]');
			if (profileLink) return;

			// Don't navigate if clicking on actions row or its children
			const actionsRow = card.querySelector('.feed-card-actions');
			if (actionsRow && actionsRow.contains(e.target)) {
				return;
			}
			window.location.href = `/creations/${item.created_image_id}`;
		});

		// Prevent actions row from triggering card click
		const actionsRow = card.querySelector('.feed-card-actions');
		if (actionsRow) {
			actionsRow.style.cursor = 'default';
			actionsRow.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		}
	}
}

/**
 * @param {object} item
 * @param {number} itemIndex
 * @param {{
 *   setupFeedVideo?: (videoEl: HTMLVideoElement) => void,
 *   hideFeedCardMetadata?: boolean,
 *   preferThumbnail?: boolean,
 * }} [options]
 */
export function createFeedItemCard(item, itemIndex, options = {}) {
	const setupFeedVideo = options.setupFeedVideo;
	const hideFeedCardMetadata = options.hideFeedCardMetadata === true;
	const preferThumbnail = options.preferThumbnail === true;
	if (item.type === "tip") {
		return buildFeedTipCard(item);
	}
	if (item.type === "blog_post") {
		return buildFeedBlogPostCard(item);
	}
	return buildFeedCreationCard(item, itemIndex, setupFeedVideo, hideFeedCardMetadata, preferThumbnail);
}
