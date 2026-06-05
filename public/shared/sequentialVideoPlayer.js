import {
	attachMediaAudioLeveling,
	primeMediaElementForAudioLeveling
} from './mediaAudioLeveling.js';

/**
 * @typedef {{ url: string, width?: number, height?: number, sourceId?: number }} SequentialVideoSlide
 */

/**
 * @param {HTMLVideoElement} video
 * @returns {{ width: number, height: number }}
 */
function videoIntrinsicSize(video) {
	if (!(video instanceof HTMLVideoElement)) return { width: 0, height: 0 };
	const w = Number(video.videoWidth);
	const h = Number(video.videoHeight);
	if (w > 0 && h > 0) return { width: w, height: h };
	const dw = Number(video.dataset.videoWidth);
	const dh = Number(video.dataset.videoHeight);
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
function applySlotAspect(slot, width, height) {
	const w = Number(width);
	const h = Number(height);
	if (!(slot instanceof HTMLElement) || !(w > 0 && h > 0)) return;
	slot.style.setProperty('--sequential-video-ar', `${w} / ${h}`);
	slot.classList.add('sequential-video-slot--sized');
}

/**
 * @param {HTMLElement} container
 * @param {SequentialVideoSlide[]} slides
 * @param {{
 *   startIndex?: number,
 *   loopPlaylist?: boolean,
 *   autoAdvanceOnEnded?: boolean,
 *   muted?: boolean,
 *   videoClass?: string,
 *   slotClass?: string,
 *   onIndexChange?: (index: number, slide: SequentialVideoSlide) => void
 * }} [options]
 */
export function mountSequentialVideoPlayer(container, slides, options = {}) {
	const rawSlides = Array.isArray(slides) ? slides : [];
	const normalized = rawSlides
		.map((s) => {
			const w = Number(s?.width);
			const h = Number(s?.height);
			return {
				url: String(s?.url || '').trim(),
				sourceId: s?.sourceId != null ? Number(s.sourceId) : undefined,
				width: Number.isFinite(w) && w > 0 ? w : 0,
				height: Number.isFinite(h) && h > 0 ? h : 0,
			};
		})
		.filter((s) => s.url);
	if (!(container instanceof HTMLElement) || normalized.length === 0) {
		return null;
	}

	const loopPlaylist = options.loopPlaylist !== false;
	const autoAdvanceOnEnded = options.autoAdvanceOnEnded !== false;
	const startMuted = options.muted === true;
	const videoClass = typeof options.videoClass === 'string' && options.videoClass.trim()
		? options.videoClass.trim()
		: 'sequential-video-player-video';
	const slotClass = typeof options.slotClass === 'string' && options.slotClass.trim()
		? options.slotClass.trim()
		: 'sequential-video-player-slot';
	const onIndexChange = typeof options.onIndexChange === 'function' ? options.onIndexChange : null;
	const len = normalized.length;

	let startIndex = Number(options.startIndex);
	if (!Number.isFinite(startIndex)) startIndex = 0;
	startIndex = Math.max(0, Math.min(len - 1, startIndex));

	const slot = document.createElement('div');
	slot.className = slotClass;
	slot.style.setProperty('--sequential-video-ar', '16 / 9');

	const placeholder = document.createElement('div');
	placeholder.className = 'sequential-video-player-placeholder skeleton';
	placeholder.setAttribute('role', 'status');
	placeholder.setAttribute('aria-live', 'polite');
	placeholder.setAttribute('aria-label', 'Loading video');

	let placeholderHidden = false;
	const hidePlaceholder = () => {
		if (placeholderHidden) return;
		placeholderHidden = true;
		if (placeholder.parentNode) placeholder.remove();
	};

	const revealVideo = (video) => {
		hidePlaceholder();
		if (video instanceof HTMLVideoElement) {
			video.classList.remove('sequential-video-player-video--pending');
		}
		slot.classList.add('sequential-video-slot--playing');
	};

	const videos = [0, 1].map(() => {
		const video = document.createElement('video');
		video.className = `${videoClass} sequential-video-player-video`;
		video.controls = false;
		video.removeAttribute('controls');
		video.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
		video.disablePictureInPicture = true;
		video.playsInline = true;
		video.preload = 'auto';
		video.muted = startMuted;
		video.defaultMuted = startMuted;
		primeMediaElementForAudioLeveling(video);
		attachMediaAudioLeveling(video);
		video.classList.add('sequential-video-player-video--pending');
		slot.appendChild(video);
		return video;
	});
	slot.appendChild(placeholder);

	const playOverlay = document.createElement('div');
	playOverlay.className = 'chat-doom-play-overlay sequential-video-player-play-overlay';
	playOverlay.setAttribute('data-sequential-video-play-overlay', '1');
	playOverlay.hidden = true;
	playOverlay.setAttribute('aria-hidden', 'true');
	playOverlay.innerHTML =
		`<div class="chat-doom-play-overlay-inner" data-sequential-video-play-icon>` +
		`<svg class="chat-doom-play-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>` +
		`</div>` +
		`<div class="chat-doom-play-overlay-inner chat-doom-play-overlay-inner--pausehint" hidden data-sequential-video-pause-hint>` +
		`<svg class="chat-doom-pause-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"></path></svg>` +
		`</div>`;
	slot.appendChild(playOverlay);

	const playOverlayPlayIcon = playOverlay.querySelector('[data-sequential-video-play-icon]');
	const playOverlayPauseHint = playOverlay.querySelector('[data-sequential-video-pause-hint]');

	container.appendChild(slot);

	let activeIndex = startIndex;
	let activePlayer = 0;
	let advanceLock = false;
	let tornDown = false;
	let userPaused = false;
	let slotHovered = false;

	const syncPlayPauseOverlay = () => {
		if (!placeholderHidden || advanceLock || tornDown) {
			playOverlay.hidden = true;
			playOverlay.setAttribute('aria-hidden', 'true');
			return;
		}
		const video = videos[activePlayer];
		if (!(video instanceof HTMLVideoElement)) return;
		if (video.paused) {
			playOverlay.hidden = false;
			playOverlay.setAttribute('aria-hidden', 'false');
			if (playOverlayPlayIcon instanceof HTMLElement) playOverlayPlayIcon.hidden = false;
			if (playOverlayPauseHint instanceof HTMLElement) playOverlayPauseHint.hidden = true;
			return;
		}
		if (slotHovered) {
			playOverlay.hidden = false;
			playOverlay.setAttribute('aria-hidden', 'false');
			if (playOverlayPlayIcon instanceof HTMLElement) playOverlayPlayIcon.hidden = true;
			if (playOverlayPauseHint instanceof HTMLElement) playOverlayPauseHint.hidden = false;
			return;
		}
		playOverlay.hidden = true;
		playOverlay.setAttribute('aria-hidden', 'true');
	};

	const onSlotClick = (e) => {
		if (!(e.target instanceof Element)) return;
		if (!placeholderHidden || advanceLock || tornDown) return;
		const video = videos[activePlayer];
		if (!(video instanceof HTMLVideoElement)) return;
		e.preventDefault();
		e.stopPropagation();
		if (video.paused) {
			userPaused = false;
			void tryPlayVideo(video).then(() => syncPlayPauseOverlay());
		} else {
			userPaused = true;
			video.pause();
			syncPlayPauseOverlay();
		}
	};

	const onSlotMouseEnter = () => {
		slotHovered = true;
		syncPlayPauseOverlay();
	};

	const onSlotMouseLeave = () => {
		slotHovered = false;
		syncPlayPauseOverlay();
	};

	slot.addEventListener('click', onSlotClick);
	slot.addEventListener('mouseenter', onSlotMouseEnter);
	slot.addEventListener('mouseleave', onSlotMouseLeave);

	const playerLoaded = [
		{ slideIdx: -1, url: '' },
		{ slideIdx: -1, url: '' },
	];

	const slideIndexWrapped = (idx) => ((idx % len) + len) % len;

	const slideUrlAt = (idx) => {
		const slide = normalized[slideIndexWrapped(idx)];
		return slide?.url || '';
	};

	const setActivePlayerVisible = (which) => {
		videos.forEach((v, i) => {
			v.classList.toggle('is-active', i === which);
		});
	};

	const syncVideoSlotAspect = (video, slide) => {
		if (!(video instanceof HTMLVideoElement)) return;
		const intrinsic = videoIntrinsicSize(video);
		if (intrinsic.width > 0 && intrinsic.height > 0) {
			applySlotAspect(slot, intrinsic.width, intrinsic.height);
			return;
		}
		const w = Number(slide?.width);
		const h = Number(slide?.height);
		if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
			applySlotAspect(slot, w, h);
		}
	};

	const applySlideAspectToSlot = (slide) => {
		if (!slide) return;
		const w = Number(slide.width);
		const h = Number(slide.height);
		if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
			applySlotAspect(slot, w, h);
		}
	};

	const isPlayerReadyForSlide = (playerIdx, slideIdx) => {
		const video = videos[playerIdx];
		if (!(video instanceof HTMLVideoElement)) return false;
		const idx = slideIndexWrapped(slideIdx);
		const url = slideUrlAt(idx);
		const st = playerLoaded[playerIdx];
		return (
			st.url === url &&
			st.slideIdx === idx &&
			video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
		);
	};

	const loadVideoSrc = (video, url) =>
		new Promise((resolve) => {
			const onMeta = () => syncVideoSlotAspect(video, normalized[activeIndex]);
			const done = () => {
				video.removeEventListener('canplay', done);
				video.removeEventListener('loadeddata', done);
				video.removeEventListener('loadedmetadata', onMeta);
				video.removeEventListener('error', done);
				resolve();
			};
			video.addEventListener('canplay', done, { once: true });
			video.addEventListener('loadeddata', done, { once: true });
			video.addEventListener('loadedmetadata', onMeta, { once: true });
			video.addEventListener('error', done, { once: true });
			video.pause();
			video.loop = false;
			video.removeAttribute('loop');
			video.controls = false;
			video.removeAttribute('controls');
			video.src = url;
			try {
				video.load();
			} catch {
				done();
			}
			if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
				done();
				return;
			}
			window.setTimeout(done, 8000);
		});

	const ensurePlayerLoaded = async (playerIdx, slideIdx, opts = {}) => {
		const video = videos[playerIdx];
		if (!(video instanceof HTMLVideoElement)) return false;
		const idx = slideIndexWrapped(slideIdx);
		const url = slideUrlAt(idx);
		if (!url) return false;
		if (!opts.force && isPlayerReadyForSlide(playerIdx, idx)) {
			return true;
		}
		const slide = normalized[idx];
		if (slide?.width > 0 && slide?.height > 0) {
			video.dataset.videoWidth = String(slide.width);
			video.dataset.videoHeight = String(slide.height);
		}
		await loadVideoSrc(video, url);
		playerLoaded[playerIdx] = { slideIdx: idx, url };
		return true;
	};

	const preloadNextSlide = () => {
		if (len <= 1 || tornDown) return;
		const nextIdx = loopPlaylist ? (activeIndex + 1) % len : Math.min(activeIndex + 1, len - 1);
		const bufPlayer = 1 - activePlayer;
		void ensurePlayerLoaded(bufPlayer, nextIdx);
	};

	const tryPlayVideo = async (video) => {
		try {
			await video.play();
			return true;
		} catch {
			video.muted = true;
			try {
				await video.play();
				return true;
			} catch {
				return false;
			}
		}
	};

	const attachEarlyPreload = (video) => {
		if (len <= 1 || tornDown || !(video instanceof HTMLVideoElement)) return;
		const onTimeUpdate = () => {
			const d = video.duration;
			const remain = d - video.currentTime;
			if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(remain)) return;
			if (remain > 2.5) return;
			video.removeEventListener('timeupdate', onTimeUpdate);
			preloadNextSlide();
		};
		video.addEventListener('timeupdate', onTimeUpdate);
	};

	const playVideoInitial = async (video, slide) => {
		if (!(video instanceof HTMLVideoElement)) return;
		syncVideoSlotAspect(video, slide);
		video.classList.add('sequential-video-player-video--pending');
		let revealed = false;
		const revealOnce = () => {
			if (revealed) return;
			revealed = true;
			revealVideo(video);
			syncPlayPauseOverlay();
		};
		video.addEventListener('playing', revealOnce, { once: true });
		video.addEventListener('loadeddata', revealOnce, { once: true });
		video.addEventListener('error', revealOnce, { once: true });
		await tryPlayVideo(video);
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			revealOnce();
		}
		syncPlayPauseOverlay();
		attachEarlyPreload(video);
	};

	const crossfadeToPlayer = async (incomingPlayer, outgoingPlayer, slide) => {
		const incoming = videos[incomingPlayer];
		const outgoing = videos[outgoingPlayer];
		if (!(incoming instanceof HTMLVideoElement)) return;

		incoming.classList.remove('sequential-video-player-video--pending');
		syncVideoSlotAspect(incoming, slide);
		incoming.currentTime = 0;

		incoming.classList.add('is-active');
		incoming.style.zIndex = '2';
		if (outgoing instanceof HTMLVideoElement) {
			outgoing.classList.add('is-active');
			outgoing.style.zIndex = '1';
		}

		let handedOff = false;
		const handoff = () => {
			if (handedOff) return;
			handedOff = true;
			if (outgoing instanceof HTMLVideoElement) {
				outgoing.pause();
				outgoing.classList.remove('is-active');
				outgoing.style.removeProperty('z-index');
			}
			incoming.style.removeProperty('z-index');
			setActivePlayerVisible(incomingPlayer);
			slot.classList.add('sequential-video-slot--playing');
			syncPlayPauseOverlay();
		};

		incoming.addEventListener('playing', handoff, { once: true });
		incoming.addEventListener(
			'timeupdate',
			() => {
				if (incoming.currentTime > 0.05) handoff();
			},
			{ once: true }
		);

		await tryPlayVideo(incoming);
		if (!incoming.paused || incoming.currentTime > 0) {
			handoff();
		}
		attachEarlyPreload(incoming);
	};

	const notifyIndexChange = () => {
		if (!onIndexChange) return;
		const slide = normalized[activeIndex];
		if (slide) onIndexChange(activeIndex, slide);
	};

	const applyIndex = async (nextIdx, opts = {}) => {
		const autoplay = opts.autoplay !== false;
		if (advanceLock || tornDown) return;
		advanceLock = true;
		try {
			const idx = loopPlaylist
				? slideIndexWrapped(nextIdx)
				: Math.max(0, Math.min(len - 1, nextIdx));
			if (!loopPlaylist && idx === activeIndex && opts.force !== true) return;

			const incomingPlayer = len > 1 ? 1 - activePlayer : 0;
			const outgoingPlayer = activePlayer;
			const isFirst = !placeholderHidden;

			if (isFirst) {
				applySlideAspectToSlot(normalized[idx]);
			}

			await ensurePlayerLoaded(incomingPlayer, idx, { force: opts.force });

			activeIndex = idx;

			const incomingVideo = videos[incomingPlayer];
			const outgoingVideo = videos[outgoingPlayer];
			const slide = normalized[idx];

			if (!autoplay) {
				setActivePlayerVisible(incomingPlayer);
				activePlayer = incomingPlayer;
				preloadNextSlide();
				notifyIndexChange();
				return;
			}

			if (isFirst) {
				setActivePlayerVisible(incomingPlayer);
				await playVideoInitial(incomingVideo, slide);
			} else {
				await crossfadeToPlayer(incomingPlayer, outgoingPlayer, slide);
			}

			activePlayer = incomingPlayer;
			preloadNextSlide();
			notifyIndexChange();
		} finally {
			advanceLock = false;
		}
	};

	const onVideoEnded = (e) => {
		if (!autoAdvanceOnEnded || advanceLock || tornDown) return;
		if (e?.target !== videos[activePlayer]) return;
		if (!loopPlaylist && activeIndex >= len - 1) return;
		void applyIndex(activeIndex + 1, { autoplay: true });
	};

	videos.forEach((v) => {
		v.addEventListener('ended', onVideoEnded);
		v.addEventListener('play', () => {
			userPaused = false;
			syncPlayPauseOverlay();
		});
		v.addEventListener('pause', () => {
			syncPlayPauseOverlay();
		});
	});

	setActivePlayerVisible(0);
	applySlideAspectToSlot(normalized[startIndex]);
	void applyIndex(startIndex, { autoplay: true, force: true });

	return {
		teardown() {
			tornDown = true;
			slot.removeEventListener('click', onSlotClick);
			slot.removeEventListener('mouseenter', onSlotMouseEnter);
			slot.removeEventListener('mouseleave', onSlotMouseLeave);
			videos.forEach((v) => {
				v.removeEventListener('ended', onVideoEnded);
				try {
					v.pause();
				} catch {
					// ignore
				}
				v.removeAttribute('src');
				try {
					v.load();
				} catch {
					// ignore
				}
			});
			slot.classList.remove('sequential-video-slot--playing');
			if (slot.parentNode) slot.parentNode.removeChild(slot);
		},
		goToIndex(index, opts = {}) {
			return applyIndex(index, opts);
		},
		getActiveIndex() {
			return activeIndex;
		},
		pause() {
			const video = videos[activePlayer];
			if (video instanceof HTMLVideoElement) {
				try {
					video.pause();
				} catch {
					// ignore
				}
			}
		},
		play() {
			const video = videos[activePlayer];
			if (video instanceof HTMLVideoElement) {
				void tryPlayVideo(video);
			}
		},
	};
}
