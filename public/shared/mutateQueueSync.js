/**
 * Sync mutate queue ↔ create attachment storage and lineage helpers.
 */

import {
	loadMutateQueue,
	reorderMutateQueueByImageUrls,
	replaceMutateQueueFromImageUrls,
	replaceMutateQueueHead,
	removeMutateQueueHead,
	addToMutateQueue,
} from './mutateQueue.js';
import {
	CREATE_PAGE_SELECTIONS_SESSION_KEY,
	CREATE_SETTINGS_STORAGE_KEYS,
	encodeSharedModelRoute,
	notifyCreateSettingsUpdated,
	persistSharedAspectRatio,
	persistSharedModelRoute,
	persistSharedOutputMode,
	persistSharedPrompt,
	persistSharedStyleSelected,
} from './createSettingsSync.js';
import {
	MUTATE_DEFAULT_METHOD_KEY,
	MUTATE_DEFAULT_MODEL,
	MUTATE_DEFAULT_SERVER_ID,
	MUTATE_VIDEO_DEFAULT_METHOD_KEY,
	MUTATE_VIDEO_DEFAULT_MODEL,
	MUTATE_VIDEO_LTX_METHOD_KEY,
	MUTATE_VIDEO_LTX_MODEL,
	MUTATE_VIDEO_LTX_SERVER_ID,
} from './generationDefaults.js';

export const MUTATE_QUEUE_UPDATED_EVENT = 'mutate-queue-updated';
export const MUTATE_QUEUE_STORAGE_KEY = 'mutateQueue:v1';

export const CREATE_ATTACHMENT_STORAGE_KEYS = {
	imageEditSelection: 'create_page_image_edit_selection',
	imageEditCarryover: 'create_page_image_edit_carryover',
};

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function mutateQueueImageUrlsMatch(a, b) {
	const left = typeof a === 'string' ? a.trim() : '';
	const right = typeof b === 'string' ? b.trim() : '';
	if (!left || !right) return false;
	if (left === right) return true;
	const normLeft = normalizeMutateQueueImageUrl(left);
	const normRight = normalizeMutateQueueImageUrl(right);
	if (normLeft && normRight && normLeft === normRight) return true;
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

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMutateQueueImageUrl(raw) {
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const origin =
			typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://example.invalid';
		const parsed = new URL(value, origin);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

/**
 * @typedef {object} MutateQueueAttachmentSnapshot
 * @property {string} imageUrl
 * @property {number | null} sourceId
 * @property {boolean | undefined} published
 * @property {boolean | undefined} fromFrame
 * @property {number | undefined} frameTimeSec
 */

/**
 * @param {ReturnType<typeof loadMutateQueue>} [queueItems]
 * @returns {MutateQueueAttachmentSnapshot[]}
 */
export function buildAttachmentSnapshotFromQueue(queueItems = loadMutateQueue()) {
	if (!Array.isArray(queueItems)) return [];
	return queueItems
		.map((item) => {
			const imageUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
			if (!imageUrl) return null;
			const sourceIdNum = Number(item?.sourceId);
			const frameTimeSec = Number(item?.frameTimeSec);
			return {
				imageUrl,
				sourceId: Number.isFinite(sourceIdNum) && sourceIdNum > 0 ? sourceIdNum : null,
				published: item?.published === true ? true : item?.published === false ? false : undefined,
				fromFrame: item?.fromFrame === true ? true : undefined,
				...(Number.isFinite(frameTimeSec) && frameTimeSec >= 0 ? { frameTimeSec } : {}),
			};
		})
		.filter(Boolean);
}

/**
 * @returns {string[]}
 */
export function readPersistedCreateAttachmentUrls() {
	try {
		const raw = window.localStorage?.getItem(CREATE_ATTACHMENT_STORAGE_KEYS.imageEditSelection);
		if (!raw || !String(raw).trim()) return [];
		const trimmed = String(raw).trim();
		if (trimmed.startsWith('[')) {
			const parsed = JSON.parse(trimmed);
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map((v) => (typeof v === 'string' ? v.trim() : ''))
				.filter(Boolean);
		}
		return [trimmed];
	} catch {
		return [];
	}
}

/**
 * @param {string[]} urls
 */
export function persistCreateAttachmentUrls(urls) {
	try {
		const list = Array.isArray(urls)
			? urls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
			: [];
		if (list.length > 0) {
			window.localStorage?.setItem(
				CREATE_ATTACHMENT_STORAGE_KEYS.imageEditSelection,
				JSON.stringify(list)
			);
		} else {
			window.localStorage?.removeItem(CREATE_ATTACHMENT_STORAGE_KEYS.imageEditSelection);
		}
	} catch {
		// ignore storage errors
	}
}

/**
 * Mirror queue URLs into composer/basic attachment storage.
 * @param {ReturnType<typeof loadMutateQueue>} [queueItems]
 */
export function syncCreateAttachmentStorageFromQueue(queueItems = loadMutateQueue()) {
	const urls = buildAttachmentSnapshotFromQueue(queueItems).map((item) => item.imageUrl);
	persistCreateAttachmentUrls(urls);
}

/**
 * @param {{ reason?: string, queueLength?: number }} [detail]
 */
export function notifyMutateQueueUpdated(detail = {}) {
	syncCreateAttachmentStorageFromQueue();
	try {
		if (typeof document !== 'undefined') {
			document.dispatchEvent(
				new CustomEvent(MUTATE_QUEUE_UPDATED_EVENT, {
					detail: {
						reason: typeof detail.reason === 'string' ? detail.reason : 'updated',
						queueLength: Array.isArray(loadMutateQueue()) ? loadMutateQueue().length : 0,
					},
				})
			);
		}
	} catch {
		// ignore
	}
}

/**
 * @param {string[]} imageUrls
 * @param {ReturnType<typeof loadMutateQueue>} [queueItems]
 * @returns {{ mutateOfId?: number, mutateParentIds?: number[] }}
 */
export function getMutateLineageForImageUrls(imageUrls, queueItems = loadMutateQueue()) {
	const urls = Array.isArray(imageUrls)
		? imageUrls.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
		: [];
	if (urls.length === 0 || !Array.isArray(queueItems) || queueItems.length === 0) return {};

	const parentSet = new Set();
	for (const url of urls) {
		for (const item of queueItems) {
			const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
			const sid = Number(item?.sourceId);
			if (!itemUrl || !Number.isFinite(sid) || sid <= 0) continue;
			if (!mutateQueueImageUrlsMatch(url, itemUrl)) continue;
			parentSet.add(sid);
			break;
		}
	}
	if (parentSet.size === 0) return {};

	const mutateParentIds = [...parentSet];
	return {
		mutateOfId: mutateParentIds.length === 1 ? mutateParentIds[0] : undefined,
		mutateParentIds,
	};
}

/**
 * Prefill values for provider image fields from queue (first URL / all URLs).
 * @param {Record<string, { type?: string }>} fields
 * @param {ReturnType<typeof loadMutateQueue>} [queueItems]
 * @returns {Record<string, string | string[]>}
 */
export function getMutateQueuePrefillForProviderFields(fields, queueItems = loadMutateQueue()) {
	if (!fields || typeof fields !== 'object') return {};
	const snapshots = buildAttachmentSnapshotFromQueue(queueItems);
	const urls = snapshots.map((item) => item.imageUrl);
	if (urls.length === 0) return {};

	const prefill = {};
	for (const [fieldKey, field] of Object.entries(fields)) {
		if (!field || typeof field !== 'object') continue;
		if (field.type === 'image_url') {
			prefill[fieldKey] = urls[0];
		} else if (field.type === 'image_url_array') {
			prefill[fieldKey] = [...urls];
		}
	}
	return prefill;
}

/**
 * @param {ReturnType<typeof loadMutateQueue>} [queueItems]
 * @returns {string}
 */
export function getPrimaryQueueImageUrl(queueItems = loadMutateQueue()) {
	const snapshots = buildAttachmentSnapshotFromQueue(queueItems);
	return snapshots[0]?.imageUrl || '';
}

/**
 * Match mutate queue order to an ordered URL list (e.g. advanced create image_url_array).
 * @param {unknown[]} orderedUrls
 */
export function syncMutateQueueOrderFromImageUrls(orderedUrls) {
	reorderMutateQueueByImageUrls(orderedUrls);
}

/**
 * Sync mutate queue from composer attachment strip order (URLs + optional source ids).
 * @param {unknown[]} orderedUrls
 * @param {Array<number | null | undefined>} [sourceIds]
 */
export function syncMutateQueueFromComposerAttachments(orderedUrls, sourceIds = []) {
	replaceMutateQueueFromImageUrls(orderedUrls, { sourceIds });
}

/**
 * @param {Record<string, unknown> | null | undefined} fieldValues
 * @param {Record<string, { type?: string }> | null | undefined} fields
 * @returns {{ kind: 'full', urls: string[] } | { kind: 'head', url: string } | { kind: 'empty' } | { kind: 'noop' }}
 */
export function planMutateQueueSyncFromProviderFields(fieldValues, fields) {
	if (!fields || typeof fields !== 'object') return { kind: 'noop' };

	let sawArrayField = false;
	/** @type {string[]} */
	const arrayUrls = [];

	for (const [key, field] of Object.entries(fields)) {
		if (!field || field.type !== 'image_url_array') continue;
		sawArrayField = true;
		const val = fieldValues?.[key];
		if (!Array.isArray(val)) continue;
		for (const item of val) {
			if (typeof item === 'string' && item.trim()) arrayUrls.push(item.trim());
		}
	}

	if (sawArrayField) {
		if (arrayUrls.length > 0) return { kind: 'full', urls: arrayUrls };
		return { kind: 'empty' };
	}

	for (const [key, field] of Object.entries(fields)) {
		if (!field || field.type !== 'image_url') continue;
		const val = fieldValues?.[key];
		if (typeof val === 'string' && val.trim()) return { kind: 'head', url: val.trim() };
	}

	const hasImageField = Object.values(fields).some(
		(field) => field?.type === 'image_url' || field?.type === 'image_url_array'
	);
	if (hasImageField) return { kind: 'empty' };
	return { kind: 'noop' };
}

/**
 * Sync mutate queue from advanced create provider image fields.
 * @param {Record<string, unknown> | null | undefined} fieldValues
 * @param {Record<string, { type?: string }> | null | undefined} fields
 */
export function syncMutateQueueFromProviderFieldValues(fieldValues, fields) {
	const plan = planMutateQueueSyncFromProviderFields(fieldValues, fields);
	if (plan.kind === 'full') {
		replaceMutateQueueFromImageUrls(plan.urls);
		return;
	}
	if (plan.kind === 'head') {
		replaceMutateQueueHead(plan.url);
		return;
	}
	if (plan.kind === 'empty') {
		replaceMutateQueueFromImageUrls([]);
	}
}

/**
 * Resolve server/method/model for mutate submit (image edit or image-to-video).
 * @param {'image-to-image' | 'image-to-video' | string} mode
 * @param {'ltx' | 'wan' | string} [i2vEngine]
 * @returns {{ serverId: number, methodKey: string, model: string, outputMode: 'image' | 'video' }}
 */
export function resolveMutateSubmitRoute(mode, i2vEngine = 'ltx') {
	if (mode === 'image-to-video' && i2vEngine === 'ltx') {
		return {
			serverId: MUTATE_VIDEO_LTX_SERVER_ID,
			methodKey: MUTATE_VIDEO_LTX_METHOD_KEY,
			model: MUTATE_VIDEO_LTX_MODEL,
			outputMode: 'video',
		};
	}
	if (mode === 'image-to-video') {
		return {
			serverId: MUTATE_DEFAULT_SERVER_ID,
			methodKey: MUTATE_VIDEO_DEFAULT_METHOD_KEY,
			model: MUTATE_VIDEO_DEFAULT_MODEL,
			outputMode: 'video',
		};
	}
	return {
		serverId: MUTATE_DEFAULT_SERVER_ID,
		methodKey: MUTATE_DEFAULT_METHOD_KEY,
		model: MUTATE_DEFAULT_MODEL,
		outputMode: 'image',
	};
}

/**
 * @param {Record<string, unknown> | null | undefined} args
 * @returns {Record<string, string | number | boolean | string[]>}
 */
function serializeCreationArgsForFieldValues(args) {
	const out = {};
	if (!args || typeof args !== 'object' || Array.isArray(args)) return out;
	for (const [key, val] of Object.entries(args)) {
		if (val == null) continue;
		if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
			out[key] = val;
			continue;
		}
		if (Array.isArray(val)) {
			const strings = val.filter((item) => typeof item === 'string' && item.trim());
			if (strings.length > 0 && strings.length === val.length) {
				out[key] = strings;
			}
		}
	}
	return out;
}

/**
 * Persist creation meta (server, method, provider args) so /create advanced opens with the same recipe.
 * Restores provider form fields from meta.args — does not use the mutate image queue (that would
 * mis-route the creation output into image fields).
 *
 * @param {{
 *   serverId?: number | null,
 *   methodKey?: string,
 *   args?: Record<string, unknown> | null,
 *   userPrompt?: string,
 *   outputMode?: 'image' | 'video',
 *   styleKey?: string,
 * }} snapshot
 * @returns {{ serverId: number, methodKey: string, model: string, outputMode: 'image' | 'video' } | null}
 */
export function syncCreationDetailToAdvancedCreate(snapshot = {}) {
	const serverId = Number(snapshot.serverId);
	const methodKey = typeof snapshot.methodKey === 'string' ? snapshot.methodKey.trim() : '';
	if (!Number.isFinite(serverId) || serverId < 1 || !methodKey) {
		return null;
	}

	const args =
		snapshot.args && typeof snapshot.args === 'object' && !Array.isArray(snapshot.args)
			? snapshot.args
			: {};
	const userPrompt = typeof snapshot.userPrompt === 'string' ? snapshot.userPrompt.trim() : '';
	const fieldValues = serializeCreationArgsForFieldValues(args);
	if (userPrompt) {
		fieldValues.prompt = userPrompt;
	}

	const aspect =
		typeof fieldValues.aspect_ratio === 'string' && fieldValues.aspect_ratio.trim()
			? fieldValues.aspect_ratio.trim()
			: '';
	const outputMode = snapshot.outputMode === 'video' ? 'video' : 'image';
	const model = typeof fieldValues.model === 'string' ? fieldValues.model.trim() : '';
	const advancedPrompt =
		userPrompt ||
		(typeof fieldValues.prompt === 'string' ? fieldValues.prompt.trim() : '');

	if (advancedPrompt) {
		persistSharedPrompt(advancedPrompt, { notify: false });
	}
	if (aspect) {
		persistSharedAspectRatio(aspect, { notify: false });
	}
	persistSharedOutputMode(outputMode, { notify: false });
	if (model) {
		persistSharedModelRoute(encodeSharedModelRoute(serverId, methodKey, model), {
			outputMode,
			notify: false,
		});
	}

	const styleKey =
		typeof snapshot.styleKey === 'string' && snapshot.styleKey.trim()
			? snapshot.styleKey.trim()
			: '';
	if (styleKey) {
		persistSharedStyleSelected(styleKey, { notify: false });
	}

	// Clear mutate queue / composer attachments so image fields restore from saved args only.
	try {
		replaceMutateQueueFromImageUrls([]);
		persistCreateAttachmentUrls([]);
	} catch {
		// ignore storage errors
	}

	try {
		const ss = typeof window !== 'undefined' ? window.sessionStorage : null;
		if (ss) {
			let selections = {};
			try {
				const stored = ss.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY);
				if (stored) selections = JSON.parse(stored);
			} catch {
				selections = {};
			}
			if (!selections || typeof selections !== 'object') selections = {};
			selections.serverId = serverId;
			selections.methodKey = methodKey;
			selections.tab = 'basic';
			selections.fieldValues = { ...fieldValues };
			const adv =
				selections.advancedOptions && typeof selections.advancedOptions === 'object'
					? selections.advancedOptions
					: {};
			selections.advancedOptions = {
				...adv,
				...(advancedPrompt ? { prompt: advancedPrompt } : {}),
			};
			ss.setItem(CREATE_PAGE_SELECTIONS_SESSION_KEY, JSON.stringify(selections));
		}
	} catch {
		// ignore storage errors
	}

	try {
		const ls = typeof window !== 'undefined' ? window.localStorage : null;
		if (ls) {
			ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.serverId, String(serverId));
			ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.methodKey, methodKey);
		}
	} catch {
		// ignore storage errors
	}

	notifyCreateSettingsUpdated();
	return { serverId, methodKey, model, outputMode };
}

/**
 * Queue source image and persist create settings so /create opens with the same route + draft.
 * Mirrors part of "Queue for later" plus shared settings sync used by app-route-create.
 *
 * @param {{
 *   mode?: 'image-to-image' | 'image-to-video' | string,
 *   i2vEngine?: 'ltx' | 'wan' | string,
 *   prompt?: string,
 *   aspectRatio?: string,
 *   imageUrl?: string,
 *   sourceId?: number | null,
 *   published?: boolean,
 * }} snapshot
 */
export function syncMutatePageToAdvancedCreate(snapshot = {}) {
	const mode = snapshot.mode === 'image-to-video' ? 'image-to-video' : 'image-to-image';
	const i2vEngine =
		snapshot.i2vEngine === 'wan' || snapshot.i2vEngine === 'replicate' ? 'wan' : 'ltx';
	const route = resolveMutateSubmitRoute(mode, i2vEngine);
	const promptText = typeof snapshot.prompt === 'string' ? snapshot.prompt : '';
	const aspect =
		typeof snapshot.aspectRatio === 'string' && snapshot.aspectRatio.trim()
			? snapshot.aspectRatio.trim()
			: '1:1';
	const url = typeof snapshot.imageUrl === 'string' ? snapshot.imageUrl.trim() : '';
	const sourceIdNum = Number(snapshot.sourceId);

	if (url && Number.isFinite(sourceIdNum) && sourceIdNum > 0) {
		addToMutateQueue({
			sourceId: sourceIdNum,
			imageUrl: url,
			published: snapshot.published === true || snapshot.published === 1,
		});
	}

	persistSharedPrompt(promptText, { notify: false });
	persistSharedAspectRatio(aspect, { notify: false });
	persistSharedOutputMode(route.outputMode, { notify: false });
	persistSharedModelRoute(encodeSharedModelRoute(route.serverId, route.methodKey, route.model), {
		outputMode: route.outputMode,
		notify: false,
	});

	try {
		const ss = typeof window !== 'undefined' ? window.sessionStorage : null;
		if (ss) {
			let selections = {};
			try {
				const stored = ss.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY);
				if (stored) selections = JSON.parse(stored);
			} catch {
				selections = {};
			}
			if (!selections || typeof selections !== 'object') selections = {};
			selections.serverId = route.serverId;
			selections.methodKey = route.methodKey;
			selections.tab = 'basic';
			const fv =
				selections.fieldValues && typeof selections.fieldValues === 'object'
					? selections.fieldValues
					: {};
			selections.fieldValues = {
				...fv,
				prompt: promptText,
				model: route.model,
				aspect_ratio: aspect,
			};
			const adv =
				selections.advancedOptions && typeof selections.advancedOptions === 'object'
					? selections.advancedOptions
					: {};
			selections.advancedOptions = { ...adv, prompt: promptText };
			ss.setItem(CREATE_PAGE_SELECTIONS_SESSION_KEY, JSON.stringify(selections));
		}
	} catch {
		// ignore storage errors
	}

	notifyCreateSettingsUpdated();
	return route;
}

export { replaceMutateQueueHead, removeMutateQueueHead };
