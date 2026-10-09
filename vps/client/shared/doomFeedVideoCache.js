/**
 * Keeps feed vertical-video bytes alive so doom scroll can adopt the same
 * element instead of starting a second download when a card is opened.
 */
import { isFeedRowVideoCreation } from './chatFeedMobilePartition.js';
import { resumeMediaAudioLevelingFromGesture, primeMediaElementForAudioLeveling } from './mediaAudioLeveling.js';
import { nsfwShouldBlur } from './nsfwPolicy.js';
import { feedItemPlayableVideoUrl } from './videoFirstFramePoster.js';

const MAX_WARMED = 8;
const MAX_ITEMS = 40;
/** @type {Map<string, object>} */
const itemsById = new Map();
/** @type {Map<string, HTMLVideoElement>} */
const warmByUrl = new Map();

function creationKey(item) {
	const id = item?.created_image_id ?? item?.id;
	if (id == null || id === '') return '';
	return String(id);
}

/**
 * @param {object | null | undefined} item
 */
export function rememberFeedDoomVideo(item) {
	if (!isFeedRowVideoCreation(item)) return;
	const key = creationKey(item);
	const url = feedItemPlayableVideoUrl(item);
	if (!key || !url) return;
	itemsById.delete(key);
	itemsById.set(key, item);
	while (itemsById.size > MAX_ITEMS) {
		const oldest = itemsById.keys().next().value;
		itemsById.delete(oldest);
	}
	if (warmByUrl.has(url) || warmByUrl.size >= MAX_WARMED) return;
	const video = document.createElement('video');
	/* Property only. `defaultMuted` writes the muted attribute, and the claimed
	   opener then stays silent after `.muted = false`. */
	video.muted = true;
	video.defaultMuted = false;
	video.playsInline = true;
	video.preload = 'auto';
	video.src = url;
	video.load();
	warmByUrl.set(url, video);
}

function doomPreferMuted() {
	try {
		return sessionStorage.getItem('chatDoomPreferMuted') === '1';
	} catch {
		return false;
	}
}

function parkGestureVideo(video) {
	if (typeof document === 'undefined' || video.isConnected) return;
	video.style.position = 'fixed';
	video.style.width = '1px';
	video.style.height = '1px';
	video.style.opacity = '0';
	video.style.pointerEvents = 'none';
	video.style.left = '0';
	video.style.top = '0';
	document.body.appendChild(video);
}

/**
 * Call from the feed tap that opens doom, before any await.
 * The opener is the only clip started outside that gesture, so browsers
 * leave it muted unless this element begins playback here.
 * @param {object | null | undefined} item
 */
export function primeDoomAudiblePlayback(item) {
	resumeMediaAudioLevelingFromGesture();
	if (!isFeedRowVideoCreation(item) || nsfwShouldBlur(item) || doomPreferMuted()) return;
	const url = feedItemPlayableVideoUrl(item);
	if (!url || typeof document === 'undefined') return;

	let video = warmByUrl.get(url);
	if (!(video instanceof HTMLVideoElement)) {
		if (warmByUrl.size >= MAX_WARMED) {
			const oldest = warmByUrl.keys().next().value;
			const evicted = oldest ? warmByUrl.get(oldest) : null;
			if (oldest) warmByUrl.delete(oldest);
			if (evicted instanceof HTMLVideoElement) {
				evicted.pause();
				evicted.remove();
			}
		}
		video = document.createElement('video');
		video.playsInline = true;
		video.setAttribute('playsinline', '');
		video.preload = 'auto';
		video.loop = true;
		primeMediaElementForAudioLeveling(video);
		video.src = url;
		warmByUrl.set(url, video);
	} else {
		primeMediaElementForAudioLeveling(video);
	}

	video.defaultMuted = false;
	video.removeAttribute('muted');
	video.muted = false;
	video.volume = 1;
	video.dataset.doomAudibleGesture = '1';
	parkGestureVideo(video);
	try {
		const pending = video.play();
		if (pending && typeof pending.catch === 'function') pending.catch(() => {});
	} catch {
		// ignore
	}
}

/**
 * Feed row already on screen for this doom anchor, if one was remembered.
 * @param {number | string} creationId
 * @returns {object | null}
 */
export function feedDoomVideoItem(creationId) {
	return itemsById.get(String(creationId)) || null;
}

/**
 * Prefer an explicit navigation seed, then the feed cache.
 * @param {object | null | undefined} seed
 * @param {number | string} creationId
 * @returns {object | null}
 */
export function doomSeedItem(seed, creationId) {
	const id = Number(creationId);
	const seeded = seed && Number(seed.created_image_id ?? seed.id) === id ? seed : null;
	const item = seeded || feedDoomVideoItem(creationId);
	return isFeedRowVideoCreation(item) ? item : null;
}

/**
 * Hand the in-flight element to the doom slide. A new element would start over.
 * @param {string} url
 * @returns {HTMLVideoElement | null}
 */
export function claimWarmedDoomVideo(url) {
	const key = String(url || '').trim();
	if (!key || !warmByUrl.has(key)) return null;
	const video = warmByUrl.get(key) || null;
	warmByUrl.delete(key);
	if (video instanceof HTMLVideoElement) {
		video.style.removeProperty('position');
		video.style.removeProperty('width');
		video.style.removeProperty('height');
		video.style.removeProperty('opacity');
		video.style.removeProperty('pointer-events');
		video.style.removeProperty('left');
		video.style.removeProperty('top');
	}
	return video instanceof HTMLVideoElement ? video : null;
}
