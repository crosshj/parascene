/**
 * Logged-out user profile: hero + published creations. No edit/follow/DM/tabs.
 */

let formatDate;
let fetchJsonWithStatusDeduped;
let getAvatarColor;
let processUserText;
let hydrateUserTextLinks;
let createInfiniteScroll;
let setRouteMediaBackgroundImage;
let renderEmptyState;
let renderGridSkeleton;
let renderProfileHeroSkeleton;
let challengeLockedBadgeHtml;
let buildCreationCardShell;
let hydrateRouteCardMedia;
let routeCardGroupBadgeHtml;
let creationMetaHasChallengeAnnotation;
let PROFILE_SOCIAL_NETWORKS = [];
let validateSocialUrl;
let socialIconFns = {};

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const datetimeMod = await import(`../shared/datetime.js${qs}`);
		formatDate = datetimeMod.formatDate;

		const apiMod = await import(`../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const avatarMod = await import(`../shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;

		const userTextMod = await import(`../shared/userText.js${qs}`);
		processUserText = userTextMod.processUserText;
		hydrateUserTextLinks = userTextMod.hydrateUserTextLinks;

		const infiniteScrollMod = await import(`../shared/infinite-scroll.js${qs}`);
		createInfiniteScroll = infiniteScrollMod.createInfiniteScroll;

		const routeMediaMod = await import(`../shared/routeMedia.js${qs}`);
		setRouteMediaBackgroundImage = routeMediaMod.setRouteMediaBackgroundImage;

		const emptyStateMod = await import(`../shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;

		const skeletonMod = await import(`../shared/skeleton.js${qs}`);
		renderGridSkeleton = skeletonMod.renderGridSkeleton;
		renderProfileHeroSkeleton = skeletonMod.renderProfileHeroSkeleton;

		const creationBadgesMod = await import(`../shared/creationBadges.js${qs}`);
		challengeLockedBadgeHtml = creationBadgesMod.challengeLockedBadgeHtml;

		const creationCardMod = await import(`../shared/creationCard.js${qs}`);
		buildCreationCardShell = creationCardMod.buildCreationCardShell;

		const routeCardGroupMod = await import(`../shared/routeCardGroupMedia.js${qs}`);
		hydrateRouteCardMedia = routeCardGroupMod.hydrateRouteCardMedia;
		routeCardGroupBadgeHtml = routeCardGroupMod.routeCardGroupBadgeHtml;

		const challengeMetaMod = await import(`../shared/challengeSubmitMeta.js${qs}`);
		creationMetaHasChallengeAnnotation = challengeMetaMod.creationMetaHasChallengeAnnotation;

		const iconsMod = await import(`../icons/svg-strings.js${qs}`);
		socialIconFns = {
			website: iconsMod.globeIcon,
			spotify: iconsMod.spotifyIcon,
			instagram: iconsMod.instagramIcon,
			tiktok: iconsMod.tiktokIcon,
			soundcloud: iconsMod.soundcloudIcon,
			youtube: iconsMod.youtubeIcon,
			x: iconsMod.xIcon,
			suno: iconsMod.sunoIcon,
			nightcafe: iconsMod.nightcafeIcon
		};

		const socialsMod = await import(`../shared/profileSocials.js${qs}`);
		PROFILE_SOCIAL_NETWORKS = socialsMod.PROFILE_SOCIAL_NETWORKS;
		validateSocialUrl = socialsMod.validateSocialUrl;
	})();
	return _depsPromise;
}

const html = String.raw;
const PAGE_SIZE = 24;

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

function getServerProfileContext() {
	const ctx = window.__ps_profile_context;
	return ctx && typeof ctx === 'object' ? ctx : null;
}

function getPathUserTarget() {
	const pathname = window.location.pathname || '';
	const match = pathname.match(/^\/user\/(\d+)$/);
	if (match) {
		const id = Number.parseInt(match[1], 10);
		if (!Number.isFinite(id) || id <= 0) return { mode: 'id', userId: null, userName: null };
		return { mode: 'id', userId: id, userName: null };
	}
	const personalityMatch = pathname.match(/^\/p\/([a-z0-9][a-z0-9_-]{2,23})$/i);
	if (personalityMatch) {
		return { mode: 'username', userId: null, userName: String(personalityMatch[1] || '').toLowerCase() };
	}
	return { mode: 'id', userId: null, userName: null };
}

function buildTargetUserApiBase(target) {
	if (target?.mode === 'username' && target?.userName) {
		return `/api/users/by-username/${encodeURIComponent(target.userName)}`;
	}
	if (Number.isFinite(target?.userId) && target.userId > 0) {
		return `/api/users/${target.userId}`;
	}
	return null;
}

function guessHandle({ user, profile }) {
	const userName = profile?.user_name ? String(profile.user_name) : '';
	if (userName) return `@${userName}`;
	const id = user?.id != null ? String(user.id) : 'user';
	return `@user-${id}`;
}

function buildBannerStyle(coverImageUrl) {
	const url = typeof coverImageUrl === 'string' ? coverImageUrl.trim() : '';
	if (!url) return '';
	const safeUrl = url.replace(/'/g, "\\'");
	return `background-image: url('${safeUrl}');`;
}

function socialIconHtml(key) {
	const fn = socialIconFns[key];
	if (typeof fn !== 'function') return '';
	const kind = key === 'website' ? 'stroke' : 'fill';
	return fn(`user-profile-social-icon user-profile-social-icon--${kind}`);
}

function renderProfileSocialsHtml(socials) {
	if (typeof validateSocialUrl !== 'function') return '';
	const links = [];
	for (const network of PROFILE_SOCIAL_NETWORKS) {
		const result = validateSocialUrl(network.key, socials?.[network.key]);
		if (!result?.ok || !result.href) continue;
		links.push(html`<a class="user-profile-social-link" href="${escapeHtml(result.href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(network.label)}">${socialIconHtml(network.key)}</a>`);
	}
	if (!links.length) return '';
	return html`<div class="user-profile-socials" aria-label="Social links">${links.join('')}</div>`;
}

function renderUnavailable(container, { title, message }) {
	container.innerHTML = renderEmptyState({
		className: 'route-empty-image-grid',
		title,
		message,
		buttonText: 'Sign up',
		buttonHref: `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname || '/')}#signup`
	});
}

function setupHeaderScroll() {
	function bind(retries) {
		retries = retries || 0;
		if (retries > 30) return;
		const header = document.querySelector('header');
		if (!header) {
			requestAnimationFrame(() => bind(retries + 1));
			return;
		}
		const handleScroll = () => {
			const scrollY = window.scrollY || window.pageYOffset;
			if (scrollY > 50) header.classList.add('scrolled');
			else header.classList.remove('scrolled');
		};
		handleScroll();
		window.addEventListener('scroll', handleScroll, { passive: true });
	}
	bind(0);
}

function renderPublicProfile(container, { user, profile, stats, plan }) {
	const displayName =
		(profile?.display_name && String(profile.display_name).trim()) ||
		(profile?.user_name && String(profile.user_name).trim()) ||
		`User ${user?.id ?? ''}`;
	const handle = guessHandle({ user, profile });
	const about = typeof profile?.about === 'string' ? profile.about.trim() : '';
	const characterDescription = typeof profile?.character_description === 'string' ? profile.character_description.trim() : '';
	const socialsHtml = renderProfileSocialsHtml(profile?.socials);
	const avatarUrl = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
	const coverUrl = typeof profile?.cover_image_url === 'string' ? profile.cover_image_url.trim() : '';
	const avatarInitial = displayName.trim().charAt(0).toUpperCase() || '?';
	const avatarColor = getAvatarColor(profile?.user_name || String(user?.id || ''));
	const isFounder = plan === 'founder';
	const memberSince = stats?.member_since ? formatDate(stats.member_since) : null;
	const creationsPublished = Number(stats?.creations_published ?? 0);
	const likesReceived = Number(stats?.likes_received ?? 0);

	const avatarContent = avatarUrl
		? html`<img class="user-profile-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
		: html`<div class="user-profile-avatar-fallback" style="--user-profile-avatar-bg: ${avatarColor};" aria-hidden="true">${escapeHtml(avatarInitial)}</div>`;

	const avatarBlockHtml = isFounder
		? html`<div class="avatar-with-founder-flair avatar-with-founder-flair--xl">
				<div class="founder-flair-avatar-ring">
					<div class="founder-flair-avatar-inner">${avatarContent}</div>
				</div>
			</div>`
		: avatarContent;

	const metaBlockHtml = (about || characterDescription)
		? html`<div class="user-profile-meta">
				${about ? html`<div class="user-profile-meta-row">
					<span class="user-profile-meta-label">About</span>
					<span class="user-profile-meta-text">${processUserText(about)}</span>
				</div>` : ''}
				${characterDescription ? html`<div class="user-profile-meta-row">
					<span class="user-profile-meta-label">Character</span>
					<span class="user-profile-meta-text">${processUserText(characterDescription)}</span>
				</div>` : ''}
			</div>`
		: '';

	container.innerHTML = html`
		<div class="user-profile-hero">
			<div class="user-profile-banner" style="${buildBannerStyle(coverUrl)}"></div>
			<div class="user-profile-hero-inner">
				<div class="user-profile-avatar">${avatarBlockHtml}</div>
				<div class="user-profile-identity">
					<div class="user-profile-title-row">
						<div class="user-profile-name${isFounder ? ' founder-name' : ''}">${escapeHtml(displayName)}</div>
					</div>
					<div class="user-profile-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</div>
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
					${metaBlockHtml}
					${socialsHtml}
				</div>
			</div>
		</div>
		<div class="user-profile-content">
			<div class="route-cards content-cards-image-grid" data-profile-grid aria-busy="true" aria-label="Loading">
				${renderGridSkeleton(12)}
			</div>
			<div class="user-profile-load-more" data-profile-load-more hidden></div>
		</div>
	`;

	const titleName = displayName.trim() || handle;
	document.title = `${titleName} · parascene`;
}

function appendCreationCards(grid, items) {
	if (!grid || !Array.isArray(items) || items.length === 0) return;
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

	items.forEach((item) => {
		const isVideo = item.media_type === 'video' || (item.meta && item.meta.media_type === 'video');
		const isAudio = item.media_type === 'audio' || (item.meta && item.meta.media_type === 'audio');
		const itemMeta = item.meta && typeof item.meta === 'object' ? item.meta : null;
		const inChallenge =
			Boolean(creationMetaHasChallengeAnnotation?.(itemMeta)) ||
			(Array.isArray(itemMeta?.challenge_organizer_refs) && itemMeta.challenge_organizer_refs.length > 0) ||
			(Array.isArray(itemMeta?.challenge_submissions) && itemMeta.challenge_submissions.length > 0);
		const mediaAttrs = {};
		if (isVideo) mediaAttrs['data-media-type'] = 'video';
		if (isAudio) mediaAttrs['data-media-type'] = 'audio';
		const challengeLockedBadge =
			inChallenge && typeof challengeLockedBadgeHtml === 'function'
				? challengeLockedBadgeHtml('Locked to a challenge')
				: '';
		const wrap = document.createElement('div');
		wrap.innerHTML = buildCreationCardShell({
			mediaAttrs,
			badgesHtml: challengeLockedBadge + routeCardGroupBadgeHtml(item),
			nsfw: Boolean(item.nsfw),
			challengeGridBlur: inChallenge && !item.nsfw && !isAudio,
		});
		const card = wrap.firstElementChild;
		if (!card) return;
		card.style.cursor = 'pointer';
		card.addEventListener('click', () => {
			window.location.assign(`/creations/${item.id}`);
		});
		const mediaEl = card.querySelector('.route-media');
		if (mediaEl && typeof hydrateRouteCardMedia === 'function') {
			hydrateRouteCardMedia(mediaEl, item, {
				preferThumbnail: !isVideo,
				observer,
			});
		}
		grid.appendChild(card);
	});
}

function renderCreationsGrid(grid, images) {
	if (!grid) return;
	grid.removeAttribute('aria-busy');
	grid.removeAttribute('aria-label');
	const list = Array.isArray(images) ? images : [];
	if (list.length === 0) {
		grid.innerHTML = renderEmptyState({
			className: 'route-empty-image-grid',
			title: 'No published creations yet',
			message: "When this user publishes creations, they'll show up here."
		});
		return;
	}
	grid.innerHTML = '';
	appendCreationCards(grid, list);
}

async function loadProfileSummary(apiBase) {
	const result = await fetchJsonWithStatusDeduped(`${apiBase}/profile`, {
		credentials: 'include'
	}, { windowMs: 1000 });
	if (!result.ok) {
		const err = new Error('Failed to load profile');
		err.status = Number(result.status) || 0;
		throw err;
	}
	return result.data;
}

async function loadPublishedImages(apiBase, { limit = PAGE_SIZE, offset = 0 } = {}) {
	const params = new URLSearchParams();
	params.set('limit', String(limit));
	params.set('offset', String(offset));
	const result = await fetchJsonWithStatusDeduped(
		`${apiBase}/created-images?${params.toString()}`,
		{ credentials: 'include' },
		{ windowMs: 800 }
	);
	if (!result.ok) throw new Error('Failed to load images');
	return {
		images: Array.isArray(result.data?.images) ? result.data.images : [],
		has_more: Boolean(result.data?.has_more)
	};
}

async function init() {
	await loadDeps();
	setupHeaderScroll();

	const container = document.querySelector('main .user-profile-page');
	if (!container) return;

	container.innerHTML = html`<div class="skeleton-profile-page" aria-busy="true" aria-label="Loading">
		${renderProfileHeroSkeleton()}
		<div class="skeleton-profile-grid-wrap route-cards content-cards-image-grid">
			${renderGridSkeleton(12)}
		</div>
	</div>`;

	const serverContext = getServerProfileContext();
	if (serverContext?.resolved?.target_exists === false) {
		renderUnavailable(container, {
			title: 'Profile not found',
			message: 'This profile could not be resolved.'
		});
		return;
	}

	const info = getPathUserTarget();
	const target = { mode: info.mode, userId: info.userId, userName: info.userName };
	const apiBase = buildTargetUserApiBase(target);
	if (!apiBase) {
		renderUnavailable(container, {
			title: 'Profile not found',
			message: 'This profile could not be resolved.'
		});
		return;
	}

	let summary;
	try {
		summary = await loadProfileSummary(apiBase);
	} catch (err) {
		if (err?.status === 404 || err?.status === 400) {
			renderUnavailable(container, {
				title: 'Profile not found',
				message: 'This profile could not be resolved.'
			});
			return;
		}
		renderUnavailable(container, {
			title: 'Unable to load profile',
			message: 'An error occurred while loading this profile.'
		});
		return;
	}

	const user = summary.user || {};
	const profile = summary.profile || {};
	profile.socials = safeJsonParse(profile.socials, {});
	profile.meta = safeJsonParse(profile.meta, {});

	renderPublicProfile(container, {
		user,
		profile,
		stats: summary.stats || {},
		plan: summary.plan
	});
	hydrateUserTextLinks(container);

	const grid = container.querySelector('[data-profile-grid]');
	const loadMoreEl = container.querySelector('[data-profile-load-more]');
	let items = [];
	let hasMore = false;

	try {
		const result = await loadPublishedImages(apiBase, { limit: PAGE_SIZE, offset: 0 });
		items = result.images;
		hasMore = result.has_more;
	} catch {
		items = [];
		hasMore = false;
	}
	renderCreationsGrid(grid, items);

	function updateLoadMore(more) {
		if (!loadMoreEl) return;
		if (more) {
			loadMoreEl.hidden = false;
			loadMoreEl.innerHTML = html`<div class="user-profile-load-more-inner"><button type="button" class="btn-secondary user-profile-load-more-btn">Load more</button></div>`;
			loadMoreEl.querySelector('.user-profile-load-more-btn')?.addEventListener('click', () => {
				void loadMore();
			});
		} else {
			loadMoreEl.hidden = true;
			loadMoreEl.innerHTML = '';
		}
	}

	async function loadMore() {
		const result = await loadPublishedImages(apiBase, { limit: PAGE_SIZE, offset: items.length });
		items = items.concat(result.images);
		hasMore = result.has_more;
		appendCreationCards(grid, result.images);
		updateLoadMore(hasMore);
		return { hasMore };
	}

	updateLoadMore(hasMore);
	if (grid && items.length > 0) {
		const infinite = createInfiniteScroll({
			listContainer: grid,
			rootMargin: '400px 0px',
			onLoadMore: async () => {
				if (!hasMore) return { hasMore: false };
				return loadMore();
			}
		});
		infinite.setHasMore(hasMore);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void init();
});
