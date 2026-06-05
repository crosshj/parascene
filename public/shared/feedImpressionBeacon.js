/**
 * Feed [beta] viewport impression beacons → POST /api/feed/impression → prsn_user_creation_seen.
 */

import { readFeedBetaEnabledSync } from './feedBetaNav.js';

const IMPRESSION_THRESHOLD = 0.5;
const IMPRESSION_MIN_MS = 1000;
const reportedKeys = new Set();

/**
 * @param {object|null|undefined} item
 * @returns {object}
 */
function attributionFromItem(item) {
	const dev =
		item?.feed_beta_why?.developer && typeof item.feed_beta_why.developer === 'object'
			? item.feed_beta_why.developer
			: {};
	return {
		pool: dev.pool ?? null,
		source: dev.source ?? null,
		thread: dev.thread ?? null,
		page_index: dev.page_index ?? null,
		position_in_page: dev.position_in_page ?? null,
		mobile_slot_index: dev.mobile_slot_index ?? null
	};
}

/**
 * @param {number} creationId
 * @param {object} item
 * @param {string} [surface]
 */
async function postFeedImpression(creationId, item, surface) {
	const key = String(creationId);
	if (reportedKeys.has(key)) return;
	reportedKeys.add(key);
	try {
		await fetch('/api/feed/impression', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				creation_id: creationId,
				surface: surface || null,
				attribution: attributionFromItem(item)
			})
		});
	} catch {
		reportedKeys.delete(key);
	}
}

/**
 * @param {HTMLElement} card
 * @param {object} item
 * @param {{ surface?: string, target?: Element|null }} [opts]
 */
export function attachFeedImpressionBeacon(card, item, opts = {}) {
	if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
	if (!readFeedBetaEnabledSync()) return;

	const rawId = item?.created_image_id ?? item?.id;
	const creationId = Number(rawId);
	if (!(card instanceof HTMLElement) || !Number.isFinite(creationId) || creationId <= 0) return;
	if (card.dataset.feedImpressionBeacon === '1') return;
	card.dataset.feedImpressionBeacon = '1';

	const target = opts.target instanceof Element ? opts.target : card.querySelector('.feed-card-image') || card;
	let visibleSince = 0;
	let timer = null;

	const observer = new IntersectionObserver(
		(entries) => {
			const entry = entries[0];
			const ratio = entry?.intersectionRatio ?? 0;
			const visible = Boolean(entry?.isIntersecting && ratio >= IMPRESSION_THRESHOLD);
			if (visible) {
				if (!visibleSince) visibleSince = Date.now();
				if (!timer) {
					timer = window.setTimeout(() => {
						timer = null;
						if (Date.now() - visibleSince >= IMPRESSION_MIN_MS) {
							void postFeedImpression(creationId, item, opts.surface);
							observer.disconnect();
						}
					}, IMPRESSION_MIN_MS);
				}
				return;
			}
			visibleSince = 0;
			if (timer) {
				window.clearTimeout(timer);
				timer = null;
			}
		},
		{ threshold: [0, IMPRESSION_THRESHOLD, 1] }
	);

	observer.observe(target);
}
