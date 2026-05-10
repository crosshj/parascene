/**
 * DOM helpers for chat fullscreen vertical video (doom scroll) UI.
 */

import { buildProfilePath } from '../../shared/profileLinks.js';
import { softenShoutingFeedTitleForSpotlight } from '../../shared/feedCardBuild.js';

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtmlAttr(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Doom rail caption: title only (no summary / tags).
 *
 * @param {object} item — feed / summary creation row
 * @returns {string}
 */
export function formatDoomCaption(item) {
	const titleRaw = typeof item.title === 'string' ? item.title.trim() : '';
	return titleRaw ? softenShoutingFeedTitleForSpotlight(titleRaw) : '';
}

/**
 * Portrait clips: `object-fit: cover`. Square or landscape: `contain` + letterboxing.
 * Syncs optional `.chat-doom-poster` img so the placeholder matches the video frame (native
 * `poster=` does not follow `object-fit` reliably).
 *
 * When `mediaWrap` + `mediaFrame` are passed, sizes the frame to the video’s **drawn** bounds
 * (letterboxed rect for contain) so NSFW blur stays inside the picture, not the full viewport cell.
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLElement} [mediaWrap]
 * @param {HTMLElement} [mediaFrame]
 */
export function bindDoomVideoAspectFit(video, mediaWrap, mediaFrame) {
	if (!(video instanceof HTMLVideoElement)) return;
	const posterImg =
		video.parentElement?.querySelector?.(':scope > img.chat-doom-poster') ?? null;

	const syncFrameLayout = () => {
		if (!(mediaWrap instanceof HTMLElement) || !(mediaFrame instanceof HTMLElement)) return;
		const W = mediaWrap.clientWidth;
		const H = mediaWrap.clientHeight;
		if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) return;

		let vw = video.videoWidth;
		let vh = video.videoHeight;
		if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
			if (posterImg) {
				vw = posterImg.naturalWidth;
				vh = posterImg.naturalHeight;
			}
		}
		if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
			mediaFrame.style.cssText =
				'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;';
			return;
		}

		const useContain = vw >= vh;
		if (!useContain) {
			mediaFrame.style.cssText =
				'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;';
			return;
		}

		const scale = Math.min(W / vw, H / vh);
		const dispW = vw * scale;
		const dispH = vh * scale;
		const left = (W - dispW) / 2;
		const top = (H - dispH) / 2;
		mediaFrame.style.cssText = [
			'position:absolute',
			`left:${left}px`,
			`top:${top}px`,
			`width:${dispW}px`,
			`height:${dispH}px`,
			'overflow:hidden',
			'right:auto',
			'bottom:auto'
		].join(';');
	};

	const syncFit = () => {
		const vw = video.videoWidth;
		const vh = video.videoHeight;
		if (Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0) {
			const useContain = vw >= vh;
			video.classList.toggle('chat-doom-video--fit-contain', useContain);
			if (posterImg) posterImg.classList.toggle('chat-doom-video--fit-contain', useContain);
			syncFrameLayout();
			return;
		}
		if (posterImg) {
			const iw = posterImg.naturalWidth;
			const ih = posterImg.naturalHeight;
			if (Number.isFinite(iw) && Number.isFinite(ih) && iw > 0 && ih > 0) {
				const useContain = iw >= ih;
				video.classList.toggle('chat-doom-video--fit-contain', useContain);
				posterImg.classList.toggle('chat-doom-video--fit-contain', useContain);
			}
		}
		syncFrameLayout();
	};

	video.addEventListener('loadedmetadata', syncFit);
	posterImg?.addEventListener('load', syncFit);
	if (video.readyState >= 1) syncFit();
	if (posterImg?.complete) syncFit();

	if (typeof ResizeObserver !== 'undefined' && mediaWrap instanceof HTMLElement && mediaFrame instanceof HTMLElement) {
		const ro = new ResizeObserver(() => syncFrameLayout());
		ro.observe(mediaWrap);
	}

	video.addEventListener(
		'loadeddata',
		() => {
			if (posterImg) posterImg.hidden = true;
		},
		{ once: true }
	);
}

/**
 * @param {object} opts
 * @returns {HTMLDivElement}
 */
export function createDoomScrollShell(opts = {}) {
	const wrap = document.createElement('div');
	wrap.className = 'chat-doom-scroll-root';
	wrap.setAttribute('data-chat-doom-root', '1');

	const top = document.createElement('div');
	top.className = 'chat-doom-topbar';
	/** Same back affordance as chat topbar / mobile chrome (`chat-page-back-icon`). */
	top.innerHTML = `
		<a href="/chat/c/feed" class="chat-page-back chat-doom-back" data-chat-doom-back aria-label="Back to feed">
			<span class="chat-page-back-icon" aria-hidden="true">&lt;-</span>
		</a>
		<div class="chat-doom-topbar-spacer"></div>
		<button type="button" class="creation-detail-video-muted-badge chat-doom-mute-btn" data-chat-doom-mute aria-label="Mute">
			<span data-chat-doom-mute-on class="chat-doom-mute-glyph">
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
					<path d="m22 9-7 7M15 9l7 7"></path>
				</svg>
			</span>
			<span data-chat-doom-mute-off class="chat-doom-mute-glyph" hidden>
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
					<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
					<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
				</svg>
			</span>
		</button>
	`;

	const scroller = document.createElement('div');
	scroller.className = 'chat-doom-scroller';
	scroller.setAttribute('data-chat-doom-scroller', '1');

	wrap.appendChild(top);
	wrap.appendChild(scroller);

	return wrap;
}

/**
 * @param {object} item
 * @param {number} viewerUserId
 * @returns {HTMLDivElement}
 */
export function createDoomSlideElement(item, viewerUserId) {
	const cid = Number(item.created_image_id || item.id);
	const uid = Number(item.user_id);
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';
	const poster =
		(typeof item.thumbnail_url === 'string' && item.thumbnail_url) ||
		(typeof item.image_url === 'string' && item.image_url) ||
		'';

	const authorUserName =
		typeof item.author_user_name === 'string' && item.author_user_name.trim()
			? item.author_user_name.trim()
			: null;
	const profileHref = buildProfilePath({ userName: authorUserName, userId: uid });

	const displayName =
		(typeof item.author_display_name === 'string' && item.author_display_name.trim()
			? item.author_display_name.trim()
			: null) ||
		(typeof item.author === 'string' && item.author.trim()
			? item.author.trim()
			: '') ||
		'Creator';
	const handle = authorUserName || '';

	const avatarUrl =
		typeof item.author_avatar_url === 'string' && item.author_avatar_url.trim()
			? item.author_avatar_url.trim()
			: '';

	const likeCount = Number(item.like_count ?? 0);
	const commentCount = Number(item.comment_count ?? 0);

	const caption = formatDoomCaption(item);
	const self =
		Number.isFinite(uid) &&
		Number.isFinite(Number(viewerUserId)) &&
		uid > 0 &&
		Number(uid) === Number(viewerUserId);

	const isNsfw =
		item.nsfw === true ||
		item.nsfw === 1 ||
		item.nsfw === '1' ||
		String(item.nsfw || '').toLowerCase() === 'true';

	const slide = document.createElement('section');
	slide.className = 'chat-doom-slide';
	slide.dataset.creationId = String(cid);
	if (Number.isFinite(uid) && uid > 0) slide.dataset.userId = String(uid);

	const video = document.createElement('video');
	video.className = 'chat-doom-video';
	video.setAttribute('playsinline', '');
	video.playsInline = true;
	video.loop = true;
	video.muted = true;
	video.preload = 'metadata';
	if (videoUrl) video.src = videoUrl;

	const mediaWrap = document.createElement('div');
	mediaWrap.className = 'chat-doom-slide-media';
	mediaWrap.setAttribute('data-chat-doom-slide-media', '1');

	const mediaFrame = document.createElement('div');
	mediaFrame.className = `chat-doom-slide-media-frame${isNsfw ? ' nsfw' : ''}`;
	if (isNsfw) mediaFrame.setAttribute('data-creation-id', String(cid));

	/** Layered poster img matches video `object-fit` / aspect logic; avoid native `video.poster`. */
	let posterImg = null;
	if (poster) {
		posterImg = document.createElement('img');
		posterImg.className = 'chat-doom-poster';
		posterImg.alt = '';
		posterImg.decoding = 'async';
		posterImg.loading = 'eager';
		posterImg.src = poster;
	}

	const playOverlay = document.createElement('div');
	playOverlay.className = 'chat-doom-play-overlay';
	playOverlay.setAttribute('data-chat-doom-play-overlay', '1');
	playOverlay.setAttribute('aria-hidden', 'true');
	playOverlay.innerHTML = `
		<div class="chat-doom-play-overlay-inner" data-chat-doom-play-icon>
			<svg class="chat-doom-play-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M8 5v14l11-7z"></path>
			</svg>
		</div>
		<div class="chat-doom-play-overlay-inner chat-doom-play-overlay-inner--pausehint" hidden data-chat-doom-pause-hint>
			<svg class="chat-doom-pause-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"></path>
			</svg>
		</div>
	`;

	if (posterImg) mediaFrame.appendChild(posterImg);
	mediaFrame.appendChild(video);
	mediaWrap.appendChild(mediaFrame);
	mediaWrap.appendChild(playOverlay);

	const overlay = document.createElement('div');
	overlay.className = 'chat-doom-slide-overlay';

	const rail = document.createElement('div');
	rail.className = 'chat-doom-rail';
	/** Heart + share icon match feed / creation-detail (`public/icons/svg-strings.js` shareIcon path). */
	rail.innerHTML = `
		<div class="chat-doom-rail-item">
			<button type="button" class="feed-card-action chat-doom-rail-btn" data-like-button aria-label="Like"
				data-like-base-count="${String(Math.max(0, likeCount - (item.viewer_liked ? 1 : 0)))}">
				<span class="chat-doom-rail-icon" aria-hidden="true">
					<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
					</svg>
				</span>
				<span class="chat-doom-rail-count feed-card-action-count" data-like-count>${String(likeCount)}</span>
			</button>
		</div>
		<div class="chat-doom-rail-item">
			<a class="chat-doom-rail-btn chat-doom-rail-link" href="/creations/${encodeURIComponent(String(cid))}#comments" data-chat-doom-comments aria-label="Comments">
				<span class="chat-doom-rail-icon" aria-hidden="true">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"></path></svg>
				</span>
				<span class="chat-doom-rail-count">${commentCount}</span>
			</a>
		</div>
		<div class="chat-doom-rail-item">
			<button type="button" class="chat-doom-rail-btn" data-chat-doom-share aria-label="Share">
				<span class="chat-doom-rail-icon chat-doom-share-icon" aria-hidden="true">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
						<path d="M10 3.158V7.51c-5.428.223-8.27 3.75-8.875 11.199-.04.487-.07.975-.09 1.464l-.014.395c-.014.473.578.684.88.32.302-.368.61-.73.925-1.086l.244-.273c1.79-1.967 3-2.677 4.93-2.917a18.011 18.011 0 012-.112v4.346a1 1 0 001.646.763l9.805-8.297 1.55-1.31-1.55-1.31-9.805-8.297A1 1 0 0010 3.158Zm2 6.27v.002-4.116l7.904 6.688L12 18.689v-4.212l-2.023.024c-1.935.022-3.587.17-5.197 1.024a9 9 0 00-1.348.893c.355-1.947.916-3.39 1.63-4.425 1.062-1.541 2.607-2.385 5.02-2.485L12 9.428Z"></path>
					</svg>
				</span>
				<span class="chat-doom-rail-label">Share</span>
			</button>
		</div>
	`;

	const bottom = document.createElement('div');
	bottom.className = 'chat-doom-bottom';

	const avatarHtml = avatarUrl
		? `<span class="chat-doom-avatar-wrap"><img class="chat-doom-avatar" src="${escapeHtmlAttr(avatarUrl)}" alt="" width="32" height="32" loading="eager" decoding="async"></span>`
		: `<span class="chat-doom-avatar-wrap chat-doom-avatar-placeholder" aria-hidden="true"></span>`;

	/** Username only in the rail — omit display name / email prefix when we have a handle. */
	const creatorNameHtml = handle
		? `<span class="chat-doom-handle">@${escapeHtmlAttr(handle)}</span>`
		: escapeHtmlAttr(displayName);
	const profileAria =
		handle && profileHref ? ` aria-label="${escapeHtmlAttr(`@${handle}`)}"` : '';
	const profileLink = profileHref
		? `<a class="chat-doom-creator-text user-link" href="${escapeHtmlAttr(profileHref)}" data-profile-link${profileAria}>${creatorNameHtml}</a>`
		: `<span class="chat-doom-creator-text">${creatorNameHtml}</span>`;

	/** Follow slot stays hidden until profile fetch resolves — no placeholder while loading. */
	const followSlot =
		!self && Number.isFinite(uid) && uid > 0
			? `<span class="chat-doom-follow-slot" data-chat-doom-follow-slot hidden aria-hidden="true">
				<button type="button" class="btn-secondary chat-doom-follow" hidden data-chat-doom-follow data-follow-user-id="${String(uid)}">Follow</button>
			</span>`
			: '';

	bottom.innerHTML = `
		<div class="chat-doom-bottom-row">
			${avatarHtml}
			<div class="chat-doom-creator-meta">
				${profileLink}
				${followSlot}
			</div>
		</div>
		<p class="chat-doom-caption">${escapeHtmlAttr(caption)}</p>
	`;

	overlay.appendChild(rail);
	overlay.appendChild(bottom);

	const progress = document.createElement('div');
	progress.className = 'chat-doom-progress';
	progress.setAttribute('aria-hidden', 'true');
	progress.innerHTML =
		'<div class="chat-doom-progress-track"><div class="chat-doom-progress-fill" data-chat-doom-progress-fill></div></div>';

	slide.appendChild(mediaWrap);
	slide.appendChild(overlay);
	slide.appendChild(progress);

	bindDoomVideoAspectFit(video, mediaWrap, mediaFrame);

	return slide;
}
