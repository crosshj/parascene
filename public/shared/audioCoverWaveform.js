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

function metaAudioCdnId(meta) {
	const cdnId =
		meta?.audio && typeof meta.audio === 'object' && typeof meta.audio.cdn_id === 'string'
			? meta.audio.cdn_id.trim()
			: '';
	return cdnId;
}

function looksLikeGeneratedAudioMethod(meta) {
	const method = typeof meta?.method === 'string' ? meta.method.trim().toLowerCase() : '';
	if (
		method.includes('speech') ||
		method.includes('music') ||
		method.includes('lyria') ||
		method.includes('voice')
	) {
		return true;
	}
	const intent = typeof meta?.intent === 'string' ? meta.intent.trim().toLowerCase() : '';
	return intent === 'speech' || intent === 'music' || intent === 'voice-train' || intent === 'voice_train';
}

export function creationMediaType(item) {
	const meta = parseCreationCoverMeta(item);
	if (audioImportProvider(meta) === 'youtube') return 'video';
	const fromItem = typeof item?.media_type === 'string' ? item.media_type.trim().toLowerCase() : '';
	if (fromItem) return fromItem;
	const fromMeta = typeof meta?.media_type === 'string' ? meta.media_type.trim().toLowerCase() : '';
	if (fromMeta) return fromMeta;
	if (metaAudioCdnId(meta) || looksLikeGeneratedAudioMethod(meta)) return 'audio';
	const audioUrl = typeof item?.audio_url === 'string' ? item.audio_url.trim() : '';
	if (audioUrl) return 'audio';
	return 'image';
}

export function isAudioCreation(item) {
	return creationMediaType(item) === 'audio';
}

/**
 * @param {object|null|undefined} data
 * @param {{ creationId?: unknown, shareVersion?: string, shareToken?: string }} [opts]
 */
export function resolveCreationAudioPlayUrl(data, opts = {}) {
	const shareVersion = typeof opts.shareVersion === 'string' ? opts.shareVersion.trim() : '';
	const shareToken = typeof opts.shareToken === 'string' ? opts.shareToken.trim() : '';
	if (shareVersion && shareToken) {
		return `/api/share/${encodeURIComponent(shareVersion)}/${encodeURIComponent(shareToken)}/cdn-audio`;
	}
	const audioUrl = typeof data?.audio_url === 'string' ? data.audio_url.trim() : '';
	if (audioUrl) return audioUrl;
	const id = opts.creationId != null && String(opts.creationId).trim()
		? String(opts.creationId).trim()
		: data?.id != null
			? String(data.id).trim()
			: '';
	if (id) return `/api/create/images/${encodeURIComponent(id)}/audio`;
	return '';
}

const SUNO_SONG_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function sunoSongIdFromImportMeta(meta) {
	const importMeta = meta?.import && typeof meta.import === 'object' ? meta.import : null;
	const songId = typeof importMeta?.song_id === 'string' ? importMeta.song_id.trim() : '';
	return SUNO_SONG_ID_RE.test(songId) ? songId : '';
}

export function buildSunoCardEmbedSrc(songId, title) {
	const id = String(songId || '').trim().toLowerCase();
	if (!SUNO_SONG_ID_RE.test(id)) return '';
	const t = typeof title === 'string' ? title.trim() : '';
	return `/suno-card.html?id=${encodeURIComponent(id)}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
}

/** Quiet "BLUE · lyria" mark for the hosted player (same corner as the Suno wordmark). */
export function audioCardViaLabel(meta) {
	const rawServer = typeof meta?.server_name === 'string' ? meta.server_name.trim() : '';
	const server = rawServer.replace(/^parascene\s+/i, '').trim().toUpperCase();
	const args = meta?.args && typeof meta.args === 'object' && !Array.isArray(meta.args) ? meta.args : null;
	const rawModel =
		args && args.model != null
			? typeof args.model === 'string'
				? args.model.trim()
				: String(args.model).trim()
			: '';
	let model = '';
	if (rawModel) {
		const beforeColon = rawModel.includes(':') ? rawModel.split(':')[0] : rawModel;
		const base = beforeColon.split(/[/\\]/).pop() || beforeColon;
		model = base.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
	}
	const parts = [server, model].filter(Boolean);
	if (!parts.length) return '';
	const label = parts.join(' · ');
	return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

/**
 * Same 19:6 Suno player chrome, without the Suno wordmark.
 * @param {{ title?: string, coverUrl?: string, audioUrl?: string, href?: string, durationSec?: number, via?: string }} [opts]
 */
export function buildAudioCardEmbedSrc(opts = {}) {
	const params = new URLSearchParams();
	const title = typeof opts.title === 'string' ? opts.title.trim() : '';
	const coverUrl = typeof opts.coverUrl === 'string' ? opts.coverUrl.trim() : '';
	const audioUrl = typeof opts.audioUrl === 'string' ? opts.audioUrl.trim() : '';
	const href = typeof opts.href === 'string' ? opts.href.trim() : '';
	const via = typeof opts.via === 'string' ? opts.via.trim() : '';
	const durationSec = Number(opts.durationSec);
	if (title) params.set('t', title);
	if (coverUrl && !isPlaceholderAudioCover(coverUrl)) params.set('img', coverUrl);
	if (audioUrl) params.set('src', audioUrl);
	if (href) params.set('href', href);
	if (via) params.set('via', via.slice(0, 64));
	if (Number.isFinite(durationSec) && durationSec > 0) params.set('dur', String(Math.round(durationSec)));
	const qs = params.toString();
	return qs ? `/audio-card.html?${qs}` : '/audio-card.html';
}

export function resolveChatAudioPlayerSrc({
	meta,
	title,
	coverUrl,
	audioUrl,
	href,
	durationSec,
} = {}) {
	const provider = audioImportProvider(meta);
	const songId = sunoSongIdFromImportMeta(meta);
	if (provider === 'suno' && songId) return buildSunoCardEmbedSrc(songId, title);
	return buildAudioCardEmbedSrc({
		title,
		coverUrl,
		audioUrl,
		href,
		durationSec,
		via: audioCardViaLabel(meta),
	});
}

function firstCoverUrl(item) {
	let placeholder = '';
	for (const key of ['url', 'thumbnail_url', 'image_url', 'fit_thumbnail_url', 'file_path']) {
		const value = item?.[key];
		if (typeof value !== 'string' || !value.trim()) continue;
		const trimmed = value.trim();
		if (!isPlaceholderAudioCover(trimmed)) return trimmed;
		if (!placeholder) placeholder = trimmed;
	}
	return placeholder;
}

/** Transparent PNG / waveform SVG / audio stream — not album art. */
export function isPlaceholderAudioCover(path) {
	const trimmed = typeof path === 'string' ? path.trim() : '';
	if (!trimmed) return false;
	const file = (trimmed.split(/[?#]/)[0] || '').toLowerCase();
	if (file.endsWith('.svg')) return true;
	if (file.includes('audio-cover')) return true;
	return /\/api\/create\/images\/\d+\/audio\/?$/.test(file);
}

function audioImportProvider(meta) {
	const provider = meta?.import && typeof meta.import === 'object' ? meta.import.provider : '';
	return typeof provider === 'string' ? provider.trim().toLowerCase() : '';
}

/** Any stored still that is not a waveform / audio-stream placeholder. */
export function creationHasRealAudioCover(item) {
	if (creationMediaType(item) !== 'audio') return false;
	const meta = parseCreationCoverMeta(item);
	if (meta?.cover_placeholder === true) return false;
	const cover = firstCoverUrl(item);
	if (!cover || isPlaceholderAudioCover(cover)) return false;
	return true;
}

/** Speech / music / voice-train (or any audio) with no real cover art. */
export function creationNeedsAudioWaveformCover(item) {
	if (creationMediaType(item) !== 'audio') return false;
	return !creationHasRealAudioCover(item);
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
	return `<svg class="${className}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}</svg>`;
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
