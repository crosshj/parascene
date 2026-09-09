/**
 * Desktop-style waveform cover when an audio creation has no real image.
 * Bars match parascene-desktop AudioWaveform (100×100, currentColor).
 */

const WAVE_BARS = [10, 18, 28, 40, 52, 40, 28, 18, 10, 16, 26, 38, 50, 38, 26, 16, 10];

export function parseCreationCoverMeta(item) {
	const raw = item?.meta;
	if (raw && typeof raw === 'object') return raw;
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

export function creationMediaType(item) {
	const fromItem = typeof item?.media_type === 'string' ? item.media_type.trim().toLowerCase() : '';
	if (fromItem) return fromItem;
	const meta = parseCreationCoverMeta(item);
	const fromMeta = typeof meta?.media_type === 'string' ? meta.media_type.trim().toLowerCase() : '';
	return fromMeta || 'image';
}

function firstCoverUrl(item) {
	for (const key of ['url', 'thumbnail_url', 'image_url', 'fit_thumbnail_url']) {
		const value = item?.[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}

/** Speech / music / voice-train (or any audio) with no real cover art. */
export function creationNeedsAudioWaveformCover(item) {
	if (creationMediaType(item) !== 'audio') return false;
	const meta = parseCreationCoverMeta(item);
	if (meta?.cover_placeholder === true) return true;
	return !firstCoverUrl(item);
}

export function audioCoverWaveformHtml(className = 'creation-audio-wave') {
	const midY = 50;
	const gap = 5;
	const barW = 3.5;
	const span = WAVE_BARS.length * gap - (gap - barW);
	const startX = (100 - span) / 2;
	const rects = WAVE_BARS.map((h, i) => {
		const height = (h / 52) * 44;
		const x = startX + i * gap;
		const y = midY - height / 2;
		return `<rect x="${x}" y="${y}" width="${barW}" height="${height}" rx="1.25" fill="currentColor"></rect>`;
	}).join('');
	return `<svg class="${className}" viewBox="0 0 100 100" width="100" height="100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}</svg>`;
}

export function mountAudioCoverWaveform(container) {
	if (!(container instanceof HTMLElement)) return false;
	container.classList.add('creation-audio-cover');
	if (!container.querySelector('.creation-audio-wave')) {
		container.insertAdjacentHTML('afterbegin', audioCoverWaveformHtml());
	}
	return true;
}

export function removeAudioCoverWaveform(container) {
	if (!(container instanceof HTMLElement)) return;
	container.querySelectorAll('.creation-audio-wave').forEach((el) => el.remove());
	container.classList.remove('creation-audio-cover');
}
