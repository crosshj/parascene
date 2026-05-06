/**
 * Feed card DOM builders shared by `app-route-feed` and chat `#feed` pseudo-channel.
 *
 * This file is always loaded via `import(\`.../feedCardBuild.js${qs}\`)` from the feed route, but
 * static `import './sibling.js'` would still fetch siblings **without** `?v=` and can serve stale
 * chunks (missing exports). All direct siblings are loaded below with the same asset-version query.
 */
const _qs = (() => {
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

const [
	blogCampaignPathMod,
	datetimeMod,
	likesMod,
	avatarMod,
	profileLinksMod,
	helpUrlMod,
	challengeSubmitMetaMod,
	creationBadgesMod,
] = await Promise.all([
	import(`./blogCampaignPath.js${_qs}`),
	import(`./datetime.js${_qs}`),
	import(`./likes.js${_qs}`),
	import(`./avatar.js${_qs}`),
	import(`./profileLinks.js${_qs}`),
	import(`./helpUrl.js${_qs}`),
	import(`./challengeSubmitMeta.js${_qs}`),
	import(`./creationBadges.js${_qs}`),
]);

const { buildBlogPostPublicPath, BLOG_CAMPAIGN_INTERNAL } = blogCampaignPathMod;
const { formatDateTime, formatRelativeTime } = datetimeMod;
const { initLikeButton } = likesMod;
const { getAvatarColor } = avatarMod;
const { buildProfilePath } = profileLinksMod;
const { getHelpHref } = helpUrlMod;
const { creationMetaHasChallengeSubmission } = challengeSubmitMetaMod;
const { challengeEnteredBadgeHtml, publishedBadgeHtml } = creationBadgesMod;

const html = String.raw;

/**
 * @param {object} item - feed row (may carry meta object or JSON string)
 * @returns {object|null}
 */
function parseFeedItemMeta(item) {
	const m = item?.meta;
	if (m && typeof m === 'object') return m;
	if (typeof m === 'string') {
		try {
			const o = JSON.parse(m);
			return o && typeof o === 'object' ? o : null;
		} catch {
			return null;
		}
	}
	return null;
}

function appendCreationIdToMediaUrl(url, creationId) {
	if (!url) return '';
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return String(url);
	const s = String(url);
	if (!s.includes('/api/images/created/') && !s.includes('/api/videos/created/')) return s;
	const [beforeHash, hash = ''] = s.split('#');
	const [pathAndQuery, existingHashRemainder] = [beforeHash, hash ? `#${hash}` : ''];
	if (/[?&]creation_id=/.test(pathAndQuery)) {
		return `${pathAndQuery}${existingHashRemainder}`;
	}
	const sep = pathAndQuery.includes('?') ? '&' : '?';
	return `${pathAndQuery}${sep}creation_id=${encodeURIComponent(String(id))}${existingHashRemainder}`;
}

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
/**
 * Creation rows still being generated (no stable preview URL yet).
 * @param {object|null|undefined} item
 */
export function isFeedCreationImageProcessing(item) {
	const raw = item?.status ?? item?.creation_status;
	if (raw == null || raw === '') return false;
	const st = String(raw).trim().toLowerCase();
	return st === 'creating' || st === 'pending';
}

/**
 * Clears Creations-style in-progress tile chrome (class + label node).
 * @param {HTMLElement|null} imageContainer - `.feed-card-image`
 */
export function teardownFeedCardCreationProcessingUi(imageContainer) {
	if (!imageContainer) return;
	imageContainer.classList.remove('feed-card-image--creation-processing');
	imageContainer.removeAttribute('aria-hidden');
	const label = imageContainer.querySelector('.feed-card-creation-processing-label');
	if (label) label.remove();
	const videoEl = imageContainer.querySelector('.feed-card-video');
	if (videoEl instanceof HTMLVideoElement) {
		videoEl.style.removeProperty('opacity');
		videoEl.style.removeProperty('visibility');
	}
}

/**
 * Same visual language as `.route-media.loading` on the Creations page (shimmer + centered “Creating…”).
 * @param {HTMLElement|null} imageContainer - `.feed-card-image`
 * @param {HTMLImageElement|null} imageEl
 */
export function applyFeedCardCreationProcessingState(imageContainer, imageEl) {
	if (!imageContainer) return;
	teardownFeedCardCreationProcessingUi(imageContainer);
	imageContainer.classList.remove('loaded', 'error', 'loading');
	imageContainer.classList.add('feed-card-image--creation-processing');
	imageContainer.removeAttribute('data-feed-img-state');
	imageContainer.removeAttribute('role');
	imageContainer.removeAttribute('aria-label');
	imageContainer.setAttribute('aria-hidden', 'true');
	if (imageEl instanceof HTMLImageElement) {
		imageEl.removeAttribute('src');
		imageEl.removeAttribute('data-feed-image-url');
		imageEl.style.opacity = '0';
	}
	const videoEl = imageContainer.querySelector('.feed-card-video');
	if (videoEl instanceof HTMLVideoElement) {
		videoEl.removeAttribute('poster');
		videoEl.removeAttribute('src');
		delete videoEl.dataset.feedVideoSrc;
		videoEl.style.opacity = '0';
		videoEl.style.visibility = 'hidden';
	}
	const label = document.createElement('span');
	label.className = 'feed-card-creation-processing-label';
	label.setAttribute('aria-hidden', 'true');
	label.textContent = 'Creating...';
	imageContainer.appendChild(label);
}

export function feedItemCardImageUrl(item, preferThumbnail = false) {
	if (!item) return '';
	const creationId = Number(item?.created_image_id ?? item?.id);
	if (preferThumbnail) {
		return appendCreationIdToMediaUrl(item.thumbnail_url || item.image_url || '', creationId);
	}
	return appendCreationIdToMediaUrl(item.image_url || item.thumbnail_url || '', creationId);
}

/**
 * Distinct URLs to try for a feed image (full resolution vs thumbnail variant).
 * Browsers only fire img error once per final URL; trying the alternate often fixes CDN/transform edge cases.
 */
export function feedItemCardImageUrlCandidates(item, preferThumbnail = false) {
	if (!item) return [];
	const creationId = Number(item?.created_image_id ?? item?.id);
	const fullRaw = typeof item.image_url === 'string' ? item.image_url.trim() : '';
	const thumbRaw = typeof item.thumbnail_url === 'string' ? item.thumbnail_url.trim() : '';
	const full = appendCreationIdToMediaUrl(fullRaw, creationId);
	const thumb = appendCreationIdToMediaUrl(thumbRaw, creationId);
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

export function getFeedItemGroupCarouselSources(item) {
	const creationId = Number(item?.created_image_id ?? item?.id);
	const parsedMeta = parseFeedItemMeta(item);
	const groupPayload =
		parsedMeta?.group && typeof parsedMeta.group === 'object' ? parsedMeta.group : null;
	if (groupPayload?.kind !== 'group_creations') return [];
	const sourcesRaw = Array.isArray(groupPayload?.source_creations) ? groupPayload.source_creations : [];
	const seen = new Set();
	const out = [];
	for (const source of sourcesRaw) {
		const filePath = typeof source?.file_path === 'string' ? source.file_path.trim() : '';
		const url = appendCreationIdToMediaUrl(filePath, creationId);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		const sourceTitle = typeof source?.title === 'string' ? source.title.trim() : '';
		out.push({
			url,
			title: sourceTitle || item?.title || 'Grouped creation image'
		});
	}
	return out;
}

export function setupFeedCardGroupCarousel(imageContainer, item) {
	if (!(imageContainer instanceof HTMLElement)) return false;
	if (imageContainer.querySelector('[data-feed-card-group-carousel]')) return true;
	const sources = getFeedItemGroupCarouselSources(item);
	if (sources.length <= 1) return false;

	const stack = document.createElement('div');
	stack.className = 'feed-card-group-stack';
	stack.setAttribute('data-feed-card-group-carousel', '');

	for (let i = 0; i < sources.length; i += 1) {
		const source = sources[i];
		const img = document.createElement('img');
		img.className = `feed-card-group-img${i === 0 ? ' is-active' : ''}`;
		img.src = source.url;
		img.alt = source.title;
		img.loading = i === 0 ? 'eager' : 'lazy';
		img.decoding = 'async';
		img.dataset.groupSlideIndex = String(i);
		stack.appendChild(img);
	}

	const makeNavButton = (direction) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `feed-card-group-nav feed-card-group-nav--${direction}`;
		btn.setAttribute('aria-label', direction === 'prev' ? 'Previous grouped image' : 'Next grouped image');
		btn.innerHTML = direction === 'prev'
			? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 6.5L9 12l5.5 5.5" /></svg>'
			: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6.5L15 12l-5.5 5.5" /></svg>';
		return btn;
	};
	const prevBtn = makeNavButton('prev');
	const nextBtn = makeNavButton('next');
	const groupImages = Array.from(stack.querySelectorAll('.feed-card-group-img'));
	const setActiveIndex = (index) => {
		if (groupImages.length === 0) return;
		const next = ((index % groupImages.length) + groupImages.length) % groupImages.length;
		for (let i = 0; i < groupImages.length; i += 1) {
			groupImages[i].classList.toggle('is-active', i === next);
		}
	};
	const getActiveIndex = () => {
		const idx = groupImages.findIndex((img) => img.classList.contains('is-active'));
		return idx >= 0 ? idx : 0;
	};
	prevBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		setActiveIndex(getActiveIndex() - 1);
	});
	nextBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		setActiveIndex(getActiveIndex() + 1);
	});

	imageContainer.classList.add('feed-card-image--group-carousel');
	imageContainer.classList.remove('loading', 'error');
	imageContainer.classList.add('loaded');
	imageContainer.removeAttribute('data-feed-img-state');
	imageContainer.removeAttribute('role');
	imageContainer.removeAttribute('aria-label');
	imageContainer.appendChild(stack);
	imageContainer.appendChild(prevBtn);
	imageContainer.appendChild(nextBtn);

	const cardEl = imageContainer.closest('.feed-card');
	if (cardEl instanceof HTMLElement) {
		try {
			cardEl.dataset.feedGroupCarouselUrls = JSON.stringify(sources.map((s) => s.url));
		} catch {
			delete cardEl.dataset.feedGroupCarouselUrls;
		}
	}
	return true;
}

/**
 * Show the same unavailable treatment as a failed <img> (chat browse + main feed).
 * @param {HTMLElement|null} imageContainer - .feed-card-image
 * @param {HTMLImageElement|null} imageEl
 * @param {{ state?: string, label?: string }} [attrs]
 */
export function markFeedCardImageUnavailable(imageContainer, imageEl, attrs = {}) {
	if (!imageContainer) return;
	teardownFeedCardCreationProcessingUi(imageContainer);
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
	if (isFeedCreationImageProcessing(item)) {
		applyFeedCardCreationProcessingState(imageContainer, imageEl);
		return;
	}
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
			teardownFeedCardCreationProcessingUi(imageContainer);
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

		teardownFeedCardCreationProcessingUi(imageContainer);
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

/**
 * @param {HTMLElement} imageWrap - `.feed-card-image`
 */
function appendCreationsBulkOverlayToFeedCardImage(imageWrap) {
	if (!(imageWrap instanceof HTMLElement) || imageWrap.querySelector('[data-creations-bulk-overlay]')) return;
	const overlay = document.createElement('div');
	overlay.className = 'creations-card-bulk-overlay';
	overlay.setAttribute('data-creations-bulk-overlay', '');
	overlay.setAttribute('aria-hidden', 'true');
	const cb = document.createElement('input');
	cb.type = 'checkbox';
	cb.className = 'creations-card-bulk-checkbox';
	cb.setAttribute('data-creations-bulk-checkbox', '');
	cb.setAttribute('aria-label', 'Select creation');
	overlay.appendChild(cb);
	imageWrap.appendChild(overlay);
}

/**
 * @param {HTMLElement} card
 * @param {object} item
 * @param {boolean} preferThumbnail
 */
function stampChatCreationsBulkDatasetOnFeedCard(card, item, preferThumbnail) {
	const rawId = item?.created_image_id ?? item?.id;
	const idNum = rawId != null ? Number(rawId) : NaN;
	if (!(card instanceof HTMLElement) || !Number.isFinite(idNum) || idNum <= 0) return;
	card.dataset.imageId = String(idNum);
	const isPublished = item.published === true || item.published === 1;
	card.dataset.published = isPublished ? '1' : '0';
	const statusRaw = item?.status;
	const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : '';
	card.dataset.creationStatus = status;
	const mediaTypeRaw = item?.media_type;
	const mediaType = typeof mediaTypeRaw === 'string' ? mediaTypeRaw.trim().toLowerCase() : 'image';
	card.dataset.mediaType = mediaType || 'image';
	const parsedMeta = parseFeedItemMeta(item);
	const isGroupCreation = parsedMeta?.group?.kind === 'group_creations';
	card.dataset.groupCreation = isGroupCreation ? '1' : '0';
	const imageUrlRaw = feedItemCardImageUrl(item, preferThumbnail);
	card.dataset.imageUrl = typeof imageUrlRaw === 'string' ? imageUrlRaw.trim() : '';
}

function buildFeedCreationCard(
	item,
	itemIndex,
	setupFeedVideo,
	hideFeedCardMetadata = false,
	preferThumbnail = false,
	creationsBulkChrome = false
) {
	const card = document.createElement("div");
	const mediaType = typeof item.media_type === "string" ? item.media_type : "image";
	const isVideo = mediaType === "video" && typeof item.video_url === "string" && item.video_url;

	const parsedMeta = parseFeedItemMeta(item);
	const challengeThumbnailBlur =
		creationMetaHasChallengeSubmission(parsedMeta) && !item.nsfw;
	const challengeBlurClass = challengeThumbnailBlur ? ' feed-card-image--challenge-pending' : '';
	const challengeBlurOverlay = challengeThumbnailBlur
		? html`<span class="route-media-challenge-blur-overlay" aria-hidden="true"></span>${challengeEnteredBadgeHtml()}`
		: '';

	if (item.created_image_id) {
		card.setAttribute('data-creation-id', String(item.created_image_id));
		const stRaw = item?.status;
		const st =
			stRaw == null || stRaw === ''
				? ''
				: typeof stRaw === 'string'
					? stRaw.trim().toLowerCase()
					: String(stRaw).trim().toLowerCase();
		if (st === 'creating' || st === 'pending') {
			card.setAttribute('data-creation-status', st);
		} else {
			card.removeAttribute('data-creation-status');
		}
	}

	if (hideFeedCardMetadata) {
		card.className = "feed-card feed-card--image-only";
		const isPublished = item.published === true || item.published === 1;
		const publishedOverlay = isPublished ? publishedBadgeHtml() : '';
		const isGroupCreation = parsedMeta?.group?.kind === 'group_creations';
		const groupOverlay = isGroupCreation
			? html`<span class="creation-group-badge" aria-label="Group creation" title="Group creation">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
					stroke-linejoin="round" aria-hidden="true">
					<rect x="3.5" y="6.5" width="9.5" height="9.5" rx="2"></rect>
					<rect x="10.5" y="10.5" width="10" height="10" rx="2"></rect>
				</svg>
			</span>`
			: '';
		const bulkOverlayBlock =
			creationsBulkChrome
				? html`
			<div class="creations-card-bulk-overlay" data-creations-bulk-overlay aria-hidden="true">
				<input type="checkbox" class="creations-card-bulk-checkbox" data-creations-bulk-checkbox aria-label="Select creation" />
			</div>`
				: '';
		card.innerHTML = html`
      <div class="feed-card-image${item.nsfw ? ' nsfw' : ''}${isVideo ? ' feed-card-image-video' : ''}${challengeBlurClass}">
        <img class="feed-card-img" alt="${item.title || 'Creation'}" loading="lazy" decoding="async">
        ${publishedOverlay}
        ${groupOverlay}
        ${isVideo ? html`<video class="feed-card-video" playsinline muted></video>` : ''}
        ${challengeBlurOverlay}
        ${bulkOverlayBlock}
      </div>
    `;
		if (creationsBulkChrome) {
			stampChatCreationsBulkDatasetOnFeedCard(card, item, preferThumbnail);
		}
		finishFeedCreationCardMediaAndClick(card, item, itemIndex, setupFeedVideo, isVideo, preferThumbnail, creationsBulkChrome);
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
      <div class="feed-card-image${item.nsfw ? ' nsfw' : ''}${isVideo ? ' feed-card-image-video' : ''}${challengeBlurClass}">
        <img class="feed-card-img" alt="${item.title || 'Feed image'}" loading="lazy" decoding="async">
        ${isVideo ? html`<video class="feed-card-video" playsinline muted></video>` : ''}
        ${challengeBlurOverlay}
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

	if (creationsBulkChrome) {
		const imageWrap = card.querySelector('.feed-card-image');
		appendCreationsBulkOverlayToFeedCardImage(imageWrap);
		stampChatCreationsBulkDatasetOnFeedCard(card, item, preferThumbnail);
	}

	finishFeedCreationCardMediaAndClick(card, item, itemIndex, setupFeedVideo, isVideo, preferThumbnail, creationsBulkChrome);
	return card;
}

/**
 * @param {boolean} isVideo
 * @param {boolean} preferThumbnail
 * @param {boolean} creationsBulkChrome
 */
function finishFeedCreationCardMediaAndClick(
	card,
	item,
	itemIndex,
	setupFeedVideo,
	isVideo,
	preferThumbnail = false,
	creationsBulkChrome = false
) {
	const imageEl = card.querySelector('.feed-card-img');
	const imageContainer = card.querySelector('.feed-card-image');
	const displayUrl = feedItemCardImageUrl(item, preferThumbnail);
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';
	const processing = isFeedCreationImageProcessing(item);
	const moderated = item?.is_moderated_error === true;

	if (imageEl && imageContainer) {
		if (processing) {
			applyFeedCardCreationProcessingState(imageContainer, imageEl);
		} else {
			const canShowVideo = isVideo && Boolean(videoUrl);
			const hasGroupCarousel = !isVideo && setupFeedCardGroupCarousel(imageContainer, item);
			if (!displayUrl && !canShowVideo && !hasGroupCarousel) {
				markFeedCardImageUnavailable(imageContainer, imageEl, {
					state: moderated ? 'moderated' : 'missing',
					moderated
				});
			} else if (displayUrl && !hasGroupCarousel) {
				attachFeedCardImage(imageEl, imageContainer, item, itemIndex, preferThumbnail);
				if (!isVideo && !hasGroupCarousel) {
					setupFeedCardGroupCarousel(imageContainer, item);
				}
			} else if (hasGroupCarousel) {
				teardownFeedCardCreationProcessingUi(imageContainer);
				imageEl?.removeAttribute?.('src');
				imageEl?.removeAttribute?.('data-feed-image-url');
				imageEl?.style?.removeProperty?.('opacity');
				imageContainer.classList.remove('loading', 'error', 'feed-card-image-error-moderated');
				imageContainer.removeAttribute('data-feed-img-state');
				imageContainer.removeAttribute('role');
				imageContainer.removeAttribute('aria-label');
				const modIcon = imageContainer.querySelector('.route-media-error-moderated-icon');
				if (modIcon) modIcon.remove();
				imageContainer.classList.add('loaded');
			}
		}
	}

	// Auto-play looping preview for video feed items when in view.
	if (isVideo && !processing) {
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
	} else if (isVideo && processing) {
		const videoEl = card.querySelector('.feed-card-video');
		if (videoEl instanceof HTMLVideoElement) {
			videoEl.removeAttribute('poster');
			videoEl.removeAttribute('src');
			delete videoEl.dataset.feedVideoSrc;
		}
	}

	if (item.created_image_id) {
		// Make the entire card clickable except the actions row (including when preview URL is missing)
		card.style.cursor = 'pointer';

		// Add click handler to the card
		card.addEventListener('click', (e) => {
			if (creationsBulkChrome && e.target?.closest?.('[data-creations-bulk-overlay]')) {
				return;
			}
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
 *   creationsBulkChrome?: boolean,
 * }} [options]
 */
export function createFeedItemCard(item, itemIndex, options = {}) {
	const setupFeedVideo = options.setupFeedVideo;
	const hideFeedCardMetadata = options.hideFeedCardMetadata === true;
	const preferThumbnail = options.preferThumbnail === true;
	const creationsBulkChrome = options.creationsBulkChrome === true;
	if (item.type === "tip") {
		return buildFeedTipCard(item);
	}
	if (item.type === "blog_post") {
		return buildFeedBlogPostCard(item);
	}
	return buildFeedCreationCard(item, itemIndex, setupFeedVideo, hideFeedCardMetadata, preferThumbnail, creationsBulkChrome);
}
