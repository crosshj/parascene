/**
 * Keeps feed vertical-video bytes alive so doom scroll can adopt the same
 * element instead of starting a second download when a card is opened.
 */
import { isFeedRowVideoCreation } from './chatFeedMobilePartition.js';
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
	video.muted = true;
	video.defaultMuted = true;
	video.playsInline = true;
	video.preload = 'auto';
	video.src = url;
	video.load();
	warmByUrl.set(url, video);
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
	return video instanceof HTMLVideoElement ? video : null;
}
