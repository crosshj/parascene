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
		/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/.test(path);
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
		return `${parsed.pathname}${parsed.search}`;
	}
	const markers = ['/api/images/created/', '/api/videos/created/'];
	const marker = markers.find((value) => raw.includes(value));
	const index = marker ? raw.indexOf(marker) : -1;
	if (marker && index >= 0) {
		const key = raw.slice(index + marker.length).split(/[?#]/, 1)[0];
		return `/api/creations/media/${key.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}`;
	}
	if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('/')) {
		return `/api/creations/media/${raw.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}`;
	}
	return raw;
}

export function creationThumbnailUrl(item, { video = false } = {}) {
	if (video && creationNeedsVideoFramePoster(item) && item?.video_thumbnail_url) {
		return mediaPath(item.video_thumbnail_url, item);
	}
	const cover = groupCover(item);
	const coverUrl = groupCoverSourceUrl(cover, item);
	if (coverUrl) return coverUrl;
	const raw = video
		? item?.thumbnail_url || item?.fit_thumbnail_url || item?.url
		: item?.fit_thumbnail_url || item?.thumbnail_url || item?.url;
	return mediaPath(raw, item, video ? '' : 'thumbnail');
}

export function creationOriginalUrl(item) {
	return mediaPath(item?.url || item?.video_url || item?.audio_url || item?.file_path || item?.filename, item);
}

function waveform() {
	const bars = [10, 18, 28, 40, 52, 40, 28, 18, 10, 16, 26, 38, 50, 38, 26, 16, 10];
	return `<svg class="creation-grid__waveform" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${bars.map((height, index) => `<rect x="${12 + index * 4.8}" y="${50 - height / 2}" width="3.5" height="${height}" rx="1.25"></rect>`).join('')}</svg>`;
}

function statusMarkup(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'failed') {
		return `<span class="creation-grid__status is-failed"><svg class="creation-grid__status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="m9 9 6 6M15 9l-6 6"></path></svg><span>FAILED</span></span>`;
	}
	if (['processing', 'running'].includes(value)) {
		return `<span class="creation-grid__status is-generating"><span class="creation-grid__status-gears" aria-hidden="true"><svg class="creation-grid__status-gear creation-grid__status-gear--large" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09A1.65 1.65 0 0 0 19.4 15Z"></path></svg><svg class="creation-grid__status-gear creation-grid__status-gear--small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l-.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09A1.65 1.65 0 0 0 19.4 15Z"></path></svg></span><span>GENERATING…</span></span>`;
	}
	return `<span class="creation-grid__status is-queued"><svg class="creation-grid__status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><polyline points="12 10 12 12 13.5 13"></polyline><path d="m16.13 7.66-.81-1.41a2 2 0 0 0-1.74-1h-3.16a2 2 0 0 0-1.74 1l-.81 1.41M16.13 16.34l-.81 1.41a2 2 0 0 1-1.74 1h-3.16a2 2 0 0 1-1.74-1l-.81-1.41"></path></svg><span>QUEUED</span></span>`;
}

function badges(item, { hideChallengeCorner = false } = {}) {
	const groupBadge = isGroupCreation(item) ? '<span class="creation-group-badge" title="Group creation" aria-label="Group creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="9.5" height="9.5" rx="2"></rect><rect x="10.5" y="10.5" width="10" height="10" rx="2"></rect></svg></span>' : '';
	const published = item?.published === true || item?.published === 1 ? `<span class="creation-published-badge" title="Published" aria-label="Published">${iconMarkup('globe')}</span>` : '';
	const music = creationMediaType(item) === 'audio' ? `<span class="creation-music-badge" title="Music" aria-label="Music">${iconMarkup('music')}</span>` : '';
	const video = creationMediaType(item) === 'video' ? `<span class="creation-video-badge" title="Video" aria-label="Video">${iconMarkup('video')}</span>` : '';
	const challenge = isChallengeLocked(item) && !hideChallengeCorner
		? `<span class="creation-challenge-locked-badge" title="Locked to a challenge" aria-label="Locked to a challenge">${iconMarkup('trophy')}</span>` : '';
	return `${published}${challenge}${groupBadge}${music}${video}`;
}

export function creationCardMarkup(item) {
	const status = String(item?.status || 'completed').toLowerCase();
	const failed = status === 'failed';
	const pending = status !== 'completed' && status !== 'failed';
	const type = creationMediaType(item);
	const meta = parseCreationMeta(item);
	const creationId = Number(item?.created_image_id ?? item?.id);
	const hasCreationId = Number.isFinite(creationId) && creationId > 0;
	const nsfw = Boolean(item?.nsfw || meta?.nsfw);
	const challengeBlur = shouldBlurChallengeMedia(item);
	const title = String(item?.title || '').trim() || (item?.published ? 'Untitled' : '');
	const mediaClass = `feed-card-image${pending || failed ? ' creation-grid__status-card' : nsfw ? ' nsfw' : ''}${failed ? ' creation-grid__failed-card' : ''}${!failed && challengeBlur ? ' feed-card-image--challenge-pending' : ''}`;
	const state = failed
		? statusMarkup(status)
		: pending
			? statusMarkup(status)
			: creationNeedsAudioWaveformCover(item) ? waveform() : '';
	const thumbnail = pending || failed ? '' : creationThumbnailUrl(item, { video: type === 'video' });
	const original = pending || failed ? '' : creationOriginalUrl(item);
	const slides = pending || failed ? [] : groupSlides(item);
	const challengeOverlay = !failed && challengeBlur
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
		hasCreationId ? `data-creation-id="${escapeHtml(creationId)}"` : '',
		hasCreationId ? `data-image-id="${escapeHtml(creationId)}"` : '',
		`data-published="${published ? '1' : '0'}"`,
		`data-media-type="${escapeHtml(type)}"`,
		`data-group-creation="${isGroup ? '1' : '0'}"`,
		isGroup && groupSourceCount > 0 ? `data-group-source-count="${groupSourceCount}"` : '',
		Number.isFinite(Number(item?.user_id)) && Number(item.user_id) > 0 ? `data-user-id="${escapeHtml(item.user_id)}"` : '',
		Number.isFinite(Number(item?.comment_count)) && Number(item.comment_count) >= 0 ? `data-comment-count="${escapeHtml(item.comment_count)}"` : '',
		`data-image-url="${escapeHtml(thumbnail)}"`,
		`data-image-url-full="${escapeHtml(original || thumbnail)}"`,
		processingStatus ? `data-creation-status="${escapeHtml(processingStatus)}"` : ''
	].filter(Boolean).join(' ');
	return html`<div class="feed-card feed-card--image-only creation-grid__card" ${attributes}>
		<div class="${mediaClass}" aria-hidden="true" data-bg-url="${escapeHtml(thumbnail)}" data-bg-fallback="${escapeHtml(original)}" data-group-slides="${escapeHtml(JSON.stringify(slides))}"><img class="feed-card-img" alt="${escapeHtml(title || 'Creation')}" loading="lazy" decoding="async">${state}${challengeOverlay}${!failed ? badges(item, { hideChallengeCorner: challengeBlur }) : ''}</div>
	</div>`;
}

export function createCreationMediaLoader(root, { eagerCount = 6, maxConcurrent = 4 } = {}) {
	const queue = [];
	let active = 0;
	const connection = typeof navigator !== 'undefined' ? navigator.connection || navigator.mozConnection || navigator.webkitConnection : null;
	const constrained = Boolean(connection?.saveData || String(connection?.effectiveType || '').includes('2g'));
	eagerCount = constrained ? 2 : eagerCount;
	maxConcurrent = constrained ? 2 : maxConcurrent;
	const rootMargin = constrained ? '200px 0px' : '600px 0px';
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
	}, { rootMargin, threshold: 0.01 });

	function drain() {
		while (active < maxConcurrent && queue.length) {
			const next = queue.shift();
			const media = next?.media || next;
			const eager = next?.eager === true;
			if (!media) continue;
			active += 1;
			media.classList.add('loading');
			const image = media.querySelector('.feed-card-img');
			if (!(image instanceof HTMLImageElement)) { finish(); continue; }
			image.decoding = 'async';
			image.loading = eager ? 'eager' : 'lazy';
			if ('fetchPriority' in image) image.fetchPriority = eager ? 'high' : 'low';
			image.onload = () => { media.dataset.bgLoadedUrl = media.dataset.bgUrl; media.style.setProperty('--creation-grid-image', `url("${media.dataset.bgUrl.replaceAll('"', '\\"')}")`); media.classList.remove('loading', 'error'); media.classList.add('loaded'); finish(); };
			image.onerror = () => {
				const fallback = media.dataset.bgFallback;
				if (fallback && media.dataset.bgUrl !== fallback && !media.dataset.bgRetried) {
					media.dataset.bgRetried = '1';
					media.dataset.bgUrl = fallback;
					media.dataset.bgQueued = '0';
					image.removeAttribute('src');
					queue.push({ media, eager });
				} else { media.classList.remove('loading'); media.classList.add('error'); }
				finish();
			};
			image.dataset.feedImageUrl = media.dataset.bgUrl;
			image.src = media.dataset.bgUrl;
		}
	}
	function finish() { active -= 1; drain(); }
	function observe() {
		const media = [...root.querySelectorAll('.feed-card-image[data-bg-url]')];
		media.forEach((element, index) => {
			mountGroupMedia(element);
			if (element.dataset.groupMounted === '1') {
				element.classList.remove('loading', 'error');
				element.classList.add('loaded');
				return;
			}
			if (element.dataset.bgLoadedUrl) return;
			if (index < eagerCount) {
				element.dataset.bgQueued = '1';
				queue.push({ media: element, eager: index < 2 });
			} else observer.observe(element);
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
