/**
 * Feed [beta] batched viewport impressions → sessionStorage queue → POST /api/feed/impressions.
 */

import { readFeedBetaEnabledSync } from './feedBetaNav.js';
import {
	FLUSH_INTERVAL_MS,
	FLUSH_MAX_ITEMS,
	QUEUE_STORAGE_KEY,
	SENT_STORAGE_KEY,
	coalesceImpressionQueue,
	mergeImpressionIntoQueue,
	parseStoredImpressionQueue,
	parseStoredSentCreationIds,
	serializeSentCreationIds,
	shouldSkipImpressionEnqueue
} from './feedImpressionQueue.js';

const IMPRESSION_THRESHOLD = 0.5;
const IMPRESSION_MIN_MS = 3000;

/** @type {number|null} */
let flushTimer = null;
let flushInFlight = false;

function readQueueFromStorage() {
	if (typeof sessionStorage === 'undefined') return [];
	try {
		return parseStoredImpressionQueue(sessionStorage.getItem(QUEUE_STORAGE_KEY));
	} catch {
		return [];
	}
}

function writeQueueToStorage(queue) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(coalesceImpressionQueue(queue)));
	} catch {
		try {
			const trimmed = coalesceImpressionQueue(queue).slice(-Math.max(1, Math.floor(queue.length / 2)));
			sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(trimmed));
		} catch {
			// ignore
		}
	}
}

function readSentFromStorage() {
	if (typeof sessionStorage === 'undefined') return new Set();
	try {
		return parseStoredSentCreationIds(sessionStorage.getItem(SENT_STORAGE_KEY));
	} catch {
		return new Set();
	}
}

function addSentToStorage(ids) {
	if (typeof sessionStorage === 'undefined') return;
	const sent = readSentFromStorage();
	for (const id of ids) {
		const s = String(id ?? '').trim();
		if (s) sent.add(s);
	}
	try {
		sessionStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(serializeSentCreationIds(sent)));
	} catch {
		// ignore
	}
}

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

function enqueueFeedImpression(item, trigger, surface) {
	const rawId = item?.created_image_id ?? item?.id;
	const creationId = Number(rawId);
	if (!Number.isFinite(creationId) || creationId <= 0) return;

	const sent = readSentFromStorage();
	const queue = readQueueFromStorage();
	if (shouldSkipImpressionEnqueue(sent, queue, creationId, trigger)) return;

	const entry = {
		creation_id: creationId,
		trigger,
		surface: surface || null,
		attribution: attributionFromItem(item),
		queued_at: new Date().toISOString()
	};
	writeQueueToStorage(mergeImpressionIntoQueue(queue, entry));

	if (trigger === 'click' || readQueueFromStorage().length >= FLUSH_MAX_ITEMS) {
		void flushImpressionQueue({ keepalive: trigger === 'click' });
		return;
	}
	scheduleImpressionFlush();
}

function scheduleImpressionFlush() {
	if (flushTimer != null) return;
	flushTimer = window.setTimeout(() => {
		flushTimer = null;
		void flushImpressionQueue({});
	}, FLUSH_INTERVAL_MS);
}

export async function flushImpressionQueue(opts = {}) {
	if (typeof window === 'undefined' || flushInFlight) return;
	if (!readFeedBetaEnabledSync()) return;

	const queue = coalesceImpressionQueue(readQueueFromStorage());
	if (queue.length === 0) return;

	flushInFlight = true;
	try {
		const res = await fetch('/api/feed/impressions', {
			method: 'POST',
			credentials: 'include',
			keepalive: opts.keepalive === true,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ items: queue })
		});
		if (!res.ok) return;

		writeQueueToStorage([]);
		addSentToStorage(queue.map((row) => row.creation_id));
	} catch {
		// leave queue for retry
	} finally {
		flushInFlight = false;
	}
}

export function recordFeedImpressionOnClick(item, opts = {}) {
	if (typeof window === 'undefined') return;
	if (!readFeedBetaEnabledSync()) return;
	enqueueFeedImpression(item, 'click', opts.surface);
}

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
							enqueueFeedImpression(item, 'dwell', opts.surface);
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

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	void flushImpressionQueue({});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			void flushImpressionQueue({ keepalive: true });
		}
	});
	window.addEventListener('pagehide', () => {
		void flushImpressionQueue({ keepalive: true });
	});
}
