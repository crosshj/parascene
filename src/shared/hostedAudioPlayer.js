/**
 * Compact play / timeline dock used on creation detail and chat audio lightbox.
 */

export function formatHostedAudioClock(seconds) {
	const n = Number(seconds);
	if (!Number.isFinite(n) || n < 0) return '0:00';
	const s = Math.floor(n);
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, '0')}`;
}

function hostedAudioDurationSec(audio, fallbackSec) {
	const fromEl = Number(audio?.duration);
	if (Number.isFinite(fromEl) && fromEl > 0) return fromEl;
	const fromMeta = Number(fallbackSec);
	if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
	return 0;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   src?: string,
 *   title?: string,
 *   durationSec?: number,
 *   autoplay?: boolean,
 *   onAudio?: (audio: HTMLAudioElement) => void,
 * }} [opts]
 * @returns {{ audio: HTMLAudioElement, wrap: HTMLElement } | null}
 */
export function mountHostedAudioPlayer(container, opts = {}) {
	if (!(container instanceof HTMLElement)) return null;
	const src = String(opts.src || '').trim();
	if (!src) return null;

	container.querySelectorAll('[data-hosted-audio]').forEach((el) => el.remove());

	const title =
		typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : 'Audio';
	const fallbackDuration = Number(opts.durationSec);

	const wrap = document.createElement('div');
	wrap.className = 'creation-detail-hosted-audio';
	wrap.setAttribute('data-hosted-audio', '');

	const audio = document.createElement('audio');
	audio.preload = 'metadata';
	audio.src = src;
	audio.setAttribute('playsinline', '');
	audio.setAttribute('controlslist', 'nodownload noplaybackrate');

	const playBtn = document.createElement('button');
	playBtn.type = 'button';
	playBtn.className = 'hosted-audio-play';
	playBtn.setAttribute('aria-label', `Play ${title}`);
	playBtn.innerHTML =
		'<span class="hosted-audio-play-icon" aria-hidden="true">' +
		'<svg class="hosted-audio-play-tri" viewBox="0 0 12 14">' +
		'<path d="M1 1.15 11.2 7 1 12.85z"></path>' +
		'</svg>' +
		'<span class="hosted-audio-bars">' +
		'<span></span><span></span><span></span>' +
		'</span>' +
		'</span>';

	const timeline = document.createElement('div');
	timeline.className = 'hosted-audio-timeline';

	const currentEl = document.createElement('span');
	currentEl.className = 'hosted-audio-time';
	currentEl.setAttribute('data-hosted-audio-current', '');
	currentEl.textContent = '0:00';

	const seek = document.createElement('div');
	seek.className = 'hosted-audio-seek';
	seek.setAttribute('role', 'slider');
	seek.setAttribute('aria-label', 'Seek');
	seek.setAttribute('aria-valuemin', '0');
	seek.tabIndex = 0;

	const seekTrack = document.createElement('div');
	seekTrack.className = 'hosted-audio-seek-track';
	const seekFill = document.createElement('div');
	seekFill.className = 'hosted-audio-seek-fill';
	const seekThumb = document.createElement('div');
	seekThumb.className = 'hosted-audio-seek-thumb';
	seekTrack.appendChild(seekFill);
	seekTrack.appendChild(seekThumb);
	seek.appendChild(seekTrack);

	const durationEl = document.createElement('span');
	durationEl.className = 'hosted-audio-time';
	durationEl.setAttribute('data-hosted-audio-duration', '');
	durationEl.textContent = formatHostedAudioClock(
		hostedAudioDurationSec(null, fallbackDuration)
	);

	timeline.appendChild(currentEl);
	timeline.appendChild(seek);
	timeline.appendChild(durationEl);

	wrap.appendChild(audio);
	wrap.appendChild(playBtn);
	wrap.appendChild(timeline);
	container.appendChild(wrap);

	let dragging = false;

	function duration() {
		return hostedAudioDurationSec(audio, fallbackDuration);
	}

	function setProgress(ratio) {
		const r = Math.min(1, Math.max(0, ratio));
		seekFill.style.width = `${r * 100}%`;
		seekThumb.style.left = `${r * 100}%`;
		const dur = duration();
		const t = r * dur;
		currentEl.textContent = formatHostedAudioClock(t);
		seek.setAttribute('aria-valuenow', String(Math.floor(t)));
		seek.setAttribute('aria-valuemax', String(Math.floor(dur) || 0));
		seek.setAttribute(
			'aria-valuetext',
			`${formatHostedAudioClock(t)} of ${formatHostedAudioClock(dur)}`
		);
	}

	function syncFromAudio() {
		const dur = duration();
		durationEl.textContent = formatHostedAudioClock(dur);
		if (!(dur > 0)) {
			setProgress(0);
			return;
		}
		setProgress(audio.currentTime / dur);
	}

	function ratioFromPointer(clientX) {
		const rect = seekTrack.getBoundingClientRect();
		if (!(rect.width > 0)) return 0;
		return (clientX - rect.left) / rect.width;
	}

	function seekToRatio(ratio) {
		const dur = duration();
		if (!(dur > 0)) return;
		audio.currentTime = Math.min(dur, Math.max(0, ratio * dur));
		syncFromAudio();
	}

	function setPlayingUi(playing) {
		wrap.classList.toggle('is-playing', playing);
		playBtn.setAttribute('aria-label', playing ? `Pause ${title}` : `Play ${title}`);
	}

	playBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (audio.paused) {
			void audio.play().catch(() => {
				setPlayingUi(false);
			});
		} else {
			audio.pause();
		}
	});

	audio.addEventListener('play', () => setPlayingUi(true));
	audio.addEventListener('pause', () => setPlayingUi(false));
	audio.addEventListener('ended', () => {
		setPlayingUi(false);
		setProgress(0);
	});
	audio.addEventListener('timeupdate', () => {
		if (!dragging) syncFromAudio();
	});
	audio.addEventListener('loadedmetadata', () => syncFromAudio());
	audio.addEventListener('durationchange', () => syncFromAudio());

	seek.addEventListener('pointerdown', (e) => {
		if (e.button != null && e.button !== 0) return;
		dragging = true;
		seek.setPointerCapture?.(e.pointerId);
		seekToRatio(ratioFromPointer(e.clientX));
		e.preventDefault();
		e.stopPropagation();
	});
	seek.addEventListener('pointermove', (e) => {
		if (!dragging) return;
		seekToRatio(ratioFromPointer(e.clientX));
	});
	const endDrag = (e) => {
		if (!dragging) return;
		dragging = false;
		if (e?.pointerId != null) {
			try {
				seek.releasePointerCapture?.(e.pointerId);
			} catch {
				// ignore
			}
		}
	};
	seek.addEventListener('pointerup', endDrag);
	seek.addEventListener('pointercancel', endDrag);

	seek.addEventListener('keydown', (e) => {
		const dur = duration();
		if (!(dur > 0)) return;
		const step = dur * 0.05;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault();
			audio.currentTime = Math.max(0, audio.currentTime - step);
			syncFromAudio();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault();
			audio.currentTime = Math.min(dur, audio.currentTime + step);
			syncFromAudio();
		} else if (e.key === 'Home') {
			e.preventDefault();
			audio.currentTime = 0;
			syncFromAudio();
		} else if (e.key === 'End') {
			e.preventDefault();
			audio.currentTime = dur;
			syncFromAudio();
		}
	});

	if (typeof opts.onAudio === 'function') opts.onAudio(audio);
	syncFromAudio();
	if (opts.autoplay) {
		void audio.play().catch(() => {
			setPlayingUi(false);
		});
	}

	return { audio, wrap };
}
