import { notifyMutateQueueUpdated } from './mutateQueueEvents.js';
import { inputFromLegacyImage, normalizeCreationInput } from '../shared.js';
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
				const groupIdNum = Number(item.groupId);
				let input;
				try { input = item.input ? normalizeCreationInput(item.input) : inputFromLegacyImage(imageUrl, {
					sourceId: sourceIdNum, groupId: groupIdNum, fromFrame: item.fromFrame === true, frameTimeSec: item.frameTimeSec,
				}); } catch { return null; }
				const source = input.source;
				return {
					input,
					sourceId: source.member?.creationId ?? source.creationId ?? source.parentCreationId ?? null,
					...(source.groupId ? { groupId: source.groupId } : {}),
					imageUrl: input.preview.url,
					queuedAt: Number.isFinite(Number(item.queuedAt)) ? Number(item.queuedAt) : Date.now(),
					published,
					...(source.kind === 'derived-still' ? { fromFrame: true } : {}),
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
	const safe = Array.isArray(items) ? items : [];
	try {
		window.localStorage?.setItem(QUEUE_KEY, JSON.stringify(safe));
	} catch {
		// Ignore storage errors (quota, privacy mode, etc.)
		return;
	}
	if (options.skipNotify) return;
	notifyMutateQueueUpdated({ reason: options.reason || 'write', queueItems: safe });
}

export function loadMutateQueue() {
	return readQueue();
}

export function addToMutateQueue({ sourceId, groupId, imageUrl, published, fromFrame, frameTimeSec }) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	const idNum = Number(sourceId);
	if (!url) return;

	const current = readQueue();
	const groupIdNum = Number(groupId);
	const normalizedId = Number.isFinite(idNum) && idNum > 0 ? idNum : null;
	const normalizedGroupId = Number.isFinite(groupIdNum) && groupIdNum > 0 ? groupIdNum : null;
	const filtered = current.filter((item) => fromFrame === true
		? item.fromFrame !== true || item.sourceId !== normalizedId || !queueImageUrlsMatch(item.imageUrl, url)
		: normalizedId
		? item.fromFrame === true || item.sourceId !== normalizedId || (item.groupId ?? null) !== normalizedGroupId
		: item.sourceId || !queueImageUrlsMatch(item.imageUrl, url));
	const isPublished = published === true || published === 1;
	const frameSec = Number(frameTimeSec);
	const nextItem = {
		input: inputFromLegacyImage(url, { sourceId: normalizedId, groupId: normalizedGroupId, fromFrame, frameTimeSec }),
		sourceId: normalizedId,
		...(normalizedGroupId ? { groupId: normalizedGroupId } : {}),
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
		const sid = Number(sourceIds[i]);
		const groupId = Number(options.groupIds?.[i]);
		const requestedSourceId = Number.isFinite(sid) && sid > 0 ? sid : null;
		const requestedGroupId = Number.isFinite(groupId) && groupId > 0 ? groupId : null;
		const requestedInput = options.inputs?.[i] ? normalizeCreationInput(options.inputs[i]) : null;
		const idx = remaining.findIndex((item) => queueImageUrlsMatch(item.imageUrl, url) &&
			(item.sourceId ?? null) === requestedSourceId && (item.groupId ?? null) === requestedGroupId &&
			(!requestedInput || item.input.id === requestedInput.id));
		if (idx >= 0) {
			const prior = remaining[idx];
			next.push({
				...prior,
			});
			remaining.splice(idx, 1);
			continue;
		}
		next.push({
			input: requestedInput || inputFromLegacyImage(url, { sourceId: requestedSourceId, groupId: requestedGroupId }),
			sourceId: requestedSourceId,
			...(requestedGroupId ? { groupId: requestedGroupId } : {}),
			imageUrl: url,
			queuedAt: Date.now(),
			published: false,
		});
	}

	const same =
		next.length === current.length &&
		next.every((item, index) => queueImageUrlsMatch(item.imageUrl, current[index].imageUrl)
			&& item.sourceId === current[index].sourceId
			&& item.groupId === current[index].groupId
			&& item.input.source.kind === current[index].input.source.kind
			&& item.input.id === current[index].input.id);
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
	const groupIdNum = Number(item?.groupId);
	const isPublished = item?.published === true || item?.published === 1;
	writeQueue(
		[
			{
				input: inputFromLegacyImage(url, { sourceId: idNum, groupId: groupIdNum, fromFrame: item?.fromFrame === true, frameTimeSec: item?.frameTimeSec }),
				sourceId: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
				...(Number.isFinite(groupIdNum) && groupIdNum > 0 ? { groupId: groupIdNum } : {}),
				imageUrl: url,
				queuedAt: Date.now(),
				published: isPublished,
				...(item?.fromFrame === true ? { fromFrame: true } : {}),
			},
		],
		{ reason: 'replace' }
	);
}
