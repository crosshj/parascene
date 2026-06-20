const QUEUE_KEY = 'mutateQueue:v1';

function queueImageUrlsMatch(a, b) {
	const left = typeof a === 'string' ? a.trim() : '';
	const right = typeof b === 'string' ? b.trim() : '';
	if (!left || !right) return false;
	if (left === right) return true;
	try {
		const origin =
			typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://example.invalid';
		const pa = new URL(left, origin);
		const pb = new URL(right, origin);
		return pa.pathname === pb.pathname && pa.search === pb.search && pa.hash === pb.hash;
	} catch {
		return false;
	}
}

/** @typedef {import('./mutateQueueSync.js').MutateQueueAttachmentSnapshot} MutateQueueAttachmentSnapshot */

function readQueue() {
	try {
		const raw = window.localStorage?.getItem(QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const sourceIdNum = Number(item.sourceId);
				const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
				if (!imageUrl) return null;
				// Preserve published when present; legacy items may not have it (treat as unknown).
				const published =
					item.published === true || item.published === 1
						? true
						: item.published === false || item.published === 0
							? false
							: undefined;
				const frameTimeSec = Number(item.frameTimeSec);
				return {
					sourceId: Number.isFinite(sourceIdNum) && sourceIdNum > 0 ? sourceIdNum : null,
					imageUrl,
					queuedAt: Number.isFinite(Number(item.queuedAt)) ? Number(item.queuedAt) : Date.now(),
					published,
					...(item.fromFrame === true ? { fromFrame: true } : {}),
					...(Number.isFinite(frameTimeSec) && frameTimeSec >= 0 ? { frameTimeSec } : {}),
				};
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * @param {unknown[]} items
 * @param {{ reason?: string, skipNotify?: boolean }} [options]
 */
function writeQueue(items, options = {}) {
	try {
		const safe = Array.isArray(items) ? items : [];
		window.localStorage?.setItem(QUEUE_KEY, JSON.stringify(safe));
	} catch {
		// Ignore storage errors (quota, privacy mode, etc.)
		return;
	}
	if (options.skipNotify) return;
	void import('./mutateQueueSync.js').then(({ notifyMutateQueueUpdated }) => {
		notifyMutateQueueUpdated({ reason: options.reason || 'write' });
	}).catch(() => {
		// ignore sync module load errors
	});
}

export function loadMutateQueue() {
	return readQueue();
}

export function addToMutateQueue({ sourceId, imageUrl, published, fromFrame, frameTimeSec }) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	const idNum = Number(sourceId);
	if (!url) return;

	const current = readQueue();
	const filtered = current.filter((item) => !queueImageUrlsMatch(item.imageUrl, url));
	const isPublished = published === true || published === 1;
	const frameSec = Number(frameTimeSec);
	const nextItem = {
		sourceId: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
		imageUrl: url,
		queuedAt: Date.now(),
		published: isPublished,
		...(fromFrame === true ? { fromFrame: true } : {}),
		...(Number.isFinite(frameSec) && frameSec >= 0 ? { frameTimeSec: frameSec } : {}),
	};
	filtered.unshift(nextItem);
	writeQueue(filtered, { reason: 'add' });
}

export function removeFromMutateQueueByImageUrl(imageUrl) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	if (!url) return;
	const current = readQueue();
	const next = current.filter((item) => !queueImageUrlsMatch(item.imageUrl, url));
	if (next.length === current.length) return;
	writeQueue(next, { reason: 'remove' });
}

/**
 * Reorder queue items to match provider image_url_array order. Unmatched queue items stay at the tail.
 * @param {unknown[]} orderedUrls
 * @returns {boolean} true when queue was rewritten
 */
export function reorderMutateQueueByImageUrls(orderedUrls) {
	const urls = Array.isArray(orderedUrls)
		? orderedUrls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	if (urls.length === 0) return false;

	const current = readQueue();
	if (current.length === 0) return false;

	const remaining = [...current];
	/** @type {typeof current} */
	const next = [];
	for (const url of urls) {
		const idx = remaining.findIndex((item) => queueImageUrlsMatch(item.imageUrl, url));
		if (idx >= 0) {
			next.push(remaining[idx]);
			remaining.splice(idx, 1);
		}
	}
	next.push(...remaining);

	const sameOrder =
		next.length === current.length &&
		next.every((item, index) => queueImageUrlsMatch(item.imageUrl, current[index].imageUrl));
	if (sameOrder) return false;

	writeQueue(next, { reason: 'reorder' });
	return true;
}

/**
 * Replace queue with an ordered URL list (composer / attachment strip). Preserves metadata for
 * existing items; creates entries for new URLs. Drops queue items not in the list.
 * @param {unknown[]} orderedUrls
 * @param {{ sourceIds?: Array<number | null | undefined> }} [options]
 * @returns {boolean}
 */
export function replaceMutateQueueFromImageUrls(orderedUrls, options = {}) {
	const urls = Array.isArray(orderedUrls)
		? orderedUrls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	const sourceIds = Array.isArray(options.sourceIds) ? options.sourceIds : [];

	const current = readQueue();

	if (urls.length === 0) {
		if (current.length === 0) return false;
		writeQueue([], { reason: 'replace-from-attachments' });
		return true;
	}

	const remaining = [...current];
	/** @type {typeof current} */
	const next = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		const idx = remaining.findIndex((item) => queueImageUrlsMatch(item.imageUrl, url));
		if (idx >= 0) {
			next.push(remaining[idx]);
			remaining.splice(idx, 1);
			continue;
		}
		const sid = Number(sourceIds[i]);
		next.push({
			sourceId: Number.isFinite(sid) && sid > 0 ? sid : null,
			imageUrl: url,
			queuedAt: Date.now(),
			published: false,
		});
	}

	const same =
		next.length === current.length &&
		next.every((item, index) => queueImageUrlsMatch(item.imageUrl, current[index].imageUrl));
	if (same) return false;

	writeQueue(next, { reason: 'replace-from-attachments' });
	return true;
}

/**
 * Set queue head to url; keeps tail order (drops previous head). Promotes url if already in queue.
 * @param {string} headUrl
 * @returns {boolean}
 */
export function replaceMutateQueueHead(headUrl) {
	const url = typeof headUrl === 'string' ? headUrl.trim() : '';
	if (!url) return false;

	const current = readQueue();
	let headItem = current.find((item) => queueImageUrlsMatch(item.imageUrl, url));
	if (!headItem) {
		headItem = {
			sourceId: null,
			imageUrl: url,
			queuedAt: Date.now(),
			published: false,
		};
	}
	const tail = current
		.slice(1)
		.filter((item) => !queueImageUrlsMatch(item.imageUrl, headItem.imageUrl));

	const next = [headItem, ...tail];
	const same =
		next.length === current.length &&
		next.every((item, index) => queueImageUrlsMatch(item.imageUrl, current[index].imageUrl));
	if (same) return false;

	writeQueue(next, { reason: 'replace-head' });
	return true;
}

/** Drop the front queue item. @returns {boolean} */
export function removeMutateQueueHead() {
	const current = readQueue();
	if (current.length === 0) return false;
	writeQueue(current.slice(1), { reason: 'remove-head' });
	return true;
}

export function clearMutateQueue() {
	writeQueue([], { reason: 'clear' });
}

/**
 * Replace queue with a single item without clearing attachment storage first.
 * Used after immediate mutate submit to keep chaining context.
 */
export function replaceMutateQueueSingleItem(item) {
	const url = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
	if (!url) {
		writeQueue([], { reason: 'replace-clear' });
		return;
	}
	const idNum = Number(item?.sourceId);
	const isPublished = item?.published === true || item?.published === 1;
	writeQueue(
		[
			{
				sourceId: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
				imageUrl: url,
				queuedAt: Date.now(),
				published: isPublished,
				...(item?.fromFrame === true ? { fromFrame: true } : {}),
			},
		],
		{ reason: 'replace' }
	);
}
