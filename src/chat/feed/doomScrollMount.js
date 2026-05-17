/**
 * Mount / teardown fullscreen doom scroll for `/chat/c/feed/doom/:creationId`.
 */

import { getChatFeedItemKey } from './feedChannelData.js';
import {
	createDoomFeedPager,
	DOOM_FEED_PAGE_SIZE,
	normalizeDoomAnchorMountItems
} from './doomFeedData.js';
import {
	isMediaAutoplayBlockedError,
	isMediaPlayAbortError,
	safeMediaPlay,
	safeMediaPlayWithHandlers
} from '../../shared/safeMediaPlay.js';
import { initLikeButton } from '../../shared/likes.js';
import {
	bindDoomVideoRevealWhenFrameReady,
	createDoomScrollShell,
	createDoomSlideElement,
	revealDoomSlideVideoPlayback,
	rewindDoomSlideVideo
} from './doomScrollView.js';
import {
	destroyDoomCommentsPopover,
	openDoomCommentsPopover
} from '../doom/doomCommentsPopover.js';
import { warmDoomSlideVideo } from './doomScrollWarm.js';

/** @type {null | (() => void)} */
let activeTeardown = null;

function setChatPageDoomScrollBodyClass(on) {
	if (typeof document === 'undefined' || !document.body) return;
	document.body.classList.toggle('chat-page--doom-scroll', Boolean(on));
}

export function teardownChatDoomScroll() {
	setChatPageDoomScrollBodyClass(false);
	if (typeof activeTeardown === 'function') {
		try {
			activeTeardown();
		} catch {
			// ignore
		}
		activeTeardown = null;
	}
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.messagesEl
 * @param {number} opts.startCreationId
 * @param {Function} opts.fetchJsonWithStatusDeduped
 * @param {() => string[]} opts.getHiddenFeedItems
 * @param {number | null} opts.viewerUserId
 * @param {() => void} [opts.applyComposerState]
 * @param {() => void} [opts.syncChatBrowseViewBodyClass]
 * @param {() => void} [opts.navigateToFeedChannel] SPA back navigation (defaults to full navigation)
 */
export async function mountChatDoomScroll(opts) {
	const messagesEl = opts.messagesEl;
	const startCreationId = opts.startCreationId;
	const fetchJsonWithStatusDeduped = opts.fetchJsonWithStatusDeduped;
	const getHiddenFeedItems = opts.getHiddenFeedItems;
	const viewerUserId =
		opts.viewerUserId != null && Number.isFinite(Number(opts.viewerUserId))
			? Number(opts.viewerUserId)
			: null;

	if (!(messagesEl instanceof HTMLElement)) return;
	teardownChatDoomScroll();

	const doomPager = createDoomFeedPager({
		fetchJsonWithStatusDeduped,
		getHiddenFeedItems,
		pageSize: DOOM_FEED_PAGE_SIZE
	});

	const mountPage = await doomPager.fetchMountPage(startCreationId);
	const orderedVideos = normalizeDoomAnchorMountItems(
		mountPage.pageItems,
		startCreationId
	);
	let doomHasMore = Boolean(mountPage.hasMore);
	const anchorIndex =
		orderedVideos.length > 0 &&
		Number(orderedVideos[0]?.created_image_id ?? orderedVideos[0]?.id) === startCreationId
			? 0
			: orderedVideos.findIndex((it) => {
					const cid = Number(it?.created_image_id ?? it?.id);
					return Number.isFinite(cid) && cid === startCreationId;
				});

	/** @type {Map<string, object>} */
	const videoByKey = new Map();
	for (const it of orderedVideos) {
		const k = getChatFeedItemKey(it);
		videoByKey.set(k, it);
	}

	messagesEl.classList.add('chat-page-messages--doom-host');
	setChatPageDoomScrollBodyClass(true);
	messagesEl.innerHTML = '';

	if (orderedVideos.length === 0 || anchorIndex < 0) {
		const err = document.createElement('div');
		err.className = 'chat-doom-error';
		err.innerHTML = `
			<p class="chat-doom-error-title">Video unavailable</p>
			<p class="chat-doom-error-detail">This creation could not be loaded in the feed viewer.</p>
			<button type="button" class="btn-primary chat-doom-error-back" data-chat-doom-back>Back to feed</button>
		`;
		messagesEl.appendChild(err);
		const eb = err.querySelector('[data-chat-doom-back]');
		if (eb instanceof HTMLElement) {
			eb.addEventListener('click', () => {
				if (typeof opts.navigateToFeedChannel === 'function') {
					opts.navigateToFeedChannel();
				} else {
					window.location.href = '/chat/c/feed';
				}
			});
		}
		if (typeof opts.applyComposerState === 'function') opts.applyComposerState();
		activeTeardown = () => {
			setChatPageDoomScrollBodyClass(false);
			messagesEl.classList.remove('chat-page-messages--doom-host');
		};
		return;
	}

	const shell = createDoomScrollShell();
	const scroller = shell.querySelector('[data-chat-doom-scroller]');
	const backBtn = shell.querySelector('[data-chat-doom-back]');
	const muteBtn = shell.querySelector('[data-chat-doom-mute]');
	const muteOn = shell.querySelector('[data-chat-doom-mute-on]');
	const muteOff = shell.querySelector('[data-chat-doom-mute-off]');

	if (!(scroller instanceof HTMLElement)) {
		messagesEl.innerHTML = '';
		setChatPageDoomScrollBodyClass(false);
		messagesEl.classList.remove('chat-page-messages--doom-host');
		return;
	}

	/** Cleared on teardown so deferred work and `playing` wait bail out. */
	let doomMountAlive = true;

	const tryMutedFromStorage = () => {
		try {
			return sessionStorage.getItem('chatDoomPreferMuted') === '1';
		} catch {
			return false;
		}
	};
	let preferMuted = tryMutedFromStorage();

	function syncMuteUi() {
		const list = slides();
		const slide = list[activeIdx];
		const v = slide?.querySelector?.('video.chat-doom-video');
		const uiMuted = v instanceof HTMLVideoElement ? v.muted : preferMuted;
		if (muteOn instanceof HTMLElement) muteOn.hidden = !uiMuted;
		if (muteOff instanceof HTMLElement) muteOff.hidden = uiMuted;
		if (muteBtn instanceof HTMLElement) {
			muteBtn.setAttribute('aria-label', uiMuted ? 'Unmute video' : 'Mute video');
		}
	}

	/** @type {ReturnType<typeof setTimeout> | null} */
	let pauseFlashTimer = null;

	function syncPlayOverlayForSlide(slide) {
		const v = slide.querySelector('video.chat-doom-video');
		const o = slide.querySelector('[data-chat-doom-play-overlay]');
		if (!v || !o) return;
		const playInner = o.querySelector('[data-chat-doom-play-icon]');
		const hint = o.querySelector('[data-chat-doom-pause-hint]');
		if (playInner instanceof HTMLElement) playInner.hidden = false;
		if (hint instanceof HTMLElement) hint.hidden = true;
		const userPaused = slide.getAttribute('data-chat-doom-user-paused') === '1';
		const isActive = slide.classList.contains('chat-doom-slide--active');
		const showPlayHint = v.paused && userPaused && isActive;
		o.hidden = !showPlayHint;
		o.setAttribute('aria-hidden', showPlayHint ? 'false' : 'true');
	}

	function flashPauseHint(slide) {
		const o = slide.querySelector('[data-chat-doom-play-overlay]');
		const hint = o?.querySelector?.('[data-chat-doom-pause-hint]');
		const playInner = o?.querySelector?.('[data-chat-doom-play-icon]');
		if (!(o instanceof HTMLElement) || !(hint instanceof HTMLElement)) return;
		if (pauseFlashTimer) window.clearTimeout(pauseFlashTimer);
		o.hidden = false;
		hint.hidden = false;
		if (playInner instanceof HTMLElement) playInner.hidden = true;
		o.setAttribute('aria-hidden', 'false');
		pauseFlashTimer = window.setTimeout(() => {
			pauseFlashTimer = null;
			const v = slide.querySelector('video.chat-doom-video');
			if (!(v instanceof HTMLVideoElement)) return;
			hint.hidden = true;
			if (playInner instanceof HTMLElement) playInner.hidden = false;
			syncPlayOverlayForSlide(slide);
		}, 480);
	}

	/**
	 * @param {HTMLElement} slide
	 */
	function bindDoomSlidePlaybackUi(slide) {
		const v = slide.querySelector('video.chat-doom-video');
		if (!(v instanceof HTMLVideoElement)) return;
		const sync = () => syncPlayOverlayForSlide(slide);
		v.addEventListener('play', () => {
			slide.removeAttribute('data-chat-doom-user-paused');
			sync();
		});
		/* Do not infer “user paused” from `pause` — scroll/snap/autoplay policy also pause the element.
		   Only `onDoomMediaClick` sets `data-chat-doom-user-paused` when the user taps to pause. */
		v.addEventListener('pause', sync);
		sync();
	}

	function appendDoomSlideForItem(item, eagerVideoLoad = false) {
		const slide = createDoomSlideElement(item, viewerUserId ?? -1);
		if (eagerVideoLoad) {
			const v0 = slide.querySelector('video.chat-doom-video');
			if (v0 instanceof HTMLVideoElement) {
				v0.preload = 'auto';
				v0.setAttribute('data-chat-doom-warm', 'auto');
			}
		}
		scroller.appendChild(slide);
		bindDoomSlidePlaybackUi(slide);
		const likeBtn = slide.querySelector('button[data-like-button]');
		if (likeBtn instanceof HTMLElement) initLikeButton(likeBtn, item);
	}

	/** Sync slides through anchor first so scroll-to-anchor + playback run without waiting on the full list. */
	for (let si = 0; si <= anchorIndex && si < orderedVideos.length; si += 1) {
		appendDoomSlideForItem(orderedVideos[si], si === anchorIndex);
	}

	messagesEl.appendChild(shell);

	if (typeof opts.applyComposerState === 'function') opts.applyComposerState();
	if (typeof opts.syncChatBrowseViewBodyClass === 'function') opts.syncChatBrowseViewBodyClass();

	const slides = () => Array.from(scroller.querySelectorAll('.chat-doom-slide'));
	/** @type {number} */
	let activeIdx = anchorIndex;
	syncMuteUi();

	/** @type {(() => void) | null} */
	let detachProgressListener = null;

	function bindProgressForSlide(slide, v) {
		const fill = slide.querySelector('[data-chat-doom-progress-fill]');
		if (!(fill instanceof HTMLElement)) return () => {};
		let progressRaf = 0;
		const tick = () => {
			progressRaf = 0;
			const d = v.duration;
			const t = v.currentTime;
			if (!Number.isFinite(d) || d <= 0) {
				fill.style.transform = 'scaleX(0)';
				return;
			}
			const p = Math.min(1, Math.max(0, t / d));
			fill.style.transform = `scaleX(${p})`;
		};
		const scheduleTick = () => {
			if (progressRaf) return;
			progressRaf = window.requestAnimationFrame(tick);
		};
		v.addEventListener('timeupdate', scheduleTick);
		v.addEventListener('loadedmetadata', tick);
		tick();
		return () => {
			if (progressRaf) window.cancelAnimationFrame(progressRaf);
			v.removeEventListener('timeupdate', scheduleTick);
			v.removeEventListener('loadedmetadata', tick);
		};
	}

	function attachActiveProgressListener() {
		if (typeof detachProgressListener === 'function') {
			detachProgressListener();
			detachProgressListener = null;
		}
		const list = slides();
		const slide = list[activeIdx];
		if (!(slide instanceof HTMLElement)) return;
		const v = slide.querySelector('video.chat-doom-video');
		if (!(v instanceof HTMLVideoElement)) return;
		detachProgressListener = bindProgressForSlide(slide, v);
	}

	/** Skip swipe-audio kill only for the initial programmatic anchor scroll (mount). */
	let suppressSwipePauseForAnchorScroll = false;
	/** Ignore scroll-idle resolve until first anchor play starts (avoids refresh double-play). */
	let doomScrollPlaybackReady = false;
	/** In-memory mount tail (slides for first `/api/feed/doom` page) finished — blocks idle API prefetch. */
	let mountInMemoryTailComplete = anchorIndex + 1 >= orderedVideos.length;

	/** Skip pause-on-scroll while we re-snap after appending older slides (same gesture system as swipe intent). */
	let suppressSwipePauseOnAppend = false;

	function scrollToAnchor(onScrolled) {
		const list = slides();
		const el = list[anchorIndex];
		if (!(el instanceof HTMLElement)) {
			if (typeof onScrolled === 'function') onScrolled();
			return;
		}
		suppressSwipePauseForAnchorScroll = true;
		try {
			el.scrollIntoView({ block: 'start', behavior: 'auto' });
		} finally {
			queueMicrotask(() => {
				suppressSwipePauseForAnchorScroll = false;
				if (typeof onScrolled === 'function') onScrolled();
			});
		}
	}

	/**
	 * `scrollTop` that aligns a slide’s top to the scroller snapport top.
	 * Prefer `offsetTop` vs the positioned scroller (see `.chat-doom-scroller { position: relative }`)
	 * so we match the scroll offset model — `getBoundingClientRect` + snap can drift cumulatively after each append.
	 */
	function scrollTopToAlignSlideTop(slide) {
		if (!(slide instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;
		if (slide.parentElement === scroller && slide.offsetParent === scroller) {
			const y = slide.offsetTop;
			return Number.isFinite(y) ? y : null;
		}
		const sr = scroller.getBoundingClientRect();
		const r = slide.getBoundingClientRect();
		const y = scroller.scrollTop + (r.top - sr.top);
		return Number.isFinite(y) ? y : null;
	}

	/**
	 * After appending older slides: re-snap using measured geometry (not idx × height).
	 * Temporarily clears scroll-snap so mandatory snap does not fight programmatic `scrollTop` (stacking offset each load).
	 * @param {HTMLElement | null} lockSlide
	 */
	function stabilizeDoomScrollPosition(lockSlide) {
		if (!(lockSlide instanceof HTMLElement) || !lockSlide.isConnected) return;
		const targetTop = scrollTopToAlignSlideTop(lockSlide);
		if (targetTop == null) return;
		const next = Math.max(0, targetTop);
		if (Math.abs(scroller.scrollTop - next) < 1) return;

		suppressSwipePauseOnAppend = true;
		const prevSnap = scroller.style.scrollSnapType;
		scroller.style.scrollSnapType = 'none';

		const apply = () => {
			const y = scrollTopToAlignSlideTop(lockSlide);
			if (y != null) scroller.scrollTop = Math.max(0, y);
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(() => {
				scroller.style.scrollSnapType = prevSnap;
				queueMicrotask(() => {
					suppressSwipePauseOnAppend = false;
				});
			});
		});
	}

	/**
	 * @param {object} [opts]
	 * @param {number} [opts.exceptIndex] — slide index to leave playing state unchanged (snap target while scrolling)
	 */
	function pauseSlideVideos(opts = {}) {
		const exceptIdx =
			typeof opts.exceptIndex === 'number' && opts.exceptIndex >= 0 ? opts.exceptIndex : -1;
		const list = slides();
		for (let i = 0; i < list.length; i += 1) {
			if (i === exceptIdx) continue;
			const s = list[i];
			const v = s.querySelector('video.chat-doom-video');
			if (!(v instanceof HTMLVideoElement)) continue;
			v.pause();
			rewindDoomSlideVideo(s);
		}
	}

	function pauseAll() {
		const list = slides();
		for (let i = 0; i < list.length; i += 1) {
			const s = list[i];
			const v = s.querySelector('video.chat-doom-video');
			if (!(v instanceof HTMLVideoElement)) continue;
			v.pause();
			if (i !== activeIdx) rewindDoomSlideVideo(s);
		}
	}

	function slideNsfwBlocked(slide) {
		if (!(slide instanceof HTMLElement)) return false;
		const frame = slide.querySelector('.chat-doom-slide-media-frame.nsfw');
		if (!(frame instanceof HTMLElement)) return false;
		try {
			if (document.body.classList.contains('view-nsfw')) return false;
		} catch {
			// ignore
		}
		return !frame.classList.contains('nsfw-revealed');
	}

	/**
	 * @param {object} [playOpts]
	 * @param {boolean} [playOpts.seekToStart] — rewind to 0 before play (new slide); false avoids refresh/snap stutter
	 */
	function playActive(playOpts = {}) {
		const seekToStart = playOpts.seekToStart !== false;
		const list = slides();
		const slide = list[activeIdx];
		if (!(slide instanceof HTMLElement)) return;
		slide.removeAttribute('data-chat-doom-user-paused');
		const v = slide.querySelector('video.chat-doom-video');
		if (!(v instanceof HTMLVideoElement)) return;
		if (seekToStart) {
			try {
				v.currentTime = 0;
			} catch {
				// ignore
			}
		}
		const posterImg = slide.querySelector('img.chat-doom-poster');
		const alreadyRevealed =
			posterImg instanceof HTMLImageElement && posterImg.hidden;
		if (alreadyRevealed) revealDoomSlideVideoPlayback(slide);
		bindDoomVideoRevealWhenFrameReady(v, slide, {
			shouldReveal: () => slides()[activeIdx] === slide
		});

		const applyMuteForSlide = (forceMutedForAutoplay) => {
			/* Obscured NSFW still autoplays (muted); browser policy allows muted autoplay. */
			v.muted = slideNsfwBlocked(slide) || forceMutedForAutoplay ? true : preferMuted;
		};

		const tryPlay = (forceMutedForAutoplay, isAbortRetry = false) => {
			applyMuteForSlide(forceMutedForAutoplay);
			safeMediaPlayWithHandlers(v, {
				onPlayed: () => {
					if (slides()[activeIdx] !== slide) return;
					syncPlayOverlayForSlide(slide);
				},
				onRejected: (err) => {
					if (isMediaPlayAbortError(err)) {
						if (slides()[activeIdx] !== slide) return;
						if (slide.getAttribute('data-chat-doom-user-paused') === '1') return;
						if (!isAbortRetry && v.paused) {
							queueMicrotask(() => {
								if (slides()[activeIdx] !== slide) return;
								if (!v.paused) return;
								tryPlay(forceMutedForAutoplay, true);
							});
						} else if (forceMutedForAutoplay && !preferMuted && !slideNsfwBlocked(slide)) {
							v.muted = false;
							syncMuteUi();
						}
						return;
					}
					/* Only retry muted when autoplay policy blocks sound — not scroll interrupts. */
					if (forceMutedForAutoplay || preferMuted || slideNsfwBlocked(slide)) return;
					if (!isMediaAutoplayBlockedError(err)) return;
					tryPlay(true);
					syncMuteUi();
				}
			});
		};

		tryPlay(false);
		syncMuteUi();
		syncPlayOverlayForSlide(slide);
		attachActiveProgressListener();
	}

	function applyActiveVisual() {
		const list = slides();
		for (let i = 0; i < list.length; i += 1) {
			list[i].classList.toggle('chat-doom-slide--active', i === activeIdx);
		}
	}

	function setActiveIndex(next) {
		const list = slides();
		if (list.length === 0) return;
		const clamped = Math.max(0, Math.min(list.length - 1, next));
		activeIdx = clamped;
		pauseAll();
		applyActiveVisual();
		playActive();
		void prefetchFollowForSlide(activeIdx);
		scheduleLightWarmAdjacentSlides();
		refreshWarmupObservers();
	}

	/**
	 * Which slide’s vertical center is closest to the scroller’s vertical center.
	 * Uses live layout — not `activeIdx`, which only updates after scroll-idle debounce and can be stale mid-gesture.
	 */
	function slideIndexAtScrollerMidpoint() {
		const list = slides();
		if (list.length === 0) return 0;
		const sr = scroller.getBoundingClientRect();
		const mid = sr.top + sr.height * 0.5;
		let best = 0;
		let bestDist = Infinity;
		for (let i = 0; i < list.length; i += 1) {
			const r = list[i].getBoundingClientRect();
			const c = (r.top + r.bottom) / 2;
			const d = Math.abs(c - mid);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	}

	/**
	 * One history entry for doom: pathname tracks the centered clip via `replaceState` only (no stack spam).
	 * Back from `/creations/…` restores that URL for the centered clip.
	 */
	function syncBrowserUrlToCenteredSlide() {
		if (suppressSwipePauseForAnchorScroll) return;
		try {
			if (document.documentElement?.dataset?.chatDoomCommentsOpen === '1') return;
		} catch {
			// ignore
		}
		const list = slides();
		if (list.length === 0) return;
		const idx = slideIndexAtScrollerMidpoint();
		const slide = list[idx];
		if (!(slide instanceof HTMLElement)) return;
		const raw = slide.dataset.creationId;
		const cid = raw != null ? String(raw).trim() : '';
		if (!cid) return;
		try {
			const nextPath = `/chat/c/feed/doom/${encodeURIComponent(cid)}`;
			const u = new URL(window.location.href);
			if (u.pathname === nextPath) return;
			history.replaceState({ prsnChat: true }, '', nextPath + u.search + u.hash);
		} catch {
			// ignore
		}
	}

	function resolveActiveFromScroll() {
		const list = slides();
		if (list.length === 0) return;
		if (!doomScrollPlaybackReady) {
			syncBrowserUrlToCenteredSlide();
			return;
		}
		const best = slideIndexAtScrollerMidpoint();
		const prev = activeIdx;
		activeIdx = best;
		applyActiveVisual();
		const slide = list[activeIdx];
		const v = slide?.querySelector?.('video.chat-doom-video');
		const indexChanged = prev !== activeIdx;
		const alreadyPlaying =
			!indexChanged &&
			v instanceof HTMLVideoElement &&
			!v.paused &&
			v.currentTime > 0;
		if (indexChanged) {
			playActive({ seekToStart: true });
			void prefetchFollowForSlide(activeIdx);
			scheduleLightWarmAdjacentSlides();
			refreshWarmupObservers();
		} else if (!alreadyPlaying) {
			playActive({ seekToStart: false });
		} else if (slide instanceof HTMLElement) {
			syncMuteUi();
			syncPlayOverlayForSlide(slide);
		}
		syncBrowserUrlToCenteredSlide();
	}

	let scrollIdle = 0;
	let doomPagingBusy = false;

	/** Prefetch older doom pages when within this many slides of the loaded tail. */
	const DOOM_FEED_NEAR_END_SLACK = 5;
	/** Geometry fallback for mobile momentum/snap: fetch when within ~2 viewport heights of scroller tail. */
	const DOOM_FEED_NEAR_END_MAX_BOTTOM_PX = 2;
	/** Scroll fallback: debounce near-end checks so mobile scroll does not starve tail fetches. */
	const DOOM_SCROLL_APPEND_DEBOUNCE_MS = 120;

	function distanceToScrollerBottomPx() {
		const remain = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
		return Number.isFinite(remain) ? Math.max(0, remain) : Infinity;
	}

	function isNearEndOfSlideList() {
		const list = slides();
		if (list.length === 0) return false;
		const lastIdx = list.length - 1;
		const midpointIdx = Math.max(
			0,
			Math.min(lastIdx, slideIndexAtScrollerMidpoint())
		);
		/* Short lists used to satisfy `midpoint >= lastIdx - 5` at slide 0 and prefetch on mount. */
		const nearByIndex =
			list.length > DOOM_FEED_NEAR_END_SLACK &&
			midpointIdx >= lastIdx - DOOM_FEED_NEAR_END_SLACK;
		if (nearByIndex) return true;
		const bottomSlackPx = Math.max(
			scroller.clientHeight * DOOM_FEED_NEAR_END_MAX_BOTTOM_PX,
			1
		);
		return distanceToScrollerBottomPx() <= bottomSlackPx;
	}

	/** Pause off-screen clips on scroll; leave the snap-target slide alone so `playActive` is not aborted. */
	function pauseAllVideosOnUserSwipeIntent() {
		if (suppressSwipePauseForAnchorScroll) return;
		if (suppressSwipePauseOnAppend) return;
		pauseSlideVideos({ exceptIndex: slideIndexAtScrollerMidpoint() });
	}

	function scheduleResolveAfterScroll() {
		window.clearTimeout(scrollIdle);
		scrollIdle = window.setTimeout(() => {
			resolveActiveFromScroll();
			void maybeAppendMore(true);
		}, 80);
	}

	/** @type {ReturnType<typeof setTimeout> | null} */
	let doomScrollAppendTimer = null;

	function scheduleNearEndAppendCheckFromScroll() {
		if (doomPagingBusy || !doomHasMore) return;
		if (doomScrollAppendTimer != null) window.clearTimeout(doomScrollAppendTimer);
		doomScrollAppendTimer = window.setTimeout(() => {
			doomScrollAppendTimer = null;
			if (doomPagingBusy || !doomHasMore) return;
			if (!isNearEndOfSlideList()) return;
			void maybeAppendMore(true);
		}, DOOM_SCROLL_APPEND_DEBOUNCE_MS);
	}

	function onScrollerScroll() {
		pauseAllVideosOnUserSwipeIntent();
		scheduleNearEndAppendCheckFromScroll();
		scheduleResolveAfterScroll();
	}
	scroller.addEventListener('scroll', onScrollerScroll, { passive: true });

	scroller.addEventListener('prsn-doom-nsfw-revealed', () => {
		playActive();
		syncPlayOverlayForSlide(slides()[activeIdx]);
	});

	const onNsfwPreferenceChangedForDoom = () => {
		queueMicrotask(() => {
			try {
				if (!document.body.classList.contains('view-nsfw')) {
					for (const s of slides()) {
						const fr = s.querySelector('.chat-doom-slide-media-frame.nsfw');
						if (fr instanceof HTMLElement) fr.classList.remove('nsfw-revealed');
					}
				}
			} catch {
				// ignore
			}
			playActive();
			const cur = slides()[activeIdx];
			if (cur instanceof HTMLElement) syncPlayOverlayForSlide(cur);
		});
	};
	document.addEventListener('nsfw-preference-changed', onNsfwPreferenceChangedForDoom);

	const onScrollerScrollEnd = () => {
		window.clearTimeout(scrollIdle);
		resolveActiveFromScroll();
		void maybeAppendMore(true);
	};
	/* Snap / momentum end (Chromium, Safari 16.4+): URL lags when few intermediate scroll events fire. */
	scroller.addEventListener('scrollend', onScrollerScrollEnd, { passive: true });

	/** First snap after mount — scheduled only after anchor video is playing (see `startDeferredDoomHeavyWork`). */
	let mountDoomUrlSyncTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

	/** Touch/wheel often fire before `scroll` — pause immediately so audio cannot leak into the next clip. */
	let touchSwipeStartY = /** @type {number | null} */ (null);
	scroller.addEventListener(
		'touchstart',
		(ev) => {
			touchSwipeStartY = ev.touches[0]?.clientY ?? null;
		},
		{ passive: true }
	);
	scroller.addEventListener(
		'touchmove',
		(ev) => {
			if (suppressSwipePauseForAnchorScroll) return;
			const y = ev.touches[0]?.clientY;
			if (touchSwipeStartY == null || y == null) return;
			if (Math.abs(y - touchSwipeStartY) <= 12) return;
			pauseAllVideosOnUserSwipeIntent();
			const delta = y - touchSwipeStartY;
			if (delta < 0) warmSlideOnSwipeIntent(activeIdx + 1);
			else if (delta > 0) warmSlideOnSwipeIntent(activeIdx - 1);
		},
		{ passive: true }
	);
	scroller.addEventListener(
		'touchend',
		() => {
			touchSwipeStartY = null;
		},
		{ passive: true }
	);
	scroller.addEventListener(
		'wheel',
		(ev) => {
			pauseAllVideosOnUserSwipeIntent();
			if (Math.abs(ev.deltaY) < 4) return;
			if (ev.deltaY > 0) warmSlideOnSwipeIntent(activeIdx + 1);
			else warmSlideOnSwipeIntent(activeIdx - 1);
		},
		{ passive: true }
	);

	function goToAdjacentSlide(delta) {
		const list = slides();
		if (list.length === 0) return;
		const next = Math.max(0, Math.min(list.length - 1, activeIdx + delta));
		const el = list[next];
		if (!(el instanceof HTMLElement)) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function onDoomMediaClick(ev) {
		const t = ev.target;
		if (!(t instanceof Element)) return;
		const media = t.closest('[data-chat-doom-slide-media]');
		if (!(media instanceof HTMLElement)) return;
		if (t.closest('button, a')) return;
		const slide = media.closest('.chat-doom-slide');
		const v = slide?.querySelector('video.chat-doom-video');
		if (!(v instanceof HTMLVideoElement) || !(slide instanceof HTMLElement)) return;
		ev.preventDefault();
		if (v.paused) {
			safeMediaPlay(v);
		} else {
			slide.setAttribute('data-chat-doom-user-paused', '1');
			v.pause();
			flashPauseHint(slide);
		}
	}
	scroller.addEventListener('click', onDoomMediaClick);

	function onDoomKeydown(ev) {
		if (ev.defaultPrevented) return;
		const ae = document.activeElement;
		if (
			ae instanceof HTMLInputElement ||
			ae instanceof HTMLTextAreaElement ||
			(ae instanceof HTMLElement && ae.isContentEditable)
		) {
			return;
		}
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			goToAdjacentSlide(1);
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			goToAdjacentSlide(-1);
		}
	}
	window.addEventListener('keydown', onDoomKeydown);

	/** Light metadata warm for slide N±1 after active clip is stable. */
	function scheduleLightWarmAdjacentSlides() {
		const run = () => {
			if (!doomMountAlive) return;
			warmAdjacentSlides('metadata');
		};
		if (typeof requestIdleCallback !== 'undefined') {
			requestIdleCallback(run, { timeout: 2000 });
		} else {
			window.setTimeout(run, 120);
		}
	}

	/**
	 * @param {'metadata' | 'auto'} level
	 */
	function warmAdjacentSlides(level) {
		const list = slides();
		const next = list[activeIdx + 1];
		const prev = list[activeIdx - 1];
		if (next instanceof HTMLElement) warmDoomSlideVideo(next, level);
		if (prev instanceof HTMLElement) warmDoomSlideVideo(prev, level);
	}

	/** Full buffer warm — deferred so swipe/scroll handlers stay light. */
	function scheduleAggressiveWarmSlide(slide) {
		if (!(slide instanceof HTMLElement)) return;
		queueMicrotask(() => {
			requestAnimationFrame(() => {
				if (!doomMountAlive) return;
				warmDoomSlideVideo(slide, 'auto');
			});
		});
	}

	/** @param {number} targetIdx */
	function warmSlideOnSwipeIntent(targetIdx) {
		const list = slides();
		if (targetIdx < 0 || targetIdx >= list.length) return;
		const slide = list[targetIdx];
		if (slide instanceof HTMLElement) scheduleAggressiveWarmSlide(slide);
	}

	/** Observe N±1; promote to `auto` when the slide enters the snapport. */
	let warmupIo = /** @type {IntersectionObserver | null} */ (null);

	function refreshWarmupObservers() {
		if (!warmupIo) {
			warmupIo = new IntersectionObserver(
				(entries) => {
					for (const e of entries) {
						if (!e.isIntersecting) continue;
						if (e.intersectionRatio < 0.1) continue;
						if (e.target instanceof HTMLElement) scheduleAggressiveWarmSlide(e.target);
					}
				},
				{ root: scroller, threshold: [0, 0.1, 0.2] }
			);
		}
		warmupIo.disconnect();
		const list = slides();
		const next = list[activeIdx + 1];
		const prev = list[activeIdx - 1];
		if (next instanceof HTMLElement) warmupIo.observe(next);
		if (prev instanceof HTMLElement) warmupIo.observe(prev);
	}

	/** Debounce IO: layout thrashing + wide rootMargin can enqueue many callbacks in bursts. */
	const DOOM_IO_APPEND_DEBOUNCE_MS = 280;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let doomIoAppendTimer = null;
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting || e.target !== scroller.lastElementChild) continue;
				if (doomPagingBusy || !doomHasMore) continue;
				if (doomIoAppendTimer != null) window.clearTimeout(doomIoAppendTimer);
				doomIoAppendTimer = window.setTimeout(() => {
					doomIoAppendTimer = null;
					if (doomPagingBusy || !doomHasMore) return;
					void maybeAppendMore(true);
				}, DOOM_IO_APPEND_DEBOUNCE_MS);
			}
		},
		{ root: scroller, rootMargin: '280px 0px', threshold: 0 }
	);
	const obsSlides = slides();
	if (obsSlides.length > 0) io.observe(obsSlides[obsSlides.length - 1]);

	function updateIoTarget() {
		io.disconnect();
		const list = slides();
		if (list.length > 0) io.observe(list[list.length - 1]);
		refreshWarmupObservers();
	}

	/** @returns {Promise<boolean>} whether any new video slides were appended */
	async function appendOlderDoomPage() {
		const r = await doomPager.fetchOlderPage();
		const pageItems = Array.isArray(r.pageItems) ? r.pageItems : [];
		doomHasMore = Boolean(r.hasMore);

		const frag = document.createDocumentFragment();
		const pending = [];
		for (const it of pageItems) {
			const key = getChatFeedItemKey(it);
			if (videoByKey.has(key)) continue;
			videoByKey.set(key, it);
			const slide = createDoomSlideElement(it, viewerUserId ?? -1, { backgroundLoad: true });
			frag.appendChild(slide);
			pending.push({ slide, item: it });
		}

		const appended = pending.length > 0;
		if (appended) {
			scroller.appendChild(frag);
			for (const { slide, item } of pending) {
				bindDoomSlidePlaybackUi(slide);
				const likeBtn = slide.querySelector('button[data-like-button]');
				if (likeBtn instanceof HTMLElement) initLikeButton(likeBtn, item);
			}
			updateIoTarget();
			const listNow = slides();
			const li = Math.min(
				Math.max(slideIndexAtScrollerMidpoint(), 0),
				Math.max(0, listNow.length - 1)
			);
			const anchorNow = listNow[li];
			if (anchorNow instanceof HTMLElement) stabilizeDoomScrollPosition(anchorNow);
		}
		return appended;
	}

	/**
	 * @param {boolean} [requireNearEnd] — when false, fetch whenever invoked (e.g. last slide observer).
	 */
	async function maybeAppendMore(requireNearEnd = true) {
		if (!doomHasMore || doomPagingBusy) return;
		if (!mountInMemoryTailComplete || !doomScrollPlaybackReady) return;
		const list = slides();
		if (list.length === 0) return;
		if (requireNearEnd && !isNearEndOfSlideList()) return;

		doomPagingBusy = true;
		try {
			await appendOlderDoomPage();
		} catch {
			doomHasMore = false;
		} finally {
			doomPagingBusy = false;
		}
	}

	/** Small batches + idle yield: a dozen videos × metadata + eager posters in one frame was janking the anchor decode. */
	const DOOM_TAIL_CHUNK = 4;
	let tailSlideIdx = anchorIndex + 1;

	function scheduleNextTailChunk() {
		const run = () => {
			if (!doomMountAlive) return;
			requestAnimationFrame(appendTailSlidesChunk);
		};
		if (typeof requestIdleCallback !== 'undefined') {
			requestIdleCallback(run, { timeout: 900 });
		} else {
			window.setTimeout(run, 48);
		}
	}

	function appendTailSlidesChunk() {
		const end = Math.min(tailSlideIdx + DOOM_TAIL_CHUNK, orderedVideos.length);

		const frag = document.createDocumentFragment();
		const batch = [];
		for (; tailSlideIdx < end; tailSlideIdx += 1) {
			const item = orderedVideos[tailSlideIdx];
			const slide = createDoomSlideElement(item, viewerUserId ?? -1, { backgroundLoad: true });
			frag.appendChild(slide);
			batch.push({ slide, item });
		}
		scroller.appendChild(frag);
		for (const { slide, item } of batch) {
			bindDoomSlidePlaybackUi(slide);
			const likeBtn = slide.querySelector('button[data-like-button]');
			if (likeBtn instanceof HTMLElement) initLikeButton(likeBtn, item);
		}
		updateIoTarget();
		const tailDone = tailSlideIdx >= orderedVideos.length;
		if (tailDone) {
			mountInMemoryTailComplete = true;
			const listAfterChunk = slides();
			const idxChunk = Math.min(
				Math.max(slideIndexAtScrollerMidpoint(), 0),
				Math.max(0, listAfterChunk.length - 1)
			);
			const anchorChunk = listAfterChunk[idxChunk];
			if (anchorChunk instanceof HTMLElement) stabilizeDoomScrollPosition(anchorChunk);
		} else {
			scheduleNextTailChunk();
		}
	}

	/**
	 * After anchor `play()` + first frames: tail slides, idle page append, and follow prefetch
	 * compete with the first clip on the network — defer until `playing` so the first video feels instant.
	 */
	function waitForAnchorVideoPlayingOrTimeout() {
		return new Promise((resolve) => {
			if (!doomMountAlive) {
				resolve();
				return;
			}
			const list = slides();
			const slide = list[anchorIndex];
			const v = slide?.querySelector?.('video.chat-doom-video');
			if (!(v instanceof HTMLVideoElement)) {
				resolve();
				return;
			}
			if (!v.paused && v.readyState >= 2) {
				resolve();
				return;
			}
			let settled = false;
			const finish = () => {
				if (settled || !doomMountAlive) return;
				settled = true;
				window.clearTimeout(timer);
				v.removeEventListener('playing', onPlaying);
				v.removeEventListener('error', onErr);
				resolve();
			};
			const timer = window.setTimeout(finish, 4500);
			const onPlaying = () => finish();
			const onErr = () => finish();
			v.addEventListener('playing', onPlaying, { once: true });
			v.addEventListener('error', onErr, { once: true });
		});
	}

	async function startDeferredDoomHeavyWork() {
		await waitForAnchorVideoPlayingOrTimeout();
		if (!doomMountAlive) return;
		void prefetchFollowForSlide(activeIdx);
		mountDoomUrlSyncTimer = window.setTimeout(() => {
			mountDoomUrlSyncTimer = null;
			syncBrowserUrlToCenteredSlide();
		}, 250);
		scheduleLightWarmAdjacentSlides();
		refreshWarmupObservers();
		if (anchorIndex + 1 < orderedVideos.length) {
			scheduleNextTailChunk();
		}
	}

	/** @type {Map<number, { viewer_follows?: boolean, is_self?: boolean }>} */
	const followCache = new Map();

	async function prefetchFollowForSlide(idx) {
		const list = slides();
		const slide = list[idx];
		if (!(slide instanceof HTMLElement)) return;
		const uidRaw = slide.dataset.userId;
		const uid = Number(uidRaw);
		if (!Number.isFinite(uid) || uid <= 0) return;
		if (viewerUserId != null && uid === viewerUserId) return;
		if (followCache.has(uid)) {
			applyFollowUi(slide, followCache.get(uid));
			return;
		}
		try {
			const res = await fetchJsonWithStatusDeduped(
				`/api/users/${encodeURIComponent(String(uid))}/profile`,
				{ credentials: 'include' },
				{ windowMs: 60000 }
			);
			if (!res.ok || !res.data) {
				for (const s of slides()) {
					if (Number(s.dataset.userId) === uid) applyFollowUi(s, undefined);
				}
				return;
			}
			const payload = {
				viewer_follows: Boolean(res.data.viewer_follows),
				is_self: Boolean(res.data.is_self)
			};
			followCache.set(uid, payload);
			for (const s of slides()) {
				if (Number(s.dataset.userId) === uid) applyFollowUi(s, payload);
			}
		} catch {
			for (const s of slides()) {
				if (Number(s.dataset.userId) === uid) applyFollowUi(s, undefined);
			}
		}
	}

	/**
	 * @param {HTMLElement} slide
	 * @param {{ viewer_follows?: boolean, is_self?: boolean } | undefined} data — undefined = optimistic “show Follow” (fetch failed)
	 */
	function applyFollowUi(slide, data) {
		const slot = slide.querySelector('[data-chat-doom-follow-slot]');
		const btn = slide.querySelector('[data-chat-doom-follow]');
		if (!(btn instanceof HTMLElement)) return;

		const hideFollow = Boolean(data?.is_self || data?.viewer_follows);

		if (hideFollow) {
			btn.hidden = true;
			if (slot instanceof HTMLElement) slot.hidden = true;
			return;
		}

		btn.hidden = false;
		if (slot instanceof HTMLElement) {
			slot.hidden = false;
			slot.removeAttribute('aria-hidden');
		}
	}

	function bindFollowClick(ev) {
		const t = ev.target;
		if (!(t instanceof Element)) return;
		const btn = t.closest('[data-chat-doom-follow]');
		if (!(btn instanceof HTMLButtonElement)) return;
		const uid = Number(btn.dataset.followUserId);
		if (!Number.isFinite(uid) || uid <= 0) return;
		if (btn.dataset.followBusy === '1') return;
		btn.dataset.followBusy = '1';
		fetch(`/api/users/${encodeURIComponent(String(uid))}/follow`, {
			method: 'POST',
			credentials: 'include'
		})
			.then((res) => {
				if (!res.ok) return;
				followCache.set(uid, { viewer_follows: true });
				for (const s of slides()) {
					if (Number(s.dataset.userId) === uid) {
						const b = s.querySelector('[data-chat-doom-follow]');
						if (b instanceof HTMLElement) b.hidden = true;
						const slot = s.querySelector('[data-chat-doom-follow-slot]');
						if (slot instanceof HTMLElement) slot.hidden = true;
					}
				}
			})
			.finally(() => {
				delete btn.dataset.followBusy;
			});
	}

	scroller.addEventListener('click', bindFollowClick);

	/** Same minted URL as app-modal-share (`POST /api/create/images/:id/share` → `sh.parascene.com/s/...`). */
	async function resolveParasceneShareUrl(creationId) {
		const id = String(creationId || '').trim();
		if (!id) return null;
		try {
			const res = await fetch(`/api/create/images/${encodeURIComponent(id)}/share`, {
				method: 'POST',
				credentials: 'include'
			});
			if (!res.ok) return null;
			const data = await res.json().catch(() => null);
			const u = typeof data?.url === 'string' ? data.url.trim() : '';
			return u || null;
		} catch {
			return null;
		}
	}

	function onShareClick(ev) {
		const t = ev.target;
		if (!(t instanceof Element)) return;
		const btn = t.closest('[data-chat-doom-share]');
		if (!(btn instanceof HTMLElement)) return;
		const slide = btn.closest('.chat-doom-slide');
		const cid = slide instanceof HTMLElement ? slide.dataset.creationId : '';
		if (!cid) return;
		ev.preventDefault();
		ev.stopPropagation();
		if (btn.dataset.shareBusy === '1') return;
		btn.dataset.shareBusy = '1';
		const fallbackUrl = `${window.location.origin}/creations/${encodeURIComponent(cid)}`;
		void (async () => {
			try {
				const minted = await resolveParasceneShareUrl(cid);
				const url = minted || fallbackUrl;
				if (navigator.share) {
					await navigator.share({ url }).catch(() => {
						copyUrl(url);
					});
				} else {
					copyUrl(url);
				}
			} finally {
				delete btn.dataset.shareBusy;
			}
		})();
	}

	function copyUrl(url) {
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(url).catch(() => {});
		}
	}

	scroller.addEventListener('click', onShareClick);

	if (backBtn instanceof HTMLElement) {
		backBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			if (typeof opts.navigateToFeedChannel === 'function') {
				opts.navigateToFeedChannel();
			} else {
				window.location.href = '/chat/c/feed';
			}
		});
	}

	if (muteBtn instanceof HTMLElement) {
		muteBtn.addEventListener('click', () => {
			const list = slides();
			const slide = list[activeIdx];
			const v = slide?.querySelector?.('video.chat-doom-video');
			if (!(slide instanceof HTMLElement) || !(v instanceof HTMLVideoElement)) return;
			if (slideNsfwBlocked(slide)) return;

			preferMuted = !v.muted;
			try {
				sessionStorage.setItem('chatDoomPreferMuted', preferMuted ? '1' : '0');
			} catch {
				// ignore
			}
			v.muted = preferMuted;
			syncMuteUi();
			if (!preferMuted) {
				safeMediaPlayWithHandlers(v, {
					onRejected: (err) => {
						if (isMediaAutoplayBlockedError(err)) {
							v.muted = true;
							safeMediaPlay(v);
						}
						syncMuteUi();
					}
				});
			}
		});
	}

	applyActiveVisual();
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			scrollToAnchor(() => {
				playActive({ seekToStart: true });
				doomScrollPlaybackReady = true;
				void startDeferredDoomHeavyWork();
			});
		});
	});

	if (window.location.hash === '#comments') {
		queueMicrotask(() => {
			if (!doomMountAlive) return;
			const list = slides();
			const slide = list[activeIdx];
			const a = slide?.querySelector?.('[data-chat-doom-comments]');
			let commentCountLabel = '';
			let detailHref = `/creations/${encodeURIComponent(String(startCreationId))}#comments`;
			if (a instanceof HTMLAnchorElement) {
				const h = (a.getAttribute('href') || '').trim();
				if (h) detailHref = h;
				const ce = a.querySelector('.chat-doom-rail-count');
				if (ce && typeof ce.textContent === 'string') commentCountLabel = ce.textContent.trim();
			}
			openDoomCommentsPopover({ commentCountLabel, detailHref });
		});
	}

	activeTeardown = () => {
		doomMountAlive = false;
		destroyDoomCommentsPopover();
		if (typeof detachProgressListener === 'function') {
			detachProgressListener();
			detachProgressListener = null;
		}
		if (pauseFlashTimer) window.clearTimeout(pauseFlashTimer);
		if (doomIoAppendTimer != null) {
			window.clearTimeout(doomIoAppendTimer);
			doomIoAppendTimer = null;
		}
		if (doomScrollAppendTimer != null) {
			window.clearTimeout(doomScrollAppendTimer);
			doomScrollAppendTimer = null;
		}
		if (mountDoomUrlSyncTimer != null) {
			window.clearTimeout(mountDoomUrlSyncTimer);
			mountDoomUrlSyncTimer = null;
		}
		scroller.removeEventListener('scroll', onScrollerScroll);
		scroller.removeEventListener('scrollend', onScrollerScrollEnd);
		document.removeEventListener('nsfw-preference-changed', onNsfwPreferenceChangedForDoom);
		io.disconnect();
		if (warmupIo) {
			warmupIo.disconnect();
			warmupIo = null;
		}
		scroller.removeEventListener('click', bindFollowClick);
		scroller.removeEventListener('click', onShareClick);
		scroller.removeEventListener('click', onDoomMediaClick);
		window.removeEventListener('keydown', onDoomKeydown);
		window.clearTimeout(scrollIdle);
		messagesEl.classList.remove('chat-page-messages--doom-host');
	};
}
