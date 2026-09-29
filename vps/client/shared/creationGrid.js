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
	return parseCreationMeta(item)?.group?.kind === 'group_creations';
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

function groupSlides(item) {
	const group = parseCreationMeta(item)?.group;
	if (!group || typeof group !== 'object') return [];
	const raw = group.kind === 'group_creations'
		? (Array.isArray(group.source_creations) ? group.source_creations : [])
		: group.kind === 'group_v2'
			? (Array.isArray(group.items) ? group.items.map((entry) => ({ ...(entry?.view || {}), meta: { media_type: entry?.view?.mediaType || entry?.view?.media_type } })) : [])
			: [];
	const coverId = Number(group.cover_source_id);
	const ordered = [...raw].sort((a, b) => (Number(a?.id) === coverId ? -1 : Number(b?.id) === coverId ? 1 : 0));
	return ordered.map((source) => {
		const sourceMeta = source?.meta && typeof source.meta === 'object' ? source.meta : {};
		const sourceType = String(sourceMeta.media_type || source.media_type || 'image').toLowerCase();
		const sourceUrl = source?.file_path || source?.filePath || source?.url || source?.filename;
		if (!sourceUrl) return null;
		return { type: sourceType, url: mediaPath(sourceUrl, item, sourceType === 'video' ? '' : 'thumbnail') };
	}).filter((source) => source?.url);
}

function mediaPath(url, item, variant = '') {
	const raw = String(url || '').trim();
	if (!raw) return '';
	if (raw.startsWith('/api/creations/media/')) {
		const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
		if (variant) parsed.searchParams.set('variant', variant);
		return `${parsed.pathname}${parsed.search}`;
	}
	const marker = '/api/images/created/';
	const index = raw.indexOf(marker);
	if (index >= 0) {
		const key = raw.slice(index + marker.length).split(/[?#]/, 1)[0];
		return `/api/creations/media/${key.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}`;
	}
	if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('/')) {
		return `/api/creations/media/${raw.split('/').map(encodeURIComponent).join('/')}?creation_id=${encodeURIComponent(String(item.id))}${variant ? `&variant=${variant}` : ''}`;
	}
	return raw;
}

export function creationThumbnailUrl(item, { video = false } = {}) {
	const cover = groupCover(item);
	const source = cover?.file_path || cover?.url || cover?.filename;
	if (source) return mediaPath(source, item, video ? '' : 'thumbnail');
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

function badges(item, { hideChallengeCorner = false } = {}) {
	const groupBadge = isGroupCreation(item) ? '<span class="creation-group-badge" title="Group creation" aria-label="Group creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="9.5" height="9.5" rx="2"></rect><rect x="10.5" y="10.5" width="10" height="10" rx="2"></rect></svg></span>' : '';
	const published = item?.published === true || item?.published === 1 ? `<span class="creation-published-badge" title="Published" aria-label="Published">${iconMarkup('globe')}</span>` : '';
	const music = creationMediaType(item) === 'audio' ? `<span class="creation-music-badge" title="Music" aria-label="Music">${iconMarkup('music')}</span>` : '';
	const challenge = isChallengeLocked(item) && !hideChallengeCorner
		? `<span class="creation-challenge-locked-badge" title="Locked to a challenge" aria-label="Locked to a challenge">${iconMarkup('trophy')}</span>` : '';
	return `${published}${challenge}${groupBadge}${music}`;
}

export function creationCardMarkup(item) {
	const status = String(item?.status || 'completed').toLowerCase();
	const pending = status !== 'completed' && status !== 'failed';
	const type = creationMediaType(item);
	const meta = parseCreationMeta(item);
	const nsfw = Boolean(item?.nsfw || meta?.nsfw);
	const challengeBlur = shouldBlurChallengeMedia(item);
	const title = String(item?.title || '').trim() || (item?.published ? 'Untitled' : '');
	const mediaClass = `feed-card-image${nsfw ? ' nsfw' : ''}${challengeBlur ? ' feed-card-image--challenge-pending' : ''}`;
	const state = pending
		? `<span class="creation-grid__pending">${escapeHtml(status === 'creating' ? 'GENERATING…' : status.toUpperCase())}</span>`
		: creationNeedsAudioWaveformCover(item) ? waveform() : '';
	const thumbnail = pending ? '' : creationThumbnailUrl(item, { video: type === 'video' });
	const original = pending ? '' : creationOriginalUrl(item);
	const slides = pending ? [] : groupSlides(item);
	const challengeOverlay = challengeBlur
		? `<span class="route-media-challenge-blur-overlay" aria-hidden="true"></span><span class="creation-challenge-entered-badge" role="img" aria-label="Entered in challenge" title="Entered in challenge">${iconMarkup('trophy')}</span>`
		: '';
	return html`<div class="feed-card feed-card--image-only creation-grid__card" data-image-id="${escapeHtml(item?.id)}" data-media-type="${escapeHtml(type)}">
		<div class="${mediaClass}" aria-hidden="true" data-bg-url="${escapeHtml(thumbnail)}" data-bg-fallback="${escapeHtml(original)}" data-group-slides="${escapeHtml(JSON.stringify(slides))}"><img class="feed-card-img" alt="${escapeHtml(title || 'Creation')}" loading="lazy" decoding="async">${state}${challengeOverlay}${badges(item, { hideChallengeCorner: challengeBlur })}</div>
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
			element.matches('.creation-published-badge, .creation-challenge-locked-badge, .creation-group-badge, .creation-music-badge, .route-media-challenge-blur-overlay, .creation-challenge-entered-badge')
		);
		media.replaceChildren(stack, button('prev'), button('next'), ...overlays);
	}
	return { observe, disconnect: () => observer.disconnect() };
}
