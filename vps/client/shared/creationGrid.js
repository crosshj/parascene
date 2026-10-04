import { escapeHtml } from '../utils/dom.js';
import { iconMarkup } from '../components/Icon/Icon.js';

const html = String.raw;

export function parseCreationMeta(item) {
	const value = item?.meta;
	if (value && typeof value === 'object') return value;
	if (typeof value === 'string') {
		try { return JSON.parse(value); } catch { return null; }
	}
	return null;
}

export function creationMediaType(item) {
	const meta = parseCreationMeta(item);
	const direct = String(item?.media_type || '').trim().toLowerCase();
	if (direct === 'video' || item?.video_url || typeof meta?.video?.file_path === 'string' && meta.video.file_path.trim()) return 'video';
	if (direct) return direct;
	const fromMeta = String(meta?.media_type || '').trim().toLowerCase();
	if (fromMeta) return fromMeta;
	if (item?.audio_url || meta?.audio?.cdn_id) return 'audio';
	return 'image';
}

function isAudioCoverPlaceholder(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) return true;
	const path = raw.split(/[?#]/, 1)[0].toLowerCase();
	return path.endsWith('.svg') ||
		path.includes('audio-cover') ||
		/\/audio\/?$/.test(path) ||
		/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|mp4)$/.test(path);
}

function creationHasRealAudioCover(item) {
	if (creationMediaType(item) !== 'audio') return false;
	const meta = parseCreationMeta(item);
	if (meta?.cover_placeholder === true) return false;
	const candidates = [
		item?.thumbnail_url,
		item?.fit_thumbnail_url,
		item?.image_url,
		item?.url,
		item?.file_path,
		meta?.cover_url,
		meta?.cover,
	];
	return candidates.some((value) => !isAudioCoverPlaceholder(value));
}

function creationNeedsAudioWaveformCover(item) {
	return creationMediaType(item) === 'audio' && !creationHasRealAudioCover(item);
}

function hasItems(value) {
	return Array.isArray(value) && value.length > 0;
}

function isGroupCreation(item) {
	const kind = parseCreationMeta(item)?.group?.kind;
	return kind === 'group_creations' || kind === 'group_v2';
}

function isVideoOnlyGroup(item) {
	const group = parseCreationMeta(item)?.group;
	if (!group || typeof group !== 'object') return false;
	const sources = group.kind === 'group_creations'
		? (Array.isArray(group.source_creations) ? group.source_creations : [])
		: group.kind === 'group_v2'
			? (Array.isArray(group.items) ? group.items.map((entry) => entry?.view || {}) : [])
			: [];
	if (sources.length === 0) return false;
	return sources.every((source) => {
		const sourceMeta = parseCreationMeta(source);
		const sourceType = String(source?.media_type || source?.mediaType || sourceMeta?.media_type || '').trim().toLowerCase();
		return sourceType === 'video' || Boolean(sourceMeta?.video?.file_path || source?.video_url || source?.videoUrl);
	});
}

function isChallengeLocked(item) {
	const meta = parseCreationMeta(item);
	return hasItems(meta?.challenge_submissions) ||
		hasItems(meta?.challenge_feed_pins) ||
		hasItems(meta?.challenge_organizer_refs);
}

function shouldBlurChallengeMedia(item) {
	const meta = parseCreationMeta(item);
	const ended = item?.challenge_ended === true || meta?.challenge_ended === true;
	return !item?.published && !item?.nsfw && !meta?.nsfw && !ended &&
		hasItems(meta?.challenge_submissions) && creationMediaType(item) !== 'audio';
}

function hasVideoSourceImage(item, meta) {
	if (String(item?.source_image_url || '').trim() || String(meta?.source_image_url || '').trim()) return true;
	const args = meta?.args && typeof meta.args === 'object' ? meta.args : null;
	if (!args) return false;
	if (['image_url', 'image', 'source_image_url'].some((key) => String(args[key] || '').trim())) return true;
	return Array.isArray(args.input_images) && args.input_images.some((value) => String(value || '').trim());
}

function isReferenceToVideo(item, meta) {
	const method = String(meta?.method || meta?.provider_method || '').trim().toLowerCase().replace(/[_-]+/g, '');
	if (['reference2video', 'ref2video', 'r2v'].includes(method)) return true;
	const model = String(meta?.args?.model || '').trim().toLowerCase().replace(/[_-]+/g, '');
	return model.includes('ref2video') || model.includes('reference2video');
}

function creationNeedsVideoFramePoster(item) {
	if (creationMediaType(item) !== 'video' || !item?.video_url) return false;
	const meta = parseCreationMeta(item) || {};
	// A group cover commonly points at the child PNG placeholder. For a
	// video-only group, the group's real video is the authoritative preview.
	if (isVideoOnlyGroup(item)) return true;
	return !hasVideoSourceImage(item, meta) || isReferenceToVideo(item, meta);
}

function groupCover(item) {
	const group = parseCreationMeta(item)?.group;
	if (!group || typeof group !== 'object') return null;
	if (group.kind === 'group_v2') {
		const entry = (Array.isArray(group.items) ? group.items : []).find((value) => value?.cover) || group.items?.[0];
		return entry?.pointer?.kind === 'creation' ? entry.view || null : null;
	}
	if (group.kind !== 'group_creations') return null;
	const sources = Array.isArray(group.source_creations) ? group.source_creations : [];
	const coverId = Number(group.cover_source_id);
	return sources.find((source) => Number(source?.id) === coverId) || sources[0] || null;
}

function groupCoverMediaType(source) {
	const meta = parseCreationMeta(source);
	const value = String(source?.media_type || source?.mediaType || meta?.media_type || meta?.mediaType || '').trim().toLowerCase();
	if (value) return value;
	return meta?.video?.file_path || meta?.video?.filePath || source?.video_url || source?.videoUrl ? 'video' : 'image';
}

function groupCoverSourceUrl(source, item) {
	if (!source) return '';
	const meta = parseCreationMeta(source);
	const type = groupCoverMediaType(source);
	// Group video rows often retain a transparent PNG as file_path. Ask the VPS
	// media route for a poster extracted from the real video instead.
	if (type === 'video') {
		const video = source?.video_url || source?.videoUrl || meta?.video_url || meta?.video?.file_path || meta?.video?.filePath || meta?.video?.url;
		if (video) return mediaPath(video, item, 'video_thumbnail');
	}
	const sourceUrl = source?.thumbnail_url || source?.fit_thumbnail_url || source?.file_path || source?.filePath || source?.url || source?.filename;
	return sourceUrl ? mediaPath(sourceUrl, item, 'thumbnail') : '';
}

function groupSlides(item) {
	// Group cards have one stable cover in the VPS grid. Carousel behavior is
	// intentionally not part of this migration surface.
	return [];
}

function mediaPath(url, item, variant = '') {
	const raw = String(url || '').trim();
	if (!raw) return '';
	if (raw.startsWith('/api/creations/media/')) {
		const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
		if (variant) parsed.searchParams.set('variant', variant);
		if (variant === 'blur') parsed.searchParams.set('source_variant', 'thumbnail');
		return `${parsed.pathname}${parsed.search}`;
	}
	const markers = ['/api/images/created/', '/api/videos/created/'];
	const marker = markers.find((value) => raw.includes(value));
	const index = marker ? raw.indexOf(marker) : -1;
	if (marker && index >= 0) {
		const key = raw.slice(index + marker.length).split(/[?#]/, 1)[0];
		return `/api/creations/media/${key.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}${variant === 'blur' ? '&source_variant=thumbnail' : ''}`;
	}
	if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('/')) {
		return `/api/creations/media/${raw.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}${variant === 'blur' ? '&source_variant=thumbnail' : ''}`;
	}
	return raw;
}

export function creationThumbnailUrl(item, { video = false } = {}) {
	const nsfw = Boolean(item?.nsfw || parseCreationMeta(item)?.nsfw);
	const meta = parseCreationMeta(item) || {};
	const blurVariant = nsfw || shouldBlurChallengeMedia(item) ? 'blur' : '';
	if (video && creationNeedsVideoFramePoster(item) && item?.video_thumbnail_url) {
		return mediaPath(item.video_thumbnail_url, item, blurVariant || 'video_thumbnail');
	}
	if (creationMediaType(item) === 'audio') {
		const audio = meta.audio && typeof meta.audio === 'object' ? meta.audio : {};
		const cover = [item?.cover_url, item?.cover_image_url, meta.cover_url, meta.cover_image_url, audio.cover_url, audio.cover_image_url, audio.thumbnail_url, item?.fit_thumbnail_url, item?.thumbnail_url, item?.url]
			.find((value) => typeof value === 'string' && !isAudioCoverPlaceholder(value));
		// Audio detail uses the cover URL directly. Derive a small square from that
		// same source for the grid instead of downloading the full-resolution cover.
		if (cover) return mediaPath(cover, item, blurVariant || 'grid_thumbnail');
	}
	const cover = groupCover(item);
	let coverUrl = groupCoverSourceUrl(cover, item);
	if (coverUrl && blurVariant) coverUrl = mediaPath(coverUrl, item, blurVariant);
	if (coverUrl) return coverUrl;
	const raw = video
		? item?.thumbnail_url || item?.fit_thumbnail_url || item?.url
		: item?.fit_thumbnail_url || item?.thumbnail_url || item?.url;
	return mediaPath(raw, item, blurVariant || (video ? '' : 'thumbnail'));
}

export function creationOriginalUrl(item) {
	const raw = item?.url || item?.image_url || item?.video_url || item?.audio_url || item?.file_path || item?.filename;
	const url = mediaPath(raw, item);
	if (!url || !/^\/api\/creations\/media\//.test(url)) return url;
	try {
		const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
		if (['thumbnail', 'grid_thumbnail', 'fit'].includes(parsed.searchParams.get('variant') || '')) {
			parsed.searchParams.delete('variant');
			parsed.searchParams.delete('source_variant');
		}
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

function waveform() {
	const bars = [10, 18, 28, 40, 52, 40, 28, 18, 10, 16, 26, 38, 50, 38, 26, 16, 10];
	return `<svg class="creation-grid__waveform" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${bars.map((height, index) => `<rect x="${12 + index * 4.8}" y="${50 - height / 2}" width="3.5" height="${height}" rx="1.25"></rect>`).join('')}</svg>`;
}

function statusMarkup(status, queuePosition = null) {
	const value = String(status || '').toLowerCase();
	if (value === 'failed') {
		return `<span class="creation-grid__status is-failed"><svg class="creation-grid__status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="m9 9 6 6M15 9l-6 6"></path></svg><span>FAILED</span></span>`;
	}
	if (['processing', 'running'].includes(value)) {
		return `<span class="creation-grid__status is-generating"><span class="creation-grid__status-gears" aria-hidden="true"><svg class="creation-grid__status-gear creation-grid__status-gear--large" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09A1.65 1.65 0 0 0 19.4 15Z"></path></svg><svg class="creation-grid__status-gear creation-grid__status-gear--small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l-.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09A1.65 1.65 0 0 0 19.4 15Z"></path></svg></span><span>GENERATING…</span></span>`;
	}
	const place = Number(queuePosition);
	const positionBadge = Number.isFinite(place) && place > 0
		? `<span class="creation-grid__status-place">${escapeHtml(String(place))}</span>`
		: '';
	return `<span class="creation-grid__status is-queued"><span class="creation-grid__status-watch-wrap"><svg class="creation-grid__status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><polyline points="12 10 12 12 13.5 13"></polyline><path d="m16.13 7.66-.81-1.41a2 2 0 0 0-1.74-1h-3.16a2 2 0 0 0-1.74 1l-.81 1.41M16.13 16.34l-.81 1.41a2 2 0 0 1-1.74 1h-3.16a2 2 0 0 1-1.74-1l-.81-1.41"></path></svg>${positionBadge}</span><span>QUEUED</span></span>`;
}

function filledAdornmentIcon(name) {
	const paths = {
		globe: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.1 1.3 1.9 3 2.3 5H9.7C10.1 7 10.9 5.3 12 4Zm-3 7h6c.1.3.1.7.1 1s0  .7-.1 1H9c-.1-.3-.1-.7-.1-1s0-.7.1-1Zm-4.9 0h2.9c-.1.7-.1 1.3 0 2H4.1a8 8 0 0 1 0-2Zm1 4h2.3c.4 2 1.2 3.7 2.3 5a8.03 8.03 0 0 1-4.6-5Zm4.6 0h4.6c-.4 2-1.2 3.7-2.3 5-1.1-1.3-1.9-3-2.3-5Zm6.3 0h2.3a8.03 8.03 0 0 1-4.6 5c1.1-1.3 1.9-3 2.3-5Zm.4-2c.1-.7.1-1.3 0-2h2.9a8 8 0 0 1 0 2h-2.9Zm-.4-4c-.4-2-1.2-3.7-2.3-5a8.03 8.03 0 0 1 4.6 5H16Z"></path>',
		trophy: '<path d="M7 3h10v2h2v2a4 4 0 0 1-3.1 3.9A4.01 4.01 0 0 1 13 14.7V18h3v3H8v-3h3v-3.3a4.01 4.01 0 0 1-2.9-3.8A4 4 0 0 1 5 7V5h2V3Zm-2 4a2 2 0 0 0 1.6 1.96A8 8 0 0 1 5 7Zm14 0a8 8 0 0 1-1.6 1.96A2 2 0 0 0 19 7Z"></path>',
		group: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H12a2.5 2.5 0 0 1 2.5 2.5V9H18.5A2.5 2.5 0 0 1 21 11.5v7A2.5 2.5 0 0 1 18.5 21h-7A2.5 2.5 0 0 1 9 18.5V17H5.5A2.5 2.5 0 0 1 3 14.5v-8Z"></path>',
		music: '<path d="M9 17.5V4.2l11-2v12.3a3.5 3.5 0 1 1-2-3.15V5.8l-7 1.27v10.43a3.5 3.5 0 1 1-2-3.15V17.5Zm-3 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm12-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path>',
		video: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h8A2.5 2.5 0 0 1 16 6.5v1.7l4.2-2.4A1.2 1.2 0 0 1 22 6.85v10.3a1.2 1.2 0 0 1-1.8 1.04L16 15.8v1.7a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 17.5v-11Z"></path>'
	};
	return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function badges(item, { hideChallengeCorner = false, hidePublished = false } = {}) {
	const groupBadge = isGroupCreation(item) ? '<span class="creation-group-badge" title="Group creation" aria-label="Group creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="9.5" height="9.5" rx="2"></rect><rect x="10.5" y="10.5" width="10" height="10" rx="2"></rect></svg></span>' : '';
	const published = !hidePublished && (item?.published === true || item?.published === 1) ? `<span class="creation-published-badge" title="Published" aria-label="Published">${iconMarkup('globe')}</span>` : '';
	const music = creationMediaType(item) === 'audio' ? `<span class="creation-music-badge" title="Music" aria-label="Music">${iconMarkup('music')}</span>` : '';
	const video = creationMediaType(item) === 'video' ? `<span class="creation-video-badge" title="Video" aria-label="Video">${iconMarkup('video')}</span>` : '';
	const challenge = isChallengeLocked(item) && !hideChallengeCorner
		? `<span class="creation-challenge-locked-badge" title="Locked to a challenge" aria-label="Locked to a challenge">${iconMarkup('trophy')}</span>` : '';
	return `${published}${challenge}${groupBadge}${music}${video}`;
}

export function creationCardMarkup(item, { hidePublishedBadge = false } = {}) {
	const status = String(item?.status || 'completed').toLowerCase();
	const failed = status === 'failed';
	const pending = status !== 'completed' && status !== 'failed';
	const type = creationMediaType(item);
	const meta = parseCreationMeta(item);
	const rawId = item?.created_image_id ?? item?.id;
 const creationId = String(rawId).startsWith("pending-") ? String(rawId) : Number(rawId);
	const hasCreationId = Number.isFinite(creationId) && creationId > 0;
	const nsfw = Boolean(item?.nsfw || meta?.nsfw);
	const challengeBlur = shouldBlurChallengeMedia(item);
	const queuePosition = Number(meta?.line_place ?? meta?.provider_last_payload?.place);
	const title = String(item?.title || '').trim() || (item?.published ? 'Untitled' : '');
	const mediaClass = `feed-card-image${pending || failed ? ' creation-grid__status-card' : nsfw ? ' nsfw' : ''}${failed ? ' creation-grid__failed-card' : ''}${!failed && challengeBlur ? ' feed-card-image--challenge-pending' : ''}`;
	const state = failed
		? statusMarkup(status)
		: pending
			? statusMarkup(status, queuePosition)
			: creationNeedsAudioWaveformCover(item) ? waveform() : '';
	const thumbnail = pending || failed ? '' : creationThumbnailUrl(item, { video: type === 'video' });
	const original = pending || failed ? '' : creationOriginalUrl(item);
	const slides = pending || failed ? [] : groupSlides(item);
	const challengeOverlay = !pending && !failed && challengeBlur
		? `<span class="route-media-challenge-blur-overlay" aria-hidden="true"></span><span class="creation-challenge-entered-badge" role="img" aria-label="Entered in challenge" title="Entered in challenge">${iconMarkup('trophy')}</span>`
		: '';
	const group = meta?.group;
	const isGroup = group?.kind === 'group_creations' || group?.kind === 'group_v2';
	const groupSourceCount = group?.kind === 'group_creations'
		? (Array.isArray(group?.source_creations) ? group.source_creations.length : 0)
		: (Array.isArray(group?.items) ? group.items.length : 0);
	const published = item?.published === true || item?.published === 1;
	const processingStatus = failed || ['creating', 'pending', 'queued', 'processing', 'running'].includes(status) ? status : '';
	const attributes = [
		(hasCreationId || item.__optimistic) ? `data-creation-id="${escapeHtml(creationId)}"` : '',
		hasCreationId ? `data-image-id="${escapeHtml(creationId)}"` : '',
		`data-published="${published ? '1' : '0'}"`,
		`data-media-type="${escapeHtml(type)}"`,
		`data-group-creation="${isGroup ? '1' : '0'}"`,
		isGroup && groupSourceCount > 0 ? `data-group-source-count="${groupSourceCount}"` : '',
		Number.isFinite(Number(item?.user_id)) && Number(item.user_id) > 0 ? `data-user-id="${escapeHtml(item.user_id)}"` : '',
		Number.isFinite(Number(item?.comment_count)) && Number(item.comment_count) >= 0 ? `data-comment-count="${escapeHtml(item.comment_count)}"` : '',
		`data-image-url="${escapeHtml(thumbnail)}"`,
		`data-image-url-full="${escapeHtml(original)}"`,
		processingStatus ? `data-creation-status="${escapeHtml(processingStatus)}"` : ''
	].filter(Boolean).join(' ');
	return html`<div class="feed-card feed-card--image-only creation-grid__card" ${attributes} role="link" tabindex="0" aria-label="Open ${escapeHtml(title || `Creation ${creationId || ''}`)}">
		<div class="${mediaClass}" aria-hidden="true" data-creation-id="${escapeHtml(creationId)}" data-media-type="${escapeHtml(type)}" data-bg-blur="${nsfw || challengeBlur ? '1' : '0'}" data-bg-url="${escapeHtml(thumbnail)}" data-bg-fallback="${escapeHtml(original)}" data-group-slides="${escapeHtml(JSON.stringify(slides))}"><img class="feed-card-img" alt="${escapeHtml(title || 'Creation')}" loading="lazy" decoding="async">${state}${nsfw && !pending && !failed ? `<span class="creation-grid__nsfw-badge" role="img" aria-label="NSFW">${iconMarkup('eyeHidden')}</span>` : ''}${challengeOverlay}${!failed && !pending ? badges(item, { hideChallengeCorner: challengeBlur, hidePublished: hidePublishedBadge }) : ''}</div>
	</div>`;
}

export function createCreationMediaLoader(root, { eagerCount = 16, maxConcurrent = 8 } = {}) {
	const queue = [];
	let active = 0;
	const loadingMedia = new WeakSet();
	// Match the working www grid: assign src to every card and let native
	// loading="lazy" schedule network work. An app-level concurrency cap left
	// queued cards with no img src while they waited their turn.
	maxConcurrent = Number.POSITIVE_INFINITY;
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const media = entry.target;
			observer.unobserve(media);
			if (media.dataset.bgUrl && !media.dataset.bgLoadedUrl && media.dataset.bgQueued !== '1') {
				media.dataset.bgQueued = '1';
				queue.push({ media, eager: false });
			}
		}
		drain();
	}, { threshold: 0.01 });

	function drain() {
		while (active < maxConcurrent && queue.length) {
			const next = queue.shift();
			const media = next?.media || next;
			const eager = next?.eager === true;
			const highPriority = next?.highPriority === true;
			if (!media) continue;
			if (!media.isConnected || !media.dataset.bgUrl || media.dataset.bgLoadedUrl) {
				if (media?.dataset) media.dataset.bgQueued = '0';
				continue;
			}
			active += 1;
			loadingMedia.add(media);
			media.classList.add('loading');
			const image = media.querySelector('.feed-card-img');
			if (!(image instanceof HTMLImageElement)) { finish(); continue; }
			image.decoding = 'async';
			image.loading = eager ? 'eager' : 'lazy';
			if ('fetchPriority' in image) image.fetchPriority = highPriority ? 'high' : 'auto';
			image.onload = () => { loadingMedia.delete(media); media.dataset.bgLoadedUrl = media.dataset.bgUrl; media.dataset.bgQueued = '0'; media.style.setProperty('--creation-grid-image', `url("${media.dataset.bgUrl.replaceAll('"', '\\"')}")`); media.classList.remove('loading', 'error'); media.classList.add('loaded'); finish(); };
			image.onerror = () => {
				loadingMedia.delete(media);
				media.dataset.bgQueued = '0';
				const fallback = media.dataset.bgFallback;
				const retries = Number(media.dataset.bgRetries || 0);
				const isAudio = media.dataset.mediaType === 'audio';
				if (isAudio && retries < 3) {
					media.dataset.bgRetries = String(retries + 1);
					media.dataset.bgQueued = '1';
					media.classList.remove('loading');
					finish();
					window.setTimeout(() => {
						if (!media.isConnected || media.dataset.bgLoadedUrl) return;
						if (retries === 2 && fallback && media.dataset.bgUrl !== fallback) {
							media.dataset.bgUrl = media.dataset.bgBlur === '1'
								? mediaPath(fallback, { id: media.dataset.creationId }, 'blur')
								: fallback;
						}
						media.dataset.bgQueued = '0';
						queue.push({ media, eager });
						drain();
					}, 500 * (retries + 1));
				} else if (fallback && media.dataset.bgUrl !== fallback && !media.dataset.bgRetried) {
					media.dataset.bgRetried = '1';
					media.dataset.bgUrl = media.dataset.bgBlur === '1'
						? mediaPath(fallback, { id: media.dataset.creationId }, 'blur')
						: fallback;
					media.dataset.bgQueued = '0';
					image.removeAttribute('src');
					queue.push({ media, eager });
					drain();
				} else { media.classList.remove('loading'); media.classList.add('error'); }
				finish();
			};
			image.dataset.feedImageUrl = media.dataset.bgUrl;
			image.src = media.dataset.bgUrl;
		}
	}
	function finish() { active -= 1; drain(); }
	function observe(cards = null) {
		const media = Array.isArray(cards)
			? cards.flatMap((card) => [...card.querySelectorAll('.feed-card-image[data-bg-url]')])
			: [...root.querySelectorAll('.feed-card-image[data-bg-url]')];
		media.forEach((element, index) => {
			mountGroupMedia(element);
			if (element.dataset.groupMounted === '1') {
				element.classList.remove('loading', 'error');
				element.classList.add('loaded');
				return;
			}
			if (element.dataset.bgLoadedUrl) return;
			if (element.dataset.bgQueued === '1' && (loadingMedia.has(element) || queue.some((entry) => (entry?.media || entry) === element))) return;
			// Recover stale markup where the queued flag survived but no request is
			// active and this card is no longer present in the in-memory queue.
			if (element.dataset.bgQueued === '1') element.dataset.bgQueued = '0';
			// Give every rendered card a URL immediately, matching the active SPA.
			// Native loading="lazy" still controls transfer for distant cards, while
			// the browser gets much more lead time than a custom viewport observer.
			element.dataset.bgQueued = '1';
			queue.push({ media: element, eager: index < eagerCount, highPriority: index < 2 });
		});
		drain();
	}
	function mountGroupMedia(media) {
		if (media.dataset.groupMounted === '1') return;
		let slides;
		try { slides = JSON.parse(media.dataset.groupSlides || '[]'); } catch { slides = []; }
		if (!Array.isArray(slides) || slides.length < 2) return;
		media.dataset.groupMounted = '1';
		media.classList.add('feed-card-image--group-host', 'feed-card-image--group-carousel');
		const stack = document.createElement('div');
		stack.className = 'creation-grid__group-stack';
		const isVideo = slides.some((slide) => slide.type === 'video');
		const elements = slides.map((slide, index) => {
			const element = document.createElement(isVideo && slide.type === 'video' ? 'video' : 'img');
			element.className = `creation-grid__group-slide${index === 0 ? ' is-active' : ''}`;
			if (element instanceof HTMLVideoElement) {
				element.muted = true; element.loop = true; element.playsInline = true; element.autoplay = index === 0; element.preload = index === 0 ? 'auto' : 'metadata';
			} else { element.loading = index === 0 ? 'eager' : 'lazy'; element.decoding = 'async'; }
			element.src = slide.url;
			stack.appendChild(element);
			return element;
		});
		const setIndex = (index) => {
			const next = (index + elements.length) % elements.length;
			elements.forEach((element, position) => {
				element.classList.toggle('is-active', position === next);
				if (element instanceof HTMLVideoElement) position === next ? void element.play().catch(() => {}) : element.pause();
			});
		};
		const button = (direction) => {
			const control = document.createElement('button');
			control.type = 'button'; control.className = `creation-grid__group-nav creation-grid__group-nav--${direction}`;
			control.setAttribute('aria-label', direction === 'next' ? 'Next grouped item' : 'Previous grouped item');
			control.innerHTML = direction === 'next' ? '›' : '‹';
			control.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); const current = elements.findIndex((element) => element.classList.contains('is-active')); setIndex(current + (direction === 'next' ? 1 : -1)); });
			return control;
		};
		const overlays = [...media.children].filter((element) =>
			element.matches('.creation-published-badge, .creation-challenge-locked-badge, .creation-group-badge, .creation-music-badge, .creation-video-badge, .route-media-challenge-blur-overlay, .creation-challenge-entered-badge')
		);
		media.replaceChildren(stack, button('prev'), button('next'), ...overlays);
	}
	return { observe, disconnect: () => observer.disconnect() };
}
