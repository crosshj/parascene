import { copyIcon, linkIcon2 } from '/icons/svg-strings.js';
import { DEFAULT_APP_ORIGIN } from './userText.js';

/** @type {HTMLElement | null} */
let chatInlineImageLightboxEl = null;
/** @type {null | ((e: KeyboardEvent) => void)} */
let chatInlineImageLightboxKeydown = null;

/**
 * When the lightbox reuses an inline bubble video, restore it on close instead of discarding it.
 * @type {null | {
 *   video: HTMLVideoElement,
 *   inner: HTMLElement,
 *   playOverlay: Element | null,
 *   nextSibling: ChildNode | null,
 *   className: string,
 *   controls: boolean,
 *   muted: boolean,
 *   loop: boolean,
 *   autoplay: boolean,
 *   preload: string,
 *   playsInline: boolean,
 *   currentTime: number
 * }}
 */
let chatInlineVideoLightboxRestore = null;

/**
 * @param {HTMLVideoElement} video
 * @returns {{ width: number, height: number }}
 */
function inlineVideoIntrinsicSize(video) {
	if (!(video instanceof HTMLVideoElement)) return { width: 0, height: 0 };
	const w = Number(video.videoWidth);
	const h = Number(video.videoHeight);
	if (w > 0 && h > 0) return { width: w, height: h };
	const dw = Number(video.dataset.inlineVideoWidth);
	const dh = Number(video.dataset.inlineVideoHeight);
	if (Number.isFinite(dw) && Number.isFinite(dh) && dw > 0 && dh > 0) {
		return { width: dw, height: dh };
	}
	return { width: 0, height: 0 };
}

/**
 * @param {HTMLElement} slot
 * @param {number} width
 * @param {number} height
 */
function applyLightboxVideoSlotAspect(slot, width, height) {
	const w = Number(width);
	const h = Number(height);
	if (!(slot instanceof HTMLElement) || !(w > 0 && h > 0)) return;
	slot.style.setProperty('--chat-lightbox-video-ar', `${w} / ${h}`);
	slot.classList.add('chat-inline-image-lightbox-video-slot--sized');
}

/**
 * @param {HTMLVideoElement} video
 */
function captureInlineVideoLightboxRestore(video) {
	const inner = video.closest('.connect-chat-creation-embed-inner--video');
	if (!(inner instanceof HTMLElement)) return null;
	return {
		video,
		inner,
		playOverlay: inner.querySelector('.chat-doom-play-overlay'),
		nextSibling: video.nextSibling,
		className: video.className,
		controls: video.controls,
		muted: video.muted,
		loop: video.loop,
		autoplay: video.autoplay,
		preload: video.preload,
		playsInline: video.playsInline,
		currentTime: video.currentTime
	};
}

function restoreInlineVideoFromLightbox() {
	const state = chatInlineVideoLightboxRestore;
	chatInlineVideoLightboxRestore = null;
	if (!state) return;
	const { video, inner, playOverlay, nextSibling } = state;
	if (!(video instanceof HTMLVideoElement) || !(inner instanceof HTMLElement)) return;
	try {
		video.pause();
	} catch {
		// ignore
	}
	video.currentTime = 0;
	video.className = state.className;
	video.controls = state.controls;
	video.muted = state.muted;
	video.loop = state.loop;
	video.autoplay = state.autoplay;
	video.preload = state.preload;
	video.playsInline = state.playsInline;
	if (inner.isConnected) {
		if (playOverlay && playOverlay.parentNode === inner) {
			inner.insertBefore(video, playOverlay);
		} else if (nextSibling && nextSibling.parentNode === inner) {
			inner.insertBefore(video, nextSibling);
		} else {
			inner.prepend(video);
		}
	}
}

/** Same rules as chat page mobile layout (768px + coarse-pointer heuristics). */
function isInlineImageLightboxMobileHistoryLayout() {
	const isLikelyMobileUa = (() => {
		try {
			const ua = String(window.navigator?.userAgent || '').toLowerCase();
			return /android|iphone|ipod|ipad|mobile/.test(ua);
		} catch {
			return false;
		}
	})();
	const coarsePointer = (() => {
		try {
			return window.matchMedia('(pointer: coarse)').matches;
		} catch {
			return false;
		}
	})();
	try {
		if (window.matchMedia('(max-width: 768px)').matches) return true;
		const vv = window.visualViewport;
		const vvWidth =
			vv && typeof vv.width === 'number' && Number.isFinite(vv.width) ? vv.width : NaN;
		const iw =
			typeof window.innerWidth === 'number' && Number.isFinite(window.innerWidth)
				? window.innerWidth
				: NaN;
		const width = Number.isFinite(vvWidth) ? vvWidth : iw;
		if (isLikelyMobileUa && coarsePointer && Number.isFinite(width) && width <= 900) return true;
		return false;
	} catch {
		const iw = typeof window.innerWidth === 'number' ? window.innerWidth : NaN;
		return Boolean(isLikelyMobileUa && coarsePointer && Number.isFinite(iw) && iw <= 900);
	}
}

function attachChatInlineImageLightboxBackdropClose(overlay) {
	overlay.addEventListener('click', (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;
		if (t.closest('.chat-inline-image-lightbox-footer')) return;
		if (t.closest('.chat-inline-image-lightbox-close')) return;
		if (
			t.closest('.chat-inline-image-lightbox-img') ||
			t.closest('.chat-inline-image-lightbox-canvas') ||
			t.closest('.chat-inline-image-lightbox-gallery-nav') ||
			t.closest('.chat-inline-image-lightbox-video') ||
			t.closest('.chat-inline-image-lightbox-iframe')
		) {
			return;
		}
		closeChatInlineImageLightbox();
	});
}

export function closeChatInlineImageLightbox() {
	restoreInlineVideoFromLightbox();
	if (typeof chatInlineImageLightboxKeydown === 'function') {
		document.removeEventListener('keydown', chatInlineImageLightboxKeydown);
		chatInlineImageLightboxKeydown = null;
	}
	if (chatInlineImageLightboxEl?.parentNode) {
		chatInlineImageLightboxEl.parentNode.removeChild(chatInlineImageLightboxEl);
	}
	chatInlineImageLightboxEl = null;
}

function pushChatInlineImageLightboxHistoryEntry() {
	if (!isInlineImageLightboxMobileHistoryLayout()) return;
	try {
		const curState = window.history?.state;
		const baseState = curState && typeof curState === 'object' ? curState : {};
		window.history.pushState(
			{ ...baseState, prsnChat: true, prsnChatInlineImageLightbox: true },
			'',
			window.location.href
		);
	} catch {
		// ignore
	}
}

export function closeChatInlineImageLightboxFromPopstateIfOpen() {
	if (!isInlineImageLightboxMobileHistoryLayout()) return false;
	if (!(chatInlineImageLightboxEl instanceof HTMLElement)) return false;
	closeChatInlineImageLightbox();
	return true;
}

/**
 * @param {HTMLElement} overlay
 * @param {string} creationIdRaw
 */
function mountInlineImageLightboxCreationFooter(overlay, creationIdRaw) {
	const cidRaw = String(creationIdRaw ?? '').trim();
	if (!cidRaw) return;
	const detailPath = `/creations/${encodeURIComponent(cidRaw)}`;
	const shareOrigin = String(DEFAULT_APP_ORIGIN || 'https://www.parascene.com').replace(/\/+$/, '');
	let absoluteUrl = '';
	try {
		absoluteUrl = new URL(detailPath, shareOrigin).href;
	} catch {
		absoluteUrl = `${shareOrigin}${detailPath}`;
	}

	const footer = document.createElement('div');
	footer.className = 'chat-inline-image-lightbox-footer';

	const goBtn = document.createElement('a');
	goBtn.className = 'btn-primary chat-inline-image-lightbox-footer-btn';
	goBtn.href = detailPath;
	goBtn.setAttribute('aria-label', 'Go to creation');
	goBtn.innerHTML =
		`<span class="chat-inline-image-lightbox-footer-btn-lead" aria-hidden="true">${linkIcon2()}</span>` +
		`<span>Go To Creation</span>`;

	const copyBtn = document.createElement('button');
	copyBtn.type = 'button';
	copyBtn.className = 'btn-secondary chat-inline-image-lightbox-footer-btn';
	copyBtn.setAttribute('aria-label', 'Copy creation link');
	copyBtn.innerHTML =
		`<span aria-hidden="true">${copyIcon('chat-inline-image-lightbox-copy-icon')}</span>` +
		`<span data-chat-inline-lightbox-copy-label="">Copy link</span>`;
	copyBtn.addEventListener('click', async () => {
		try {
			if (!navigator.clipboard?.writeText) return;
			await navigator.clipboard.writeText(absoluteUrl);
			const lab = copyBtn.querySelector('[data-chat-inline-lightbox-copy-label]');
			if (lab) {
				const prev = lab.textContent || '';
				lab.textContent = 'Copied!';
				window.setTimeout(() => {
					lab.textContent = prev || 'Copy link';
				}, 2000);
			}
		} catch {
			// ignore
		}
	});

	footer.appendChild(goBtn);
	footer.appendChild(copyBtn);
	overlay.appendChild(footer);
}

export function chatAttachmentPreviewKindFromHref(href) {
	try {
		const u = new URL(String(href || ''), window.location.origin);
		let name = String(u.searchParams.get('name') || '').trim();
		if (!name) {
			const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
			name = decodeURIComponent(seg);
		}
		const idx = name.lastIndexOf('.');
		const ext = idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
		if (['mp4', 'mov', 'm4v', 'webm', 'ogg', 'ogv'].includes(ext)) return 'video';
		if (['html', 'htm'].includes(ext)) return 'html';
		return null;
	} catch {
		return null;
	}
}

/**
 * @param {string} src
 * @param {object} [creationMeta]
 * @param {{ beforeOpen?: () => void }} [hooks]
 */
export function openChatInlineImageLightbox(src, creationMeta, hooks) {
	const rawGallery =
		creationMeta && Array.isArray(creationMeta.galleryUrls)
			? creationMeta.galleryUrls.map((u) => String(u || '').trim()).filter(Boolean)
			: [];
	const galleryImgs = Array.isArray(creationMeta?.galleryImgs)
		? creationMeta.galleryImgs.filter((n) => n instanceof HTMLImageElement)
		: [];
	const primarySourceImg =
		creationMeta?.sourceImg instanceof HTMLImageElement ? creationMeta.sourceImg : null;
	const useGallery = rawGallery.length > 1;
	let galleryIndex = Number(creationMeta?.galleryIndex);
	if (!Number.isFinite(galleryIndex)) galleryIndex = 0;
	const srcTrim = String(src || '').trim();
	if (useGallery) {
		const matchIdx = rawGallery.indexOf(srcTrim);
		if (matchIdx >= 0) galleryIndex = matchIdx;
		galleryIndex = Math.max(0, Math.min(rawGallery.length - 1, galleryIndex));
	}
	const primarySrc = useGallery ? rawGallery[galleryIndex] : srcTrim;
	const url = String(primarySrc || '').trim();
	if (!url && !(primarySourceImg?.parentNode && !useGallery)) return;
	if (hooks && typeof hooks.beforeOpen === 'function') hooks.beforeOpen();
	closeChatInlineImageLightbox();

	const overlay = document.createElement('div');
	overlay.className = 'chat-inline-image-lightbox';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', creationMeta?.creationId ? 'Creation preview' : 'Image');

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'chat-inline-image-lightbox-close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.textContent = '×';

	const frame = document.createElement('div');
	frame.className = useGallery
		? 'chat-inline-image-lightbox-frame chat-inline-image-lightbox-frame--gallery'
		: 'chat-inline-image-lightbox-frame';

	/** @type {HTMLElement | null} */
	let mountedLightboxVisual = null;

	const detachMountedLightboxVisual = () => {
		if (mountedLightboxVisual?.parentNode) {
			mountedLightboxVisual.parentNode.removeChild(mountedLightboxVisual);
		}
		mountedLightboxVisual = null;
	};

	const mountBitmapCopyFromSourceImg = (source) => {
		if (!(source instanceof HTMLImageElement) || !source.parentNode) return false;
		if (!source.complete || source.naturalWidth === 0) return false;
		detachMountedLightboxVisual();
		const w = source.naturalWidth;
		const h = source.naturalHeight;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		try {
			ctx.drawImage(source, 0, 0);
		} catch {
			detachMountedLightboxVisual();
			return false;
		}
		canvas.className = 'chat-inline-image-lightbox-img chat-inline-image-lightbox-canvas';
		canvas.setAttribute('role', 'img');
		const alt = typeof source.alt === 'string' ? source.alt.trim() : '';
		if (alt) canvas.setAttribute('aria-label', alt);
		else canvas.setAttribute('aria-hidden', 'true');
		mountedLightboxVisual = canvas;
		mountIntoFrame(canvas);
		return true;
	};

	let prevGalleryBtn = null;
	let nextGalleryBtn = null;
	const makeGalleryNav = (direction) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `chat-inline-image-lightbox-gallery-nav chat-inline-image-lightbox-gallery-nav--${direction}`;
		btn.setAttribute('aria-label', direction === 'prev' ? 'Previous image' : 'Next image');
		btn.innerHTML =
			direction === 'prev'
				? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 6.5L9 12l5.5 5.5" /></svg>'
				: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6.5L15 12l-5.5 5.5" /></svg>';
		return btn;
	};

	const mountIntoFrame = (node) => {
		if (useGallery && prevGalleryBtn) frame.insertBefore(node, prevGalleryBtn);
		else frame.appendChild(node);
	};

	const mountSyntheticImg = (srcUrl) => {
		detachMountedLightboxVisual();
		const img = document.createElement('img');
		img.className = 'chat-inline-image-lightbox-img';
		img.src = String(srcUrl || '').trim();
		img.alt = '';
		mountedLightboxVisual = img;
		mountIntoFrame(img);
	};

	const mountGallerySlide = (idx) => {
		const slideUrl = String(rawGallery[idx] || '').trim();
		const cand = galleryImgs[idx];
		if (mountBitmapCopyFromSourceImg(cand)) return;
		detachMountedLightboxVisual();
		if (slideUrl) mountSyntheticImg(slideUrl);
	};

	const mountSingleSlide = () => {
		if (primarySourceImg instanceof HTMLImageElement && primarySourceImg.parentNode) {
			if (mountBitmapCopyFromSourceImg(primarySourceImg)) return;
		}
		detachMountedLightboxVisual();
		const fallbackUrl = String(srcTrim || '').trim();
		if (fallbackUrl) mountSyntheticImg(fallbackUrl);
	};

	let activeGalleryIndex = useGallery ? galleryIndex : 0;
	const slideChangeCb =
		useGallery && typeof creationMeta?.onGalleryLightboxSlideChange === 'function'
			? creationMeta.onGalleryLightboxSlideChange
			: null;
	const notifyCarouselBehindLightbox = () => {
		if (!slideChangeCb) return;
		try {
			slideChangeCb(activeGalleryIndex);
		} catch {
			/* ignore */
		}
	};
	const applyGalleryIndex = (nextIdx) => {
		if (!useGallery || rawGallery.length === 0) return;
		activeGalleryIndex =
			((nextIdx % rawGallery.length) + rawGallery.length) % rawGallery.length;
		mountGallerySlide(activeGalleryIndex);
		notifyCarouselBehindLightbox();
	};

	if (useGallery) {
		prevGalleryBtn = makeGalleryNav('prev');
		nextGalleryBtn = makeGalleryNav('next');
		prevGalleryBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			applyGalleryIndex(activeGalleryIndex - 1);
		});
		nextGalleryBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			applyGalleryIndex(activeGalleryIndex + 1);
		});
		frame.appendChild(prevGalleryBtn);
		frame.appendChild(nextGalleryBtn);
	}

	if (useGallery) mountGallerySlide(activeGalleryIndex);
	else mountSingleSlide();
	if (useGallery) notifyCarouselBehindLightbox();

	overlay.appendChild(closeBtn);
	overlay.appendChild(frame);

	const cidRaw =
		creationMeta && typeof creationMeta.creationId !== 'undefined'
			? String(creationMeta.creationId).trim()
			: '';
	mountInlineImageLightboxCreationFooter(overlay, cidRaw);

	chatInlineImageLightboxKeydown = (e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeChatInlineImageLightbox();
			return;
		}
		if (useGallery && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			if (e.key === 'ArrowLeft') applyGalleryIndex(activeGalleryIndex - 1);
			else applyGalleryIndex(activeGalleryIndex + 1);
		}
	};
	document.addEventListener('keydown', chatInlineImageLightboxKeydown);

	attachChatInlineImageLightboxBackdropClose(overlay);
	closeBtn.addEventListener('click', () => closeChatInlineImageLightbox());

	document.body.appendChild(overlay);
	chatInlineImageLightboxEl = overlay;
	pushChatInlineImageLightboxHistoryEntry();
	requestAnimationFrame(() => {
		try {
			closeBtn.focus({ preventScroll: true });
		} catch {
			closeBtn.focus();
		}
	});
}

/**
 * @param {string} src
 * @param {'video' | 'html' | string} kind
 * @param {{ beforeOpen?: () => void, creationId?: string, sourceVideo?: HTMLVideoElement }} [hooks]
 */
export function openChatAttachmentPreviewLightbox(src, kind, hooks) {
	const url = String(src || '').trim();
	if (!url) return;
	if (hooks && typeof hooks.beforeOpen === 'function') hooks.beforeOpen();
	closeChatInlineImageLightbox();

	const overlay = document.createElement('div');
	overlay.className = 'chat-inline-image-lightbox';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', kind === 'video' ? 'Video' : 'Preview');

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'chat-inline-image-lightbox-close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.textContent = '×';

	const frame = document.createElement('div');
	frame.className = 'chat-inline-image-lightbox-frame';

	/** @type {HTMLVideoElement | null} */
	let lightboxPreviewVideo = null;
	/** @type {null | (() => void)} */
	let revealChatLightboxVideo = null;

	if (kind === 'video') {
		const sourceVideo =
			hooks?.sourceVideo instanceof HTMLVideoElement ? hooks.sourceVideo : null;
		const canReuseInline =
			sourceVideo &&
			sourceVideo.parentNode &&
			!chatInlineVideoLightboxRestore;
		const { width: intrinsicW, height: intrinsicH } = canReuseInline
			? inlineVideoIntrinsicSize(sourceVideo)
			: { width: 0, height: 0 };

		const slot = document.createElement('div');
		slot.className = 'chat-inline-image-lightbox-video-slot';
		applyLightboxVideoSlotAspect(slot, intrinsicW, intrinsicH);

		const placeholder = document.createElement('div');
		placeholder.className = 'chat-inline-image-lightbox-video-placeholder skeleton';
		placeholder.setAttribute('role', 'status');
		placeholder.setAttribute('aria-live', 'polite');
		placeholder.setAttribute('aria-label', 'Loading video');

		/** @type {HTMLVideoElement} */
		let video;
		if (canReuseInline) {
			const restore = captureInlineVideoLightboxRestore(sourceVideo);
			if (restore) chatInlineVideoLightboxRestore = restore;
			video = sourceVideo;
			video.classList.add('chat-inline-image-lightbox-video');
			video.controls = true;
			video.playsInline = true;
			video.loop = true;
			video.setAttribute('loop', '');
			video.muted = false;
			video.defaultMuted = false;
			video.autoplay = true;
			if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && intrinsicW > 0) {
				video.classList.remove('chat-inline-image-lightbox-video--pending');
			} else {
				video.classList.add('chat-inline-image-lightbox-video--pending');
			}
		} else {
			video = document.createElement('video');
			video.className =
				'chat-inline-image-lightbox-video chat-inline-image-lightbox-video--pending';
			video.controls = true;
			video.playsInline = true;
			video.loop = true;
			video.setAttribute('loop', '');
			video.preload = 'auto';
			video.muted = false;
			video.defaultMuted = false;
			video.autoplay = true;
			video.src = url;
		}
		lightboxPreviewVideo = video;

		let placeholderDone = false;
		revealChatLightboxVideo = () => {
			if (placeholderDone) return;
			placeholderDone = true;
			if (placeholder.parentNode) placeholder.remove();
			slot.classList.add('chat-inline-image-lightbox-video-slot--playing');
			video.classList.remove('chat-inline-image-lightbox-video--pending');
		};

		const hasInlineFrame =
			canReuseInline &&
			video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
			intrinsicW > 0;
		if (hasInlineFrame) {
			revealChatLightboxVideo();
		} else {
			video.addEventListener('playing', revealChatLightboxVideo, { once: true });
			video.addEventListener('loadeddata', revealChatLightboxVideo, { once: true });
			video.addEventListener('error', revealChatLightboxVideo, { once: true });
		}

		slot.appendChild(video);
		if (!hasInlineFrame) slot.appendChild(placeholder);
		frame.appendChild(slot);
	} else {
		const iframe = document.createElement('iframe');
		iframe.className = 'chat-inline-image-lightbox-iframe';
		iframe.setAttribute('sandbox', 'allow-scripts allow-downloads');
		iframe.setAttribute('referrerpolicy', 'no-referrer');
		iframe.srcdoc =
			'<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark light"><style>html,body{margin:0;height:100%;background:#000;}@media (prefers-color-scheme: light){html,body{background:#fff;}}</style></head><body></body></html>';
		frame.appendChild(iframe);
		void (async () => {
			try {
				const res = await fetch(url, { credentials: 'include' });
				const html = await res.text();
				if (res.ok) iframe.srcdoc = html;
			} catch {
				// ignore
			}
		})();
	}

	overlay.appendChild(closeBtn);
	overlay.appendChild(frame);

	const previewCid =
		hooks && typeof hooks.creationId !== 'undefined' ? String(hooks.creationId).trim() : '';
	mountInlineImageLightboxCreationFooter(overlay, previewCid);

	chatInlineImageLightboxKeydown = (e) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		closeChatInlineImageLightbox();
	};
	document.addEventListener('keydown', chatInlineImageLightboxKeydown);

	attachChatInlineImageLightboxBackdropClose(overlay);
	closeBtn.addEventListener('click', () => closeChatInlineImageLightbox());

	document.body.appendChild(overlay);
	chatInlineImageLightboxEl = overlay;
	pushChatInlineImageLightboxHistoryEntry();
	requestAnimationFrame(() => {
		try {
			closeBtn.focus({ preventScroll: true });
		} catch {
			closeBtn.focus();
		}
		if (lightboxPreviewVideo) {
			void lightboxPreviewVideo.play().catch(() => {
				// Placeholder stays until playback starts (e.g. user taps play if autoplay is blocked).
			});
		}
	});
}

/**
 * Delegated clicks for inline image thumbnails (same behavior as chat bubbles).
 *
 * @param {HTMLElement} rootEl
 * @param {{ bubbleSelector?: string | null, openHooks?: { beforeOpen?: () => void } }} [options]
 * @returns {() => void} teardown
 */
export function bindChatInlineImageLightboxClickDelegation(rootEl, options = {}) {
	const bubbleSelRaw = options.bubbleSelector;
	const bubbleSelector =
		bubbleSelRaw === null
			? null
			: typeof bubbleSelRaw === 'string'
				? bubbleSelRaw
				: '.connect-chat-msg-bubble';
	const openHooks =
		options.openHooks && typeof options.openHooks === 'object' ? options.openHooks : {};

	const handler = (e) => {
		if (!(rootEl instanceof HTMLElement)) return;
		if (!(e.target instanceof Element)) return;
		if (!rootEl.contains(e.target)) return;

		const scope =
			bubbleSelector === null ? rootEl : e.target.closest(bubbleSelector);
		if (bubbleSelector !== null) {
			if (!(scope instanceof HTMLElement) || !rootEl.contains(scope)) return;
		}

		const groupInner = e.target.closest?.('.connect-chat-creation-embed-inner--group-carousel');
		if (groupInner && scope.contains(groupInner)) {
			if (e.target.closest?.('.connect-chat-creation-embed-group-nav')) return;
			const embedWrap = groupInner.closest('.connect-chat-creation-embed');
			const creationId =
				embedWrap instanceof HTMLElement
					? String(embedWrap.getAttribute('data-creation-id') || '').trim()
					: '';
			if (!creationId) return;
			e.preventDefault();
			e.stopPropagation();
			window.location.href = `/creations/${encodeURIComponent(creationId)}`;
			return;
		}

		const videoInner = e.target.closest?.('.connect-chat-creation-embed-inner--video');
		if (videoInner && scope.contains(videoInner)) {
			const wrap = videoInner.closest('.connect-chat-creation-embed');
			const vid = wrap?.querySelector?.('.connect-chat-creation-embed-video');
			if (!(vid instanceof HTMLVideoElement)) return;
			const src = String(vid.currentSrc || vid.getAttribute('src') || '').trim();
			if (!src) return;
			const creationId =
				wrap instanceof HTMLElement
					? String(wrap.getAttribute('data-creation-id') || '').trim()
					: '';
			e.preventDefault();
			e.stopPropagation();
			openChatAttachmentPreviewLightbox(src, 'video', {
				...openHooks,
				...(creationId ? { creationId } : {}),
				sourceVideo: vid,
			});
			return;
		}

		const a = e.target?.closest?.('a.user-text-inline-image-link');
		if (!(a instanceof HTMLAnchorElement)) return;
		if (!scope.contains(a)) return;
		if (!rootEl.contains(a)) return;
		e.preventDefault();
		e.stopPropagation();
		const thumb =
			a.querySelector('img.user-text-inline-image') ||
			a.querySelector('img.connect-chat-creation-embed-img');
		let src = '';
		if (thumb instanceof HTMLImageElement) {
			src = thumb.currentSrc || thumb.getAttribute('src') || '';
		}
		if (!src) src = a.getAttribute('href') || '';
		const embedWrap = a.closest('.connect-chat-creation-embed');
		const creationId =
			embedWrap instanceof HTMLElement
				? String(embedWrap.getAttribute('data-creation-id') || '').trim()
				: '';
		openChatInlineImageLightbox(
			src,
			{
				...(creationId ? { creationId } : {}),
				...(thumb instanceof HTMLImageElement ? { sourceImg: thumb } : {}),
			},
			openHooks
		);
	};

	const keyHandler = (e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const t = e.target;
		if (!(t instanceof Element)) return;
		if (!rootEl.contains(t)) return;
		const videoInner = t.closest?.('.connect-chat-creation-embed-inner--video');
		if (!videoInner || !(videoInner instanceof HTMLElement)) return;
		const scope =
			bubbleSelector === null ? rootEl : t.closest(bubbleSelector);
		if (bubbleSelector !== null) {
			if (!(scope instanceof HTMLElement) || !rootEl.contains(scope)) return;
			if (!scope.contains(videoInner)) return;
		} else if (!rootEl.contains(videoInner)) return;
		const wrap = videoInner.closest('.connect-chat-creation-embed');
		const vid = wrap?.querySelector?.('.connect-chat-creation-embed-video');
		if (!(vid instanceof HTMLVideoElement)) return;
		const src = String(vid.currentSrc || vid.getAttribute('src') || '').trim();
		if (!src) return;
		const creationId =
			wrap instanceof HTMLElement
				? String(wrap.getAttribute('data-creation-id') || '').trim()
				: '';
		e.preventDefault();
		e.stopPropagation();
		openChatAttachmentPreviewLightbox(src, 'video', {
			...openHooks,
			...(creationId ? { creationId } : {}),
			sourceVideo: vid,
		});
	};

	rootEl.addEventListener('click', handler);
	rootEl.addEventListener('keydown', keyHandler);
	return () => {
		rootEl.removeEventListener('click', handler);
		rootEl.removeEventListener('keydown', keyHandler);
	};
}
