/**
 * DOM helpers for chat fullscreen vertical video (doom scroll) UI.
 */

import { buildProfilePath } from '../../shared/profileLinks.js';
import {
	feedItemCardImageUrlCandidates,
	softenShoutingFeedTitleForSpotlight
} from '../../shared/feedCardBuild.js';
import {
	applyVideoFirstFramePoster,
	feedItemNeedsVideoFramePoster
} from '../../shared/videoFirstFramePoster.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';
import { primeMediaElementForAudioLeveling } from '../../shared/mediaAudioLeveling.js';
import { applyWhoTooltipAttr } from '../../shared/whoLabels.js';
import { setupWhoTooltips } from '../../shared/reactionTooltipTap.js';
import { createChatPageHeader } from '../../shared/chatPageHeader.js';
import {
	DOOM_YOUTUBE_CHROME_GAP_PX,
	doomYoutubeFrameCssText,
	doomYoutubeFrameInsets
} from './doomYoutubeLayout.js';

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
 * YouTube imports are `media_type: video` with no `video_url` — resolve the nocookie embed.
 * @param {object | null | undefined} meta
 * @returns {{ embedSrc: string, title: string, videoId: string } | null}
 */
export function youtubeEmbedFromCreationMeta(meta) {
	const importMeta =
		meta?.import && typeof meta.import === 'object' && !Array.isArray(meta.import)
			? meta.import
			: null;
	if (!importMeta) return null;
	const provider =
		typeof importMeta.provider === 'string' ? importMeta.provider.trim().toLowerCase() : '';
	if (provider && provider !== 'youtube') return null;
	const videoId = typeof importMeta.video_id === 'string' ? importMeta.video_id.trim() : '';
	const embedUrlRaw = typeof importMeta.embed_url === 'string' ? importMeta.embed_url.trim() : '';
	const title =
		typeof importMeta.title === 'string' && importMeta.title.trim()
			? importMeta.title.trim()
			: videoId
				? `youtube ${videoId}`
				: 'YouTube video';

	let embedSrc = '';
	if (embedUrlRaw) {
		try {
			const parsed = new URL(embedUrlRaw);
			const host = parsed.hostname.toLowerCase();
			if (
				(host === 'www.youtube-nocookie.com' ||
					host === 'youtube-nocookie.com' ||
					host === 'www.youtube.com' ||
					host === 'youtube.com') &&
				parsed.pathname.startsWith('/embed/')
			) {
				embedSrc = parsed.toString();
			}
		} catch {
			embedSrc = '';
		}
	}
	if (!embedSrc && videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
		embedSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
	}
	if (!embedSrc) return null;
	return { embedSrc, title, videoId };
}

/**
 * @param {HTMLElement | null | undefined} slide
 */
export function isDoomYoutubeSlide(slide) {
	return slide instanceof HTMLElement && slide.dataset.chatDoomYoutube === '1';
}

/**
 * @param {HTMLElement | null | undefined} slide
 * @returns {HTMLIFrameElement | null}
 */
export function resolveDoomYoutubeIframe(slide) {
	if (!(slide instanceof HTMLElement)) return null;
	const el = slide.querySelector('[data-chat-doom-youtube]');
	return el instanceof HTMLIFrameElement ? el : null;
}

function youtubePlayerCommand(iframe, func, args = []) {
	if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return;
	try {
		iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
	} catch {
		// ignore
	}
}

/** Hide in-player captions so they don't sit on our username / title. */
function disableDoomYoutubeCaptions(iframe) {
	youtubePlayerCommand(iframe, 'unloadModule', ['captions']);
	youtubePlayerCommand(iframe, 'unloadModule', ['cc']);
	youtubePlayerCommand(iframe, 'setOption', ['captions', 'track', {}]);
}

/**
 * @param {HTMLIFrameElement} iframe
 */
function bindDoomYoutubeCaptionSuppress(iframe) {
	if (!(iframe instanceof HTMLIFrameElement)) return;
	const pingAndHide = () => {
		try {
			iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: '1' }), '*');
		} catch {
			// ignore
		}
		disableDoomYoutubeCaptions(iframe);
	};
	iframe.addEventListener('load', () => {
		pingAndHide();
		window.setTimeout(pingAndHide, 250);
		window.setTimeout(pingAndHide, 900);
	});
}

/**
 * @param {string} baseSrc
 * @param {{ muted?: boolean, autoplay?: boolean }} [opts]
 */
export function buildDoomYoutubePlaybackSrc(baseSrc, opts = {}) {
	const url = new URL(baseSrc);
	url.searchParams.set('rel', '0');
	url.searchParams.set('playsinline', '1');
	url.searchParams.set('enablejsapi', '1');
	url.searchParams.set('modestbranding', '1');
	url.searchParams.set('controls', '0');
	url.searchParams.set('fs', '0');
	url.searchParams.set('iv_load_policy', '3');
	url.searchParams.set('disablekb', '1');
	url.searchParams.set('cc_load_policy', '0');
	url.searchParams.set('autoplay', opts.autoplay === false ? '0' : '1');
	url.searchParams.set('mute', opts.muted === false ? '0' : '1');
	const pathId = url.pathname.split('/').filter(Boolean).pop() || '';
	if (/^[a-zA-Z0-9_-]{6,}$/.test(pathId)) {
		url.searchParams.set('loop', '1');
		url.searchParams.set('playlist', pathId);
	}
	try {
		if (typeof window !== 'undefined' && window.location?.origin) {
			url.searchParams.set('origin', window.location.origin);
		}
	} catch {
		// ignore
	}
	return url.toString();
}

/**
 * @param {HTMLElement} slide
 * @param {{ muted?: boolean, seekToStart?: boolean }} [opts]
 */
export function playDoomYoutubeSlide(slide, opts = {}) {
	if (!isDoomYoutubeSlide(slide)) return false;
	const iframe = resolveDoomYoutubeIframe(slide);
	const base = typeof slide.dataset.youtubeEmbedSrc === 'string' ? slide.dataset.youtubeEmbedSrc : '';
	if (!iframe || !base) return false;
	const muted = opts.muted !== false;
	const seekToStart = opts.seekToStart !== false;
	const nextSrc = buildDoomYoutubePlaybackSrc(base, { muted, autoplay: true });
	const hasSrc = Boolean(iframe.getAttribute('src'));
	if (seekToStart || !hasSrc) {
		iframe.src = nextSrc;
	} else {
		youtubePlayerCommand(iframe, muted ? 'mute' : 'unMute');
		youtubePlayerCommand(iframe, 'playVideo');
	}
	iframe.style.opacity = '1';
	disableDoomYoutubeCaptions(iframe);
	revealDoomSlideVideoPlayback(slide);
	return true;
}

/**
 * @param {HTMLElement} slide
 * @param {{ rewind?: boolean }} [opts]
 */
export function pauseDoomYoutubeSlide(slide, opts = {}) {
	if (!isDoomYoutubeSlide(slide)) return;
	const iframe = resolveDoomYoutubeIframe(slide);
	if (!iframe) return;
	if (opts.rewind !== false) {
		iframe.removeAttribute('src');
		iframe.style.opacity = '0';
		const posterImg = slide.querySelector('img.chat-doom-poster');
		if (posterImg instanceof HTMLImageElement) posterImg.hidden = false;
		return;
	}
	youtubePlayerCommand(iframe, 'pauseVideo');
}

/**
 * @param {HTMLElement} slide
 * @param {boolean} muted
 */
export function setDoomYoutubeMuted(slide, muted) {
	const iframe = resolveDoomYoutubeIframe(slide);
	if (!iframe || !iframe.getAttribute('src')) return;
	youtubePlayerCommand(iframe, muted ? 'mute' : 'unMute');
}

/**
 * Full-width YouTube frame; height stops below the topbar and above the username.
 *
 * @param {HTMLElement} mediaWrap
 * @param {HTMLElement} mediaFrame
 * @param {HTMLElement} [overlay]
 */
function bindDoomYoutubeAspectFit(mediaWrap, mediaFrame, overlay) {
	if (!(mediaWrap instanceof HTMLElement) || !(mediaFrame instanceof HTMLElement)) return;

	const measureInsets = () => {
		const root =
			mediaWrap.closest('.chat-doom-scroll-root') ||
			mediaWrap.closest('#chat-doom-scroll-overlay');
		const topbar = root instanceof HTMLElement ? root.querySelector('.chat-doom-topbar') : null;
		let topInset = 0;
		if (topbar instanceof HTMLElement) {
			const wrapTop = mediaWrap.getBoundingClientRect().top;
			let controlsBottom = wrapTop;
			const controls = topbar.querySelectorAll(
				'.chat-page-back, .creation-detail-video-muted-badge, [data-chat-doom-mute]'
			);
			for (const el of controls) {
				if (!(el instanceof HTMLElement) || el.hidden) continue;
				const r = el.getBoundingClientRect();
				if (r.height <= 0) continue;
				controlsBottom = Math.max(controlsBottom, r.bottom);
			}
			if (controlsBottom > wrapTop) {
				topInset = controlsBottom - wrapTop;
			} else {
				const padBottom = parseFloat(window.getComputedStyle(topbar).paddingBottom) || 0;
				const h = topbar.getBoundingClientRect().height;
				topInset = Math.max(0, h - padBottom);
			}
		}
		let bottomInset = 0;
		if (overlay instanceof HTMLElement) {
			const bottom = overlay.querySelector('.chat-doom-bottom');
			const pad = parseFloat(window.getComputedStyle(overlay).paddingBottom) || 0;
			const bh =
				bottom instanceof HTMLElement && bottom.getBoundingClientRect().height > 0
					? bottom.getBoundingClientRect().height
					: 0;
			bottomInset = pad + bh;
		}
		return {
			topInset,
			bottomInset: bottomInset + DOOM_YOUTUBE_CHROME_GAP_PX
		};
	};

	const applyBox = (el, insets) => {
		if (!(el instanceof HTMLElement)) return;
		el.style.cssText = doomYoutubeFrameCssText(insets);
	};

	const syncFrameLayout = () => {
		const insets = doomYoutubeFrameInsets(mediaWrap.clientHeight, measureInsets());
		if (!insets) return;
		applyBox(mediaFrame, insets);
	};

	syncFrameLayout();

	if (typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(() => syncFrameLayout());
		ro.observe(mediaWrap);
		if (overlay instanceof HTMLElement) ro.observe(overlay);
	}
}

/**
 * Portrait clips: `object-fit: cover`. Square or landscape: `contain` + letterboxing.
 * Syncs optional `.chat-doom-poster` img so the placeholder matches the video frame (native
 * `poster=` does not follow `object-fit` reliably).
 *
 * When `mediaWrap` + `mediaFrame` are passed, sizes the frame to the video’s **drawn** bounds
 * (letterboxed rect for contain) so NSFW blur stays inside the picture, not the full viewport cell.
 *
 * When `forceCover` is true (creation flagged `doom_scroll_full_height`), skip contain entirely:
 * the video fills the device viewport (cover) regardless of intrinsic aspect ratio.
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLElement} [mediaWrap]
 * @param {HTMLElement} [mediaFrame]
 * @param {{ forceCover?: boolean }} [opts]
 */
export function bindDoomVideoAspectFit(video, mediaWrap, mediaFrame, opts = {}) {
	if (!(video instanceof HTMLVideoElement)) return;
	const forceCover = Boolean(opts.forceCover);
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

		const useContain = !forceCover && vw >= vh;
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
			const useContain = !forceCover && vw >= vh;
			video.classList.toggle('chat-doom-video--fit-contain', useContain);
			if (posterImg) posterImg.classList.toggle('chat-doom-video--fit-contain', useContain);
			syncFrameLayout();
			return;
		}
		if (posterImg) {
			const iw = posterImg.naturalWidth;
			const ih = posterImg.naturalHeight;
			if (Number.isFinite(iw) && Number.isFinite(ih) && iw > 0 && ih > 0) {
				const useContain = !forceCover && iw >= ih;
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

	/* Video stacks above the poster; keep poster visible until playback paints (feed / detail behavior). */
	video.style.opacity = '0';
	const slideEl = video.closest('.chat-doom-slide');
	bindDoomVideoRevealWhenFrameReady(video, slideEl, {
		shouldReveal: () => slideEl instanceof HTMLElement && slideEl.classList.contains('chat-doom-slide--active')
	});
}

/** @type {WeakMap<HTMLVideoElement, () => void>} */
const doomVideoRevealCleanupByVideo = new WeakMap();

/**
 * Keep poster visible until the video has a composited frame (not merely `playing`).
 * Prefers `requestVideoFrameCallback`; falls back to `timeupdate` with `currentTime > 0`.
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLElement | null | undefined} slide
 * @param {{ shouldReveal?: () => boolean }} [opts]
 * @returns {() => void} cleanup — cancels pending frame wait
 */
export function bindDoomVideoRevealWhenFrameReady(video, slide, opts = {}) {
	if (!(video instanceof HTMLVideoElement)) return () => {};

	const prev = doomVideoRevealCleanupByVideo.get(video);
	if (prev) prev();

	let done = false;
	const shouldReveal = typeof opts.shouldReveal === 'function' ? opts.shouldReveal : () => true;

	/** @type {number | undefined} */
	let rvfcId;
	/** @type {(() => void) | null} */
	let onTimeUpdate = null;

	const cleanup = () => {
		if (onTimeUpdate) {
			video.removeEventListener('timeupdate', onTimeUpdate);
			onTimeUpdate = null;
		}
		if (rvfcId != null && typeof video.cancelVideoFrameCallback === 'function') {
			try {
				video.cancelVideoFrameCallback(rvfcId);
			} catch {
				// ignore
			}
			rvfcId = undefined;
		}
		doomVideoRevealCleanupByVideo.delete(video);
	};

	const reveal = () => {
		if (done) return;
		if (!shouldReveal()) return;
		done = true;
		cleanup();
		revealDoomSlideVideoPlayback(slide);
	};

	if (!video.paused && video.readyState >= 2 && video.currentTime > 0) {
		reveal();
		return cleanup;
	}

	onTimeUpdate = () => {
		if (video.currentTime > 0) reveal();
	};
	video.addEventListener('timeupdate', onTimeUpdate);

	if (typeof video.requestVideoFrameCallback === 'function') {
		rvfcId = video.requestVideoFrameCallback(() => {
			reveal();
		});
	}

	doomVideoRevealCleanupByVideo.set(video, cleanup);
	return cleanup;
}

/**
 * Hide poster and show the playing video (first frame / resume visible).
 * @param {HTMLElement | null | undefined} slide
 */
export function revealDoomSlideVideoPlayback(slide) {
	if (!(slide instanceof HTMLElement)) return;
	const video = slide.querySelector('video.chat-doom-video');
	const posterImg = slide.querySelector('img.chat-doom-poster');
	const iframe = resolveDoomYoutubeIframe(slide);
	if (video instanceof HTMLVideoElement) video.style.opacity = '1';
	if (iframe instanceof HTMLIFrameElement) iframe.style.opacity = '1';
	if (posterImg instanceof HTMLImageElement) posterImg.hidden = true;
}

/**
 * Pause and rewind when leaving a slide — keep the last frame visible (no poster swap).
 * @param {HTMLElement} slide
 */
export function rewindDoomSlideVideo(slide) {
	if (!(slide instanceof HTMLElement)) return;
	if (isDoomYoutubeSlide(slide)) {
		pauseDoomYoutubeSlide(slide, { rewind: true });
		return;
	}
	const video = slide.querySelector('video.chat-doom-video');
	if (!(video instanceof HTMLVideoElement)) return;
	video.pause();
	try {
		video.currentTime = 0;
	} catch {
		// ignore seek errors on unloaded media
	}
}

/**
 * @param {object} opts
 * @returns {HTMLDivElement}
 */
export function createDoomScrollShell(opts = {}) {
	const wrap = document.createElement('div');
	wrap.className = 'chat-doom-scroll-root';
	wrap.setAttribute('data-chat-doom-root', '1');

	const mute = document.createElement('button');
	mute.type = 'button';
	mute.className = 'creation-detail-video-muted-badge chat-doom-mute-btn';
	mute.setAttribute('data-chat-doom-mute', '');
	mute.setAttribute('aria-label', 'Mute');
	mute.innerHTML = `
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
	`;

	const { header: top, back } = createChatPageHeader({
		variant: 'transparent',
		extraClass: 'chat-doom-topbar',
		ariaLabel: 'Doom scroll',
		backAriaLabel: 'Back to feed',
		titleHtml: '',
		trailing: [mute],
	});
	back.classList.add('chat-doom-back');
	back.setAttribute('data-chat-doom-back', '');
	back.setAttribute('data-href', '/chat/c/feed');

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
 * @param {{ backgroundLoad?: boolean }} [slideOpts] — off-screen tail: lighter media hints so the active clip keeps bandwidth / decode headroom.
 * @returns {HTMLDivElement}
 */
export function createDoomSlideElement(item, viewerUserId, slideOpts = {}) {
	const bgLoad = Boolean(slideOpts.backgroundLoad);
	const cid = Number(item.created_image_id || item.id);
	const uid = Number(item.user_id);
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';
	const youtube = !videoUrl ? youtubeEmbedFromCreationMeta(item.meta) : null;
	/** Full `image_url` for poster fidelity; thumb only as fallback if full fails to load. */
	const posterCandidates = feedItemCardImageUrlCandidates(item, false);
	const poster = posterCandidates[0] || '';

	const authorUserName =
		typeof item.author_user_name === 'string' && item.author_user_name.trim()
			? item.author_user_name.trim()
			: null;
	const profileHref = buildProfilePath({ userName: authorUserName, userId: uid });

	const legacyAuthor =
		typeof item.author === 'string' && item.author.trim() && !item.author.includes('@')
			? item.author.trim()
			: null;
	const displayName =
		(typeof item.author_display_name === 'string' && item.author_display_name.trim()
			? item.author_display_name.trim()
			: null) ||
		legacyAuthor ||
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

	/** Creator opted this video into full-height (cover) layout in doom scroll. */
	const forceDoomCover =
		item?.doom_scroll_full_height === true ||
		(item?.meta && typeof item.meta === 'object' && item.meta.doom_scroll_full_height === true);

	const slide = document.createElement('section');
	slide.className = youtube ? 'chat-doom-slide chat-doom-slide--youtube' : 'chat-doom-slide';
	slide.dataset.creationId = String(cid);
	if (Number.isFinite(uid) && uid > 0) slide.dataset.userId = String(uid);
	if (youtube) {
		slide.dataset.chatDoomYoutube = '1';
		slide.dataset.youtubeEmbedSrc = youtube.embedSrc;
	}

	const mediaWrap = document.createElement('div');
	mediaWrap.className = 'chat-doom-slide-media';
	mediaWrap.setAttribute('data-chat-doom-slide-media', '1');

	const mediaFrame = document.createElement('div');
	mediaFrame.className = `chat-doom-slide-media-frame${isNsfw ? ' nsfw' : ''}${youtube ? ' chat-doom-slide-media-frame--youtube' : ''}`;
	if (isNsfw) mediaFrame.setAttribute('data-creation-id', String(cid));

	const needsFramePoster = !youtube && Boolean(videoUrl) && feedItemNeedsVideoFramePoster(item);
	/** Layered poster img matches video `object-fit` / aspect logic; avoid native `video.poster`. */
	let posterImg = null;
	if (posterCandidates.length > 0 || needsFramePoster) {
		posterImg = document.createElement('img');
		posterImg.className = 'chat-doom-poster';
		posterImg.alt = '';
		posterImg.decoding = 'async';
		posterImg.loading = bgLoad ? 'lazy' : 'eager';
		if (!needsFramePoster) {
			let posterTry = 0;
			const tryPosterSrc = () => {
				const url = posterCandidates[posterTry];
				if (!url) return;
				posterImg.src = url;
			};
			posterImg.addEventListener('error', () => {
				posterTry += 1;
				if (posterTry < posterCandidates.length) tryPosterSrc();
			});
			tryPosterSrc();
		}
	}

	const playOverlay = youtube ? null : document.createElement('div');
	if (playOverlay) {
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
	}

	if (posterImg) mediaFrame.appendChild(posterImg);
	if (youtube) {
		const iframe = document.createElement('iframe');
		iframe.className = 'chat-doom-youtube-iframe';
		iframe.setAttribute('data-chat-doom-youtube', '');
		iframe.title = youtube.title;
		iframe.setAttribute(
			'allow',
			'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
		);
		iframe.setAttribute('allowfullscreen', '');
		iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		iframe.style.opacity = '0';
		bindDoomYoutubeCaptionSuppress(iframe);
		mediaFrame.appendChild(iframe);
	} else {
		const video = document.createElement('video');
		video.className = 'chat-doom-video';
		video.setAttribute('playsinline', '');
		video.playsInline = true;
		video.loop = true;
		video.muted = true;
		video.preload = bgLoad ? 'none' : 'metadata';
		primeMediaElementForAudioLeveling(video);
		if (needsFramePoster) video.preload = bgLoad ? 'metadata' : 'auto';
		if (videoUrl) video.src = videoUrl;
		if (needsFramePoster && posterImg) {
			applyVideoFirstFramePoster(posterImg, { videoUrl, existingVideo: video });
		}
		mediaFrame.appendChild(video);
	}
	mediaWrap.appendChild(mediaFrame);
	if (playOverlay) mediaWrap.appendChild(playOverlay);

	const overlay = document.createElement('div');
	overlay.className = 'chat-doom-slide-overlay';

	const rail = document.createElement('div');
	rail.className = 'chat-doom-rail';
	/** Heart + share icon match feed / creation-detail (`public/icons/svg-strings.js` shareIcon path). */
	rail.innerHTML = `
		<div class="chat-doom-rail-item">
			<a class="chat-doom-rail-btn chat-doom-rail-link" href="/creations/${encodeURIComponent(String(cid))}" data-chat-doom-creation-detail aria-label="View creation">
				<span class="chat-doom-rail-icon chat-doom-rail-icon--dna" aria-hidden="true">
					<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="m10 16 1.5 1.5" />
						<path d="m14 8-1.5-1.5" />
						<path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" />
						<path d="m16.5 10.5 1 1" />
						<path d="m17 6-2.891-2.891" />
						<path d="M2 15c6.667-6 13.333 0 20-6" />
						<path d="m20 9 .891.891" />
						<path d="M3.109 14.109 4 15" />
						<path d="m6.5 12.5 1 1" />
						<path d="m7 18 2.891 2.891" />
						<path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" />
					</svg>
				</span>
			</a>
		</div>
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

	const doomCommentsLink = rail.querySelector('a[data-chat-doom-comments]');
	if (doomCommentsLink) {
		applyWhoTooltipAttr(doomCommentsLink, item.commented_by);
		if (doomCommentsLink.hasAttribute('data-tooltip')) {
			doomCommentsLink.setAttribute('data-who-longpress', '1');
		}
	}
	setupWhoTooltips(rail);
	const bottom = document.createElement('div');
	bottom.className = 'chat-doom-bottom';
	if (Number.isFinite(cid) && cid > 0) {
		bottom.setAttribute('data-chat-doom-detail', '');
		bottom.setAttribute(
			'data-chat-doom-detail-href',
			`/creations/${encodeURIComponent(String(cid))}`
		);
	}

	const avatarSeed = handle || displayName || String(uid || '');
	const avatarSlotHtml = `<div class="chat-doom-avatar-slot">${renderCommentAvatarHtml({
		avatarUrl,
		displayName: handle || displayName || 'Creator',
		color: getAvatarColor(avatarSeed),
		href: profileHref || '',
		isFounder: item.author_plan === 'founder',
		flairSize: 'sm'
	})}</div>`;

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
			${avatarSlotHtml}
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

	if (youtube) {
		progress.hidden = true;
		bindDoomYoutubeAspectFit(mediaWrap, mediaFrame, overlay);
	} else {
		const video = mediaFrame.querySelector('video.chat-doom-video');
		if (video instanceof HTMLVideoElement) {
			bindDoomVideoAspectFit(video, mediaWrap, mediaFrame, { forceCover: forceDoomCover });
		}
	}

	return slide;
}
