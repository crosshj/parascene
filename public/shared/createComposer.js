/**
 * Basic create page composer — unified card UI (attach, prompt, toolbar, style overflow).
 */

import { sendIcon } from '/icons/svg-strings.js';
import {
	ASPECT_RATIO_PRESETS,
	ASPECT_RATIO_SELECTOR_LABELS,
	parseAspectRatioString,
	shouldUseAspectRatioSelector,
} from '/shared/aspectRatio.js';
import {
	MUTATE_DEFAULT_METHOD_KEY,
	MUTATE_DEFAULT_SERVER_ID,
	MUTATE_VIDEO_DEFAULT_METHOD_KEY,
	MUTATE_VIDEO_DEFAULT_MODEL,
	MUTATE_VIDEO_LTX_METHOD_KEY,
	MUTATE_VIDEO_LTX_MODEL,
	PARASCENE_BLUE_SERVER_ID,
} from '/shared/generationDefaults.js';
import {
	formatMentionsFailureForDialog,
	readImageUrlDimensions,
	readRasterFileDimensions,
	submitCreationWithPending,
	uploadImageFile,
} from '/shared/createSubmit.js';
import { isTriggeredSuggestPopupOpen } from '/shared/triggeredSuggest.js';
import { composerEnterKeySubmits } from '/shared/autogrow.js';
import { bindCreateComposerCreationDropTargets } from '/shared/creationComposerDrag.js';
import { addToMutateQueue, loadMutateQueue, removeFromMutateQueueByImageUrl } from '/shared/mutateQueue.js';
import {
	MUTATE_QUEUE_UPDATED_EVENT,
	buildAttachmentSnapshotFromQueue,
	mutateQueueImageUrlsMatch,
	syncMutateQueueFromComposerAttachments,
} from '/shared/mutateQueueSync.js';
import {
	CREATE_SETTINGS_STORAGE_KEYS,
	CREATE_SETTINGS_UPDATED_EVENT,
	mergeSharedSettingsIntoSessionSelections,
	readSharedCreateSettings,
	resolveSharedPrompt,
	writeSharedCreateSettingsFromComposerSnapshot,
} from '/shared/createSettingsSync.js';
import { attachPromptFieldClear } from '/shared/promptFieldClear.js';

const BASIC_CREATE_DEFAULT_SERVER_ID = 1;
const BASIC_CREATE_DEFAULT_METHOD_KEY = 'replicate';
const BASIC_CREATE_DEFAULT_MODEL = 'xai/grok-imagine-image';
const BASIC_MODEL_DISPLAY = 'Z-Image Turbo';

const MVP_ASPECT_RATIOS = ['1:1', '9:16', '4:5', '16:9'];

/** Local copy — avoid static-importing new aspectRatio.js exports (stale module cache breaks mount). */
function closestAspectRatioPreset(width, height, keys = MVP_ASPECT_RATIOS) {
	const w = Number(width);
	const h = Number(height);
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return '1:1';
	const actual = w / h;
	let bestKey = '1:1';
	let bestDelta = Infinity;
	for (const key of keys) {
		const preset = parseAspectRatioString(key);
		if (!preset) continue;
		const expected = preset[0] / preset[1];
		const delta = Math.abs(Math.log(actual / expected));
		if (delta < bestDelta) {
			bestDelta = delta;
			bestKey = key;
		}
	}
	return bestKey;
}

function buildAspectRatioMismatchMessage({
	targetAspect,
	detectedAspect,
	uploadAspect,
	context = 'this job',
}) {
	const target = String(targetAspect || '').trim();
	if (!target) return '';
	const upload = String(uploadAspect || '').trim();
	const detected = String(detectedAspect || '').trim();
	if (upload && upload !== target) {
		return `The image was prepared for ${upload}, but ${context} is set to ${target}.`;
	}
	if (detected && detected !== target) {
		return `The image looks like ${detected}, but ${context} is set to ${target}.`;
	}
	return '';
}

function dimensionsMatchAspectRatioLocal(width, height, aspectKey) {
	const w = Number(width);
	const h = Number(height);
	const preset = parseAspectRatioString(aspectKey);
	if (!preset || w <= 0 || h <= 0) return null;
	const actual = w / h;
	const expected = preset[0] / preset[1];
	return Math.abs(actual - expected) <= 0.04 * expected;
}

const STORAGE_KEYS = {
	prompt: 'create_page_prompt',
	promptText: 'create_page_prompt_text',
	promptImageEdit: 'create_page_prompt_image_edit',
	aspectRatio: 'create_page_aspect_ratio',
	model: CREATE_SETTINGS_STORAGE_KEYS.composerModel,
	modelLabel: CREATE_SETTINGS_STORAGE_KEYS.composerModelLabel,
	styleIndex: 'create_page_style_index',
	styleSelected: 'create_page_style_selected',
	imageEditSelection: 'create_page_image_edit_selection',
	imageEditCarryover: 'create_page_image_edit_carryover',
	outputMode: 'create_page_output_mode',
	videoModel: CREATE_SETTINGS_STORAGE_KEYS.composerVideoModel,
	methodCredits: 'create_page_method_credits',
};

/** @typedef {{ selectValue: string, value: string, label: string, serverId: number, methodKey: string, methodLabel: string }} ComposerModelRouteOption */

/** @typedef {ComposerModelRouteOption} VideoModelOption */

/** @typedef {ComposerModelRouteOption} ImageModelOption */

function encodeComposerRouteKey(serverId, methodKey, model) {
	return `${serverId}\x1e${methodKey}\x1e${model}`;
}

function encodeVideoRouteKey(serverId, methodKey, model) {
	return encodeComposerRouteKey(serverId, methodKey, model);
}

/**
 * @param {string} key
 * @returns {{ serverId: number, methodKey: string, model: string } | null}
 */
function parseComposerRouteKey(key) {
	const parts = String(key).split('\x1e');
	if (parts.length < 3) return null;
	const serverId = Number(parts[0]);
	const methodKey = parts[1];
	const model = parts.slice(2).join('\x1e');
	if (!Number.isFinite(serverId) || serverId < 1 || !methodKey || !model) return null;
	return { serverId, methodKey, model };
}

function parseVideoRouteKey(key) {
	return parseComposerRouteKey(key);
}

/**
 * @param {number} serverId
 * @param {string} methodKey
 * @param {string} model
 * @param {string} label
 * @param {string} [methodLabel]
 * @returns {ImageModelOption}
 */
function toImageModelOption(serverId, methodKey, model, label, methodLabel) {
	const value = String(model || '').trim();
	const display = String(label || value).trim() || value;
	const key = String(methodKey);
	return {
		selectValue: encodeComposerRouteKey(serverId, key, value),
		value,
		label: display,
		serverId: Number(serverId),
		methodKey: key,
		methodLabel: String(methodLabel || '').trim() || getComposerMethodGroupLabel(null, key),
	};
}

/**
 * @param {unknown} methodDef
 * @param {string} methodKey
 * @returns {string}
 */
function getComposerMethodGroupLabel(methodDef, methodKey) {
	if (methodDef && typeof methodDef === 'object') {
		const name = /** @type {{ name?: unknown }} */ (methodDef).name;
		if (typeof name === 'string' && name.trim()) return name.trim();
	}
	const key = String(methodKey || '').trim();
	if (key === MUTATE_VIDEO_LTX_METHOD_KEY) return 'LTX Self-hosted';
	if (key === MUTATE_VIDEO_DEFAULT_METHOD_KEY) return 'WAN Cloud';
	return formatMethodKeyLabel(key);
}

/**
 * @param {string} methodKey
 * @returns {string}
 */
function formatMethodKeyLabel(methodKey) {
	const key = String(methodKey || '').trim();
	if (!key) return 'Other';
	return key
		.replace(/[_-]+/g, ' ')
		.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * @param {ComposerModelRouteOption[]} routeOptions
 * @param {(opt: ComposerModelRouteOption) => string} labelForOption
 * @param {HTMLSelectElement} selectEl
 */
function appendGroupedRouteOptionsToSelect(selectEl, routeOptions, labelForOption) {
	/** @type {Map<string, { groupLabel: string, options: ComposerModelRouteOption[] }>} */
	const groups = new Map();
	/** @type {string[]} */
	const order = [];
	for (const opt of routeOptions) {
		const groupKey = `${opt.serverId}:${opt.methodKey}`;
		if (!groups.has(groupKey)) {
			order.push(groupKey);
			groups.set(groupKey, {
				groupLabel: opt.methodLabel || formatMethodKeyLabel(opt.methodKey),
				options: [],
			});
		}
		groups.get(groupKey).options.push(opt);
	}
	for (const groupKey of order) {
		const group = groups.get(groupKey);
		if (!group?.options.length) continue;
		const optgroup = document.createElement('optgroup');
		optgroup.label = group.groupLabel;
		for (const opt of group.options) {
			const option = document.createElement('option');
			option.value = opt.selectValue;
			option.textContent = labelForOption(opt) || opt.label || opt.value;
			optgroup.appendChild(option);
		}
		selectEl.appendChild(optgroup);
	}
}

function readStoredOutputMode() {
	try {
		const v = localStorage.getItem(STORAGE_KEYS.outputMode);
		return v === 'video' ? 'video' : 'image';
	} catch {
		return 'image';
	}
}

function readStoredModelValue() {
	try {
		const composer = localStorage.getItem(STORAGE_KEYS.model);
		return typeof composer === 'string' && composer.trim() ? composer.trim() : '';
	} catch {
		return '';
	}
}

function readStoredModelLabel() {
	try {
		const composer = localStorage.getItem(STORAGE_KEYS.modelLabel);
		return typeof composer === 'string' && composer.trim() ? composer.trim() : '';
	} catch {
		return '';
	}
}

/**
 * Pick the first stored route key that exists in the composer's model list.
 * Composer key wins over shared /create route so a fallback UI default never clobbers advanced.
 *
 * @param {ComposerModelRouteOption[]} routeOptions
 * @param {string[]} storedKeys
 * @returns {string}
 */
function resolveComposerRouteFromStorage(routeOptions, storedKeys) {
	for (const saved of storedKeys) {
		if (typeof saved !== 'string' || !saved.trim()) continue;
		const key = saved.trim();
		if (routeOptions.some((o) => o.selectValue === key)) return key;
		const byValue = routeOptions.find((o) => o.value === key);
		if (byValue?.selectValue) return byValue.selectValue;
	}
	return '';
}

/**
 * @returns {string[]}
 */
function readStoredAttachmentUrls() {
	try {
		const raw = localStorage.getItem(STORAGE_KEYS.imageEditSelection);
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
 * @param {unknown} raw — string[], { value, label }[], or { [modelId]: label } map from server_config.
 * @returns {CreateComposerModelOption[]}
 */
function normalizeModelOptions(raw) {
	if (raw == null) return [];
	if (Array.isArray(raw)) {
		return raw
			.map((item) => {
				if (typeof item === 'string') {
					const value = item.trim();
					return value ? { value, label: value } : null;
				}
				if (Array.isArray(item) && item.length > 0) {
					const value = String(item[0] ?? '').trim();
					if (!value) return null;
					const label = String(item[1] ?? item[0] ?? '').trim() || value;
					return { value, label };
				}
				if (item && typeof item === 'object') {
					const value = String(
						item.value ?? item.id ?? item.name ?? item.label ?? ''
					).trim();
					if (!value) return null;
					const label =
						String(item.label ?? item.name ?? item.value ?? item.id ?? value).trim() ||
						value;
					return { value, label };
				}
				return null;
			})
			.filter(Boolean);
	}
	if (typeof raw === 'object') {
		return Object.entries(/** @type {Record<string, unknown>} */ (raw))
			.map(([key, val]) => {
				if (val && typeof val === 'object' && !Array.isArray(val)) {
					const rec = /** @type {{ value?: unknown, id?: unknown, label?: unknown, name?: unknown }} */ (
						val
					);
					const value = String(rec.value ?? rec.id ?? key).trim();
					if (!value) return null;
					const label =
						String(rec.label ?? rec.name ?? rec.value ?? value).trim() || value;
					return { value, label };
				}
				const value = String(key).trim();
				if (!value) return null;
				const label = typeof val === 'string' ? val.trim() : value;
				return { value, label: label || value };
			})
			.filter(Boolean);
	}
	return [];
}

/**
 * @param {VideoModelOption | null | undefined} option
 * @returns {string}
 */
function getVideoOptionLabel(option) {
	if (!option) return 'Video model';
	const label = String(option.label || '').trim();
	if (label) return label;
	if (
		option.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY &&
		option.value === MUTATE_VIDEO_LTX_MODEL
	) {
		return 'LTX Self-hosted';
	}
	if (option.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY) return 'LTX';
	if (option.methodKey === MUTATE_VIDEO_DEFAULT_METHOD_KEY) return 'WAN Cloud';
	const parsed = parseVideoRouteKey(option.selectValue);
	if (parsed?.model) return parsed.model;
	return 'Video model';
}

/**
 * @param {unknown} server
 * @returns {Record<string, unknown> | null}
 */
function parseServerConfig(server) {
	if (!server || typeof server !== 'object') return null;
	let cfg = /** @type {{ server_config?: unknown }} */ (server).server_config;
	if (typeof cfg === 'string') {
		try {
			cfg = JSON.parse(cfg);
		} catch {
			return null;
		}
	}
	return cfg && typeof cfg === 'object' ? /** @type {Record<string, unknown>} */ (cfg) : null;
}

/**
 * Image model options on a server, each tied to the method that owns the model field.
 * @param {unknown} server
 * @returns {ImageModelOption[]}
 */
function collectImageModelOptionsFromServer(server) {
	const cfg = parseServerConfig(server);
	const methods =
		cfg?.methods && typeof cfg.methods === 'object'
			? /** @type {Record<string, { fields?: Record<string, { options?: unknown, choices?: unknown, enum?: unknown }> }>} */ (
					cfg.methods
				)
			: null;
	if (!methods || !server) return [];
	const serverId = Number(/** @type {{ id?: unknown }} */ (server).id);
	if (!Number.isFinite(serverId) || serverId < 1) return [];
	const seen = new Set();
	/** @type {ImageModelOption[]} */
	const out = [];
	for (const [methodKey, methodDef] of Object.entries(methods)) {
		if (
			methodKey === MUTATE_VIDEO_DEFAULT_METHOD_KEY ||
			methodKey === MUTATE_VIDEO_LTX_METHOD_KEY
		) {
			continue;
		}
		const field = methodDef?.fields?.model;
		if (!field) continue;
		const methodLabel = getComposerMethodGroupLabel(methodDef, methodKey);
		const opts = normalizeModelOptions(field.options ?? field.choices ?? field.enum);
		for (const opt of opts) {
			if (!opt.value) continue;
			const row = toImageModelOption(serverId, methodKey, opt.value, opt.label, methodLabel);
			if (seen.has(row.selectValue)) continue;
			seen.add(row.selectValue);
			out.push(row);
		}
	}
	return out;
}

/**
 * @param {unknown} methodDef
 * @returns {number | null}
 */
function parseMethodCredits(methodDef) {
	if (!methodDef || typeof methodDef !== 'object') return null;
	const credits = /** @type {{ credits?: unknown }} */ (methodDef).credits;
	if (typeof credits === 'number' && Number.isFinite(credits)) return credits;
	if (credits != null && credits !== '') {
		const parsed = parseFloat(String(credits));
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatCreditAmount(value) {
	if (!Number.isFinite(value)) return '';
	const rounded = Math.round(value * 10) / 10;
	return rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded);
}

const STYLE_FAILURE_LABELS = {
	style_not_found: 'Style not found',
};

/** Format $style validation failure for alert dialogs (composer blocks submit). */
function formatStylesFailureForDialog(data) {
	const failed = Array.isArray(data?.failed_styles) ? data.failed_styles : [];
	if (failed.length === 0) {
		return data?.message || data?.error || 'Invalid style references';
	}
	const lines = failed.map((f) => {
		const token = typeof f?.token === 'string' ? f.token : '';
		const r = STYLE_FAILURE_LABELS[f?.reason] || f?.reason || 'Unknown';
		return token ? `• ${token} — ${r}` : `• ${r}`;
	}).filter(Boolean);
	return `Some $styles couldn't be found:\n\n${lines.join('\n')}\n\nPick a style from the list or remove the $token.`;
}

function getAssetQuery() {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

const COMPOSER_SERVERS_FETCH_KEY = 'create-composer:GET /api/servers';

/** Fresh /api/servers for model lists (avoid reusing a failed chat-page dedupe cache). */
async function fetchServersForComposer() {
	const qs = getAssetQuery();
	const { fetchJsonWithStatusDeduped } = await import(`/shared/api.js${qs}`);
	return fetchJsonWithStatusDeduped(
		'/api/servers',
		{ credentials: 'include' },
		{ windowMs: 0, dedupeKey: COMPOSER_SERVERS_FETCH_KEY }
	);
}

/**
 * @param {unknown[]} servers
 * @returns {VideoModelOption[]}
 */
function collectVideoModelOptionsFromServers(servers) {
	const ltxFallback = {
		selectValue: encodeVideoRouteKey(
			PARASCENE_BLUE_SERVER_ID,
			MUTATE_VIDEO_LTX_METHOD_KEY,
			MUTATE_VIDEO_LTX_MODEL
		),
		value: MUTATE_VIDEO_LTX_MODEL,
		label: 'LTX Self-hosted',
		serverId: PARASCENE_BLUE_SERVER_ID,
		methodKey: MUTATE_VIDEO_LTX_METHOD_KEY,
		methodLabel: getComposerMethodGroupLabel(null, MUTATE_VIDEO_LTX_METHOD_KEY),
	};

	/** @type {VideoModelOption[]} */
	const options = [];
	const seen = new Set();

	const addMethodModels = (server, methodKey, fallbackModel, fallbackLabel) => {
		if (!server) return;
		const cfg = parseServerConfig(server);
		const methods =
			cfg?.methods && typeof cfg.methods === 'object'
				? /** @type {Record<string, { fields?: Record<string, { options?: unknown, choices?: unknown, enum?: unknown }> }>} */ (
						cfg.methods
					)
				: null;
		const methodDef = methods?.[methodKey];
		const field = methodDef?.fields?.model;
		const methodLabel = getComposerMethodGroupLabel(methodDef, methodKey);
		let opts = normalizeModelOptions(field?.options ?? field?.choices ?? field?.enum);
		if (opts.length === 0 && fallbackModel) {
			opts = [{ value: fallbackModel, label: fallbackLabel || fallbackModel }];
		}
		for (const opt of opts) {
			const selectValue = encodeVideoRouteKey(Number(server.id), methodKey, opt.value);
			if (seen.has(selectValue)) continue;
			seen.add(selectValue);
			/** @type {VideoModelOption} */
			const row = {
				selectValue,
				value: opt.value,
				label: opt.label,
				serverId: Number(server.id),
				methodKey,
				methodLabel,
			};
			row.label = getVideoOptionLabel(row);
			options.push(row);
		}
	};

	addMethodModels(
		servers.find((s) => Number(s?.id) === Number(PARASCENE_BLUE_SERVER_ID)),
		MUTATE_VIDEO_LTX_METHOD_KEY,
		MUTATE_VIDEO_LTX_MODEL,
		'LTX Self-hosted'
	);
	addMethodModels(
		servers.find((s) => Number(s?.id) === Number(MUTATE_DEFAULT_SERVER_ID)),
		MUTATE_VIDEO_DEFAULT_METHOD_KEY,
		MUTATE_VIDEO_DEFAULT_MODEL,
		'WAN Cloud'
	);

	if (!options.some((o) => o.serverId === MUTATE_DEFAULT_SERVER_ID)) {
		const wanKey = encodeVideoRouteKey(
			MUTATE_DEFAULT_SERVER_ID,
			MUTATE_VIDEO_DEFAULT_METHOD_KEY,
			MUTATE_VIDEO_DEFAULT_MODEL
		);
		if (!seen.has(wanKey)) {
			/** @type {VideoModelOption} */
			const wan = {
				selectValue: wanKey,
				value: MUTATE_VIDEO_DEFAULT_MODEL,
				label: 'WAN Cloud',
				serverId: MUTATE_DEFAULT_SERVER_ID,
				methodKey: MUTATE_VIDEO_DEFAULT_METHOD_KEY,
				methodLabel: getComposerMethodGroupLabel(null, MUTATE_VIDEO_DEFAULT_METHOD_KEY),
			};
			wan.label = getVideoOptionLabel(wan);
			options.push(wan);
		}
	}

	ltxFallback.label = getVideoOptionLabel(ltxFallback);
	return sortVideoModelOptions(options.length > 0 ? options : [ltxFallback]);
}

async function fetchComposerServers() {
	try {
		const result = await fetchServersForComposer();
		if (!result?.ok) return [];
		return Array.isArray(result.data?.servers) ? result.data.servers : [];
	} catch {
		return [];
	}
}

/**
 * @param {unknown[]} servers
 * @param {number} serverId
 * @param {string} methodKey
 * @returns {Record<string, unknown> | null}
 */
function resolveMethodFieldsFromServers(servers, serverId, methodKey) {
	const server = servers.find((s) => Number(s?.id) === Number(serverId));
	const cfg = parseServerConfig(server);
	const methods = cfg?.methods;
	if (!methods || typeof methods !== 'object') return null;
	const methodDef = /** @type {Record<string, { fields?: Record<string, unknown> }>} */ (methods)[methodKey];
	const fields = methodDef?.fields;
	return fields && typeof fields === 'object' ? fields : null;
}

async function fetchBasicModelOptions() {
	const fallback = [
		toImageModelOption(
			BASIC_CREATE_DEFAULT_SERVER_ID,
			BASIC_CREATE_DEFAULT_METHOD_KEY,
			BASIC_CREATE_DEFAULT_MODEL,
			BASIC_MODEL_DISPLAY
		),
	];
	try {
		const result = await fetchServersForComposer();
		if (!result?.ok) return fallback;
		const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
		const server = servers.find((s) => Number(s?.id) === BASIC_CREATE_DEFAULT_SERVER_ID);
		const opts = collectImageModelOptionsFromServer(server);
		return opts.length > 0 ? opts : fallback;
	} catch {
		return fallback;
	}
}

/**
 * LTX (Parascene Blue / image2video) first, then WAN (replicateVideo).
 * @param {VideoModelOption[]} options
 * @returns {VideoModelOption[]}
 */
function sortVideoModelOptions(options) {
	return [...options].sort((a, b) => {
		const rank = (o) => {
			if (
				o.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY &&
				o.value === MUTATE_VIDEO_LTX_MODEL
			) {
				return 0;
			}
			if (o.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY) return 1;
			if (o.methodKey === MUTATE_VIDEO_DEFAULT_METHOD_KEY) return 2;
			return 3;
		};
		const diff = rank(a) - rank(b);
		if (diff !== 0) return diff;
		return String(a.label || '').localeCompare(String(b.label || ''));
	});
}

/**
 * @returns {Promise<VideoModelOption[]>}
 */
async function fetchVideoModelOptions() {
	const ltxFallback = {
		selectValue: encodeVideoRouteKey(
			PARASCENE_BLUE_SERVER_ID,
			MUTATE_VIDEO_LTX_METHOD_KEY,
			MUTATE_VIDEO_LTX_MODEL
		),
		value: MUTATE_VIDEO_LTX_MODEL,
		label: 'LTX Self-hosted',
		serverId: PARASCENE_BLUE_SERVER_ID,
		methodKey: MUTATE_VIDEO_LTX_METHOD_KEY,
		methodLabel: getComposerMethodGroupLabel(null, MUTATE_VIDEO_LTX_METHOD_KEY),
	};
	try {
		const result = await fetchServersForComposer();
		if (!result?.ok) return [ltxFallback];
		const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
		return collectVideoModelOptionsFromServers(servers);
	} catch {
		return [ltxFallback];
	}
}

function aspectShapeDimensions(w, h, max = 32) {
	if (w >= h) {
		return { width: max, height: Math.max(4, Math.round((max * h) / w)) };
	}
	return { width: Math.max(4, Math.round((max * w) / h)), height: max };
}

function extractMentions(prompt) {
	const text = typeof prompt === 'string' ? prompt : '';
	if (!text) return [];
	const out = [];
	const seen = new Set();
	const re = /@([a-zA-Z0-9_]+)/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		const full = `@${match[1]}`;
		if (seen.has(full)) continue;
		seen.add(full);
		out.push(full);
	}
	return out;
}

async function validateMentionsSimple(args) {
	const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
	const mentions = extractMentions(prompt);
	if (mentions.length === 0) return { ok: true, mentions };
	const res = await fetch('/api/create/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ args: args || {} }),
	});
	const data = await res.json().catch(() => ({}));
	if (res.ok) return { ok: true, mentions, data };
	return { ok: false, mentions, data, status: res.status };
}

/** @param {DataTransfer | null | undefined} cd */
function clipboardImageFiles(cd) {
	if (!cd) return [];
	const imageFiles = [];
	for (const it of cd.items || []) {
		if (it.kind !== 'file') continue;
		const f = it.getAsFile();
		if (f && (!f.type || f.type.startsWith('image/'))) imageFiles.push(f);
	}
	if (imageFiles.length === 0 && cd.files?.length) {
		for (const f of cd.files) {
			if (f instanceof File && (!f.type || f.type.startsWith('image/'))) imageFiles.push(f);
		}
	}
	return imageFiles;
}

/**
 * @param {Record<string, unknown>} baseArgs
 * @param {string | undefined} aspectRatio
 * @param {{ serverId: number, methodKey: string, modelValue: string }} formContext
 */
function buildSubmitArgs(baseArgs, aspectRatio, formContext) {
	const args = { ...baseArgs };
	if (aspectRatio && shouldUseAspectRatioSelector(formContext)) {
		args.aspect_ratio = aspectRatio;
	}
	return args;
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   refreshAutoGrowTextareas?: (root?: Document|HTMLElement) => void,
 *   navigate?: 'none' | 'creations' | 'full',
 *   attachPromptSuggest?: (textarea: HTMLTextAreaElement) => void,
 *   isTriggeredSuggestPopupOpen?: (field: EventTarget | null) => boolean,
 * }} [opts]
 * @returns {{ destroy: () => void, refreshModelOptions: () => Promise<void> }}
 */
export function mountCreateComposer(host, opts = {}) {
	if (!(host instanceof HTMLElement)) {
		return { destroy() {}, async refreshModelOptions() {} };
	}

	const navigate = opts.navigate === 'none' || opts.navigate === 'creations' ? opts.navigate : 'full';
	const refreshAutoGrow = opts.refreshAutoGrowTextareas || (() => {});
	const checkSuggestPopupOpen =
		typeof opts.isTriggeredSuggestPopupOpen === 'function'
			? opts.isTriggeredSuggestPopupOpen
			: isTriggeredSuggestPopupOpen;

	const storedModelValue = readStoredModelValue();
	const storedModelLabel = readStoredModelLabel();
	const initialModelValue = storedModelValue || BASIC_CREATE_DEFAULT_MODEL;
	const initialModelLabel =
		storedModelLabel || (storedModelValue ? storedModelValue : BASIC_MODEL_DISPLAY);

	host.innerHTML = `
		<div class="create-composer" data-composer-flow="t2i">
			<div class="create-composer-card">
				<div class="create-composer-input-shell">
					<div class="create-composer-attachments" data-create-attachments>
						<div class="create-composer-attachments-row">
							<div class="create-composer-attachments-list" data-create-attachments-list>
								<button type="button" class="create-composer-attach-add" data-create-add
									aria-label="Add image">
									<svg class="create-composer-attach-add-icon" xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
										stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
								</button>
							</div>
							<div class="create-composer-head">
								<div class="create-composer-mode" role="tablist" aria-label="Output type">
									<button type="button" class="create-composer-mode-btn is-active"
										data-create-mode="image" role="tab" aria-selected="true">Image</button>
									<button type="button" class="create-composer-mode-btn" data-create-mode="video"
										role="tab" aria-selected="false">Video</button>
								</div>
							</div>
						</div>
					</div>
					<div class="create-composer-input-row">
						<textarea class="create-composer-input prompt-editor"
							placeholder="Describe what you want to create…"
							rows="1" data-autogrow="true" data-create-composer-prompt
							aria-label="Prompt"></textarea>
						<button type="button" class="prompt-field-clear-icon" data-prompt-clear
							data-create-composer-prompt-clear hidden aria-label="Clear prompt">
							<svg class="prompt-field-clear-icon-svg" viewBox="0 0 24 24" fill="none"
								stroke="currentColor" stroke-width="2" stroke-linecap="round"
								stroke-linejoin="round" aria-hidden="true">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</div>
					<div class="create-composer-toolbar" role="toolbar" aria-label="Create options">
						<div class="create-composer-toolbar-primary">
							<div class="create-composer-model-wrap">
								<span class="create-composer-model-label" data-create-model-label
									aria-hidden="true">${initialModelLabel}</span>
								<select class="create-composer-model-select" data-create-model-select
									aria-label="Model"></select>
							</div>
							<span class="create-composer-toolbar-divider" aria-hidden="true"></span>
							<a href="/create" class="create-composer-toolbar-chip create-composer-advanced"
								data-create-composer-advanced>
								<svg class="create-composer-toolbar-chip-icon" xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.964 0z"/>
									<path d="M20 3v4M22 5h-4M4 17v4M2 19h4"/>
								</svg>
								<span>Advanced</span>
							</a>
							<span class="create-composer-toolbar-divider" aria-hidden="true"></span>
							<div class="create-composer-aspect-wrap" data-create-aspect-wrap>
								<button type="button" class="create-composer-toolbar-chip create-composer-aspect-btn"
									data-create-aspect-btn aria-haspopup="dialog" aria-expanded="false"
									aria-label="Aspect ratio: 1:1">
									<svg class="create-composer-toolbar-chip-icon create-composer-aspect-icon-svg"
										xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
										stroke="currentColor" stroke-width="2" aria-hidden="true">
										<rect x="5" y="5" width="14" height="14" rx="2"/>
									</svg>
									<span data-create-aspect-label>1:1</span>
								</button>
							</div>
						</div>
						<div class="create-composer-toolbar-trail">
							<p class="create-composer-cost" data-create-composer-cost aria-live="polite"></p>
							<span class="create-composer-toolbar-divider create-composer-toolbar-divider--send"
								aria-hidden="true"></span>
							<button type="button" class="create-composer-send-btn" disabled
								data-create-composer-submit aria-label="Create">
								${sendIcon('create-composer-send-icon')}
								<span class="create-composer-send-spinner" aria-hidden="true"></span>
							</button>
						</div>
					</div>
					<div class="create-composer-aspect-popover" data-create-aspect-popover hidden
						role="dialog" aria-label="Aspect ratio">
						<div class="create-composer-aspect-popover-header">
							<span class="create-composer-aspect-popover-title">Aspect ratio</span>
							<button type="button" class="create-composer-aspect-popover-close"
								data-create-aspect-popover-close aria-label="Close">×</button>
						</div>
						<div class="create-composer-aspect-popover-body" data-create-aspect-popover-body></div>
					</div>
				</div>
			</div>
		</div>
	`;

	const attachmentsEl = host.querySelector('[data-create-attachments]');
	const attachmentsList = host.querySelector('[data-create-attachments-list]');
	const addBtn = host.querySelector('[data-create-add]');
	const promptInput = host.querySelector('[data-create-composer-prompt]');
	const submitBtn = host.querySelector('[data-create-composer-submit]');
	const advancedLink = host.querySelector('[data-create-composer-advanced]');
	const modelLabel = host.querySelector('[data-create-model-label]');
	const modelSelect = host.querySelector('[data-create-model-select]');
	const aspectWrap = host.querySelector('[data-create-aspect-wrap]');
	const aspectBtn = host.querySelector('[data-create-aspect-btn]');
	const aspectPopover = host.querySelector('[data-create-aspect-popover]');
	const aspectPopoverBody = host.querySelector('[data-create-aspect-popover-body]');
	const aspectPopoverClose = host.querySelector('[data-create-aspect-popover-close]');
	const aspectLabel = host.querySelector('[data-create-aspect-label]');
	const modeBtns = host.querySelectorAll('[data-create-mode]');
	const composerRoot = host.querySelector('.create-composer');
	const composerDropSurface =
		host.querySelector('.create-composer-input-shell') || composerRoot;
	const costEl = host.querySelector('[data-create-composer-cost]');

	/** @type {(string|File)[]} */
	let attachmentItems = [];
	/** Parallel to attachmentItems: source creation id when attached via mutate/drop. */
	/** @type {(number|null)[]} */
	let attachmentMutateSourceIds = [];
	/** Parallel to attachmentItems: aspect used for early `edited` upload (null when unknown). */
	/** @type {(string|null)[]} */
	let attachmentUploadAspects = [];
	/** @type {Map<number, string>} */
	const attachmentBlobUrls = new Map();
	let attachmentUploadingCount = 0;
	let selectedAspect = '1:1';
	/** @type {'image' | 'video'} */
	let outputMode = readStoredOutputMode();
	/** @type {ImageModelOption[]} */
	let imageModelOptions = [
		toImageModelOption(
			BASIC_CREATE_DEFAULT_SERVER_ID,
			BASIC_CREATE_DEFAULT_METHOD_KEY,
			initialModelValue || BASIC_CREATE_DEFAULT_MODEL,
			initialModelLabel || BASIC_MODEL_DISPLAY
		),
	];
	/** @type {VideoModelOption[]} */
	let videoModelOptions = [];
	/** @type {{ value: string, label: string }[]} */
	let modelOptions = imageModelOptions.map((o) => ({ value: o.selectValue, label: o.label }));
	let selectedModel = initialModelValue;
	const mutateOptions = {
		serverId: MUTATE_DEFAULT_SERVER_ID,
		methodKey: MUTATE_DEFAULT_METHOD_KEY,
	};
	/** @type {unknown[]} */
	let composerServers = [];
	/** @type {Map<string, number>} */
	const methodCreditByKey = new Map();
	let methodCreditsFetchStarted = false;
	/** @type {number | null} */
	let creditsBalance = null;
	let promptSaveTimer;
	let aspectPopoverIgnoreDocClose = false;
	let submitInFlight = false;
	const teardownFns = [];

	function isVideoMode() {
		return outputMode === 'video';
	}

	function normalizeAttachmentUrlForQueueMatch(raw) {
		if (typeof raw !== 'string') return '';
		const value = raw.trim();
		if (!value) return '';
		try {
			const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
			const parsed = new URL(value, origin);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
			return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			return '';
		}
	}

	function getMutateLineageForSubmit() {
		const ids = attachmentMutateSourceIds.filter((id) => Number.isFinite(id) && id > 0);
		const unique = [...new Set(ids)];
		if (unique.length === 0) return {};
		return {
			mutateOfId: unique.length === 1 ? unique[0] : undefined,
			mutateParentIds: unique,
		};
	}

	function hydrateAttachmentMutateSourcesFromQueue() {
		try {
			const queueItems = loadMutateQueue();
			if (!Array.isArray(queueItems) || queueItems.length === 0) return;
			const byUrl = new Map();
			for (const item of queueItems) {
				const url = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
				const sid = Number(item?.sourceId);
				if (!url || !Number.isFinite(sid) || sid <= 0) continue;
				const norm = normalizeAttachmentUrlForQueueMatch(url);
				if (norm && !byUrl.has(norm)) byUrl.set(norm, sid);
				if (url && !byUrl.has(url)) byUrl.set(url, sid);
			}
			if (byUrl.size === 0) return;
			if (attachmentUploadAspects.length < attachmentItems.length) {
				attachmentUploadAspects = attachmentItems.map(
					(_, i) => attachmentUploadAspects[i] ?? null
				);
			}
			attachmentMutateSourceIds = attachmentItems.map((item) => {
				if (typeof item !== 'string') return null;
				const trimmed = item.trim();
				if (!trimmed) return null;
				return (
					byUrl.get(trimmed) ??
					byUrl.get(normalizeAttachmentUrlForQueueMatch(trimmed)) ??
					null
				);
			});
		} catch {
			// ignore storage errors
		}
	}

	function setMutateAttachmentFromCreation(url, creationId, published) {
		const trimmed = typeof url === 'string' ? url.trim() : '';
		const cid = Number(creationId);
		if (!trimmed || !Number.isFinite(cid) || cid <= 0) return;
		try {
			addToMutateQueue({
				sourceId: cid,
				imageUrl: trimmed,
				published: published === true,
			});
		} catch {
			// ignore storage errors
		}
	}

	function applyQueueSnapshotToAttachments(options = {}) {
		const snapshots = buildAttachmentSnapshotFromQueue();
		if (snapshots.length === 0 && !options.allowEmpty) return;
		revokeAttachmentBlobUrls();
		attachmentItems = snapshots.map((item) => item.imageUrl);
		attachmentMutateSourceIds = snapshots.map((item) =>
			Number.isFinite(item.sourceId) && item.sourceId > 0 ? item.sourceId : null
		);
		attachmentUploadAspects = snapshots.map(() => null);
		saveAttachmentsToStorage();
		renderAttachmentStrip();
		syncModeChrome();
	}

	function isUrlInMutateQueue(url) {
		const trimmed = typeof url === 'string' ? url.trim() : '';
		if (!trimmed) return false;
		return loadMutateQueue().some((item) => {
			const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
			return itemUrl && mutateQueueImageUrlsMatch(trimmed, itemUrl);
		});
	}

	function getFormFieldContext() {
		if (isVideoMode()) {
			const route = getSelectedVideoRoute();
			return {
				serverId: route?.serverId ?? BASIC_CREATE_DEFAULT_SERVER_ID,
				methodKey: route?.methodKey ?? BASIC_CREATE_DEFAULT_METHOD_KEY,
				modelValue: route?.value ?? '',
				fields: route
					? resolveMethodFieldsFromServers(composerServers, route.serverId, route.methodKey)
					: null,
			};
		}
		const route = getSelectedImageRoute();
		const serverId = route?.serverId ?? BASIC_CREATE_DEFAULT_SERVER_ID;
		const methodKey = route?.methodKey ?? BASIC_CREATE_DEFAULT_METHOD_KEY;
		return {
			serverId,
			methodKey,
			modelValue: route?.value ?? selectedModel,
			fields: resolveMethodFieldsFromServers(composerServers, serverId, methodKey),
		};
	}

	function isLtxVideoRoute(route) {
		return (
			route &&
			route.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY &&
			Number(route.serverId) === Number(PARASCENE_BLUE_SERVER_ID)
		);
	}

	function shouldShowAspectSelector() {
		if (isVideoMode()) {
			return isLtxVideoRoute(getSelectedVideoRoute());
		}
		return shouldUseAspectRatioSelector(getFormFieldContext());
	}

	/** User can pick output ratio (image models or LTX video). */
	function canSelectAspectRatio() {
		return shouldShowAspectSelector();
	}

	async function readPrimaryAttachmentDimensions() {
		const first = attachmentItems[0];
		if (!first) return null;
		if (first instanceof File) {
			return readRasterFileDimensions(first);
		}
		if (typeof first === 'string' && first.trim()) {
			return readImageUrlDimensions(first.trim());
		}
		return null;
	}

	async function confirmAspectMismatchBeforeSubmit() {
		// Aspect ratio is applied when the job is submitted (server letterbox), not at attach time.
		return true;
	}

	function getActiveModelList() {
		if (isVideoMode()) {
			return videoModelOptions.map((o) => ({ value: o.selectValue, label: o.label }));
		}
		return imageModelOptions.map((o) => ({ value: o.selectValue, label: o.label }));
	}

	function getActiveRouteOptions() {
		return isVideoMode() ? videoModelOptions : imageModelOptions;
	}

	function saveModelSelection(value) {
		try {
			if (isVideoMode()) {
				localStorage.setItem(STORAGE_KEYS.videoModel, value);
			} else {
				localStorage.setItem(STORAGE_KEYS.model, value);
				const match =
					imageModelOptions.find((o) => o.selectValue === value) ||
					imageModelOptions.find((o) => o.value === value);
				const label = match?.label || match?.value || value;
				if (label) localStorage.setItem(STORAGE_KEYS.modelLabel, label);
			}
		} catch (_) {}
	}

	function getDefaultVideoSelectValue() {
		const ltx =
			videoModelOptions.find(
				(o) =>
					o.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY && o.value === MUTATE_VIDEO_LTX_MODEL
			) ||
			videoModelOptions.find((o) => o.methodKey === MUTATE_VIDEO_LTX_METHOD_KEY) ||
			videoModelOptions[0];
		return ltx?.selectValue || '';
	}

	function getSelectedVideoRoute() {
		const match = videoModelOptions.find((o) => o.selectValue === selectedModel);
		if (match) return match;
		const fallbackKey = getDefaultVideoSelectValue();
		return videoModelOptions.find((o) => o.selectValue === fallbackKey) || videoModelOptions[0];
	}

	function getDefaultImageSelectValue() {
		const preferred = imageModelOptions.find(
			(o) =>
				o.serverId === BASIC_CREATE_DEFAULT_SERVER_ID &&
				o.methodKey === BASIC_CREATE_DEFAULT_METHOD_KEY &&
				o.value === BASIC_CREATE_DEFAULT_MODEL
		);
		return preferred?.selectValue || imageModelOptions[0]?.selectValue || '';
	}

	function getSelectedImageRoute() {
		const bySelect = imageModelOptions.find((o) => o.selectValue === selectedModel);
		if (bySelect) return bySelect;
		const parsed = parseComposerRouteKey(selectedModel);
		if (parsed) {
			const byRoute = imageModelOptions.find(
				(o) =>
					o.serverId === parsed.serverId &&
					o.methodKey === parsed.methodKey &&
					o.value === parsed.model
			);
			if (byRoute) return byRoute;
		}
		const byModel = imageModelOptions.find((o) => o.value === selectedModel);
		if (byModel) return byModel;
		const fallbackKey = getDefaultImageSelectValue();
		return imageModelOptions.find((o) => o.selectValue === fallbackKey) || imageModelOptions[0];
	}

	function syncModelLabel() {
		const list = getActiveModelList();
		const match = list.find((o) => o.value === selectedModel);
		let text = match?.label || '';
		if (isVideoMode()) {
			text = getVideoOptionLabel(getSelectedVideoRoute()) || text || 'LTX Self-hosted';
		} else {
			text = getSelectedImageRoute()?.label || text || selectedModel || BASIC_MODEL_DISPLAY;
		}
		if (modelLabel) modelLabel.textContent = text;
		if (modelSelect instanceof HTMLSelectElement) {
			modelSelect.setAttribute('aria-label', `Model: ${text}`);
		}
		try {
			if (match?.label) localStorage.setItem(STORAGE_KEYS.modelLabel, match.label);
		} catch (_) {}
	}

	function populateModelSelect() {
		if (!(modelSelect instanceof HTMLSelectElement)) return;
		const prev = selectedModel;
		const list = getActiveModelList();
		modelSelect.innerHTML = '';
		const routeOptions = isVideoMode() ? videoModelOptions : imageModelOptions;
		appendGroupedRouteOptionsToSelect(modelSelect, routeOptions, (opt) =>
			isVideoMode() ? getVideoOptionLabel(opt) || opt.label || opt.value : opt.label || opt.value
		);
		let next;
		if (isVideoMode()) {
			try {
				const composerSaved = localStorage.getItem(STORAGE_KEYS.videoModel);
				const sharedSaved = localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.videoModel);
				next = resolveComposerRouteFromStorage(videoModelOptions, [composerSaved, sharedSaved]);
				if (!next && list.some((o) => o.value === prev)) {
					next = prev;
				}
				if (!next) {
					next = getDefaultVideoSelectValue();
				}
			} catch {
				next = getDefaultVideoSelectValue();
			}
		} else {
			try {
				const composerSaved = localStorage.getItem(STORAGE_KEYS.model);
				const sharedSaved = localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.model);
				next = resolveComposerRouteFromStorage(imageModelOptions, [composerSaved, sharedSaved]);
			} catch (_) {}
			if (!next) {
				const parsed = parseComposerRouteKey(prev);
				if (parsed) {
					const legacy = imageModelOptions.find(
						(o) =>
							o.serverId === parsed.serverId &&
							o.methodKey === parsed.methodKey &&
							o.value === parsed.model
					);
					next = legacy?.selectValue;
				}
			}
			if (!next && list.some((o) => o.value === prev)) next = prev;
			if (!next) next = getDefaultImageSelectValue() || list[0]?.value || '';
		}
		modelSelect.value = next;
		selectedModel = next;
		syncModelLabel();
	}

	function applySelectedModel(value) {
		const list = getActiveModelList();
		if (!value || !list.some((o) => o.value === value)) return;
		selectedModel = value;
		if (modelSelect instanceof HTMLSelectElement) modelSelect.value = value;
		syncModelLabel();
		saveModelSelection(value);
		syncModeChrome();
		buildAspectPopover();
	}

	async function refreshModelOptions() {
		const [imageOpts, videoOpts, servers] = await Promise.all([
			fetchBasicModelOptions(),
			fetchVideoModelOptions(),
			fetchComposerServers(),
		]);
		composerServers = servers;
		imageModelOptions =
			Array.isArray(imageOpts) && imageOpts.length > 0
				? imageOpts
				: [
						toImageModelOption(
							BASIC_CREATE_DEFAULT_SERVER_ID,
							BASIC_CREATE_DEFAULT_METHOD_KEY,
							BASIC_CREATE_DEFAULT_MODEL,
							BASIC_MODEL_DISPLAY
						),
					];
		videoModelOptions = sortVideoModelOptions(
			Array.isArray(videoOpts) && videoOpts.length > 0 ? videoOpts : [buildBootstrapVideoOption()]
		);
		if (!isVideoMode()) {
			const stillValid =
				imageModelOptions.some((o) => o.selectValue === selectedModel) ||
				imageModelOptions.some((o) => o.value === selectedModel) ||
				parseComposerRouteKey(selectedModel) != null;
			if (!stillValid) {
				const fallback =
					imageModelOptions.find(
						(o) =>
							o.serverId === BASIC_CREATE_DEFAULT_SERVER_ID &&
							o.methodKey === BASIC_CREATE_DEFAULT_METHOD_KEY &&
							o.value === BASIC_CREATE_DEFAULT_MODEL
					) || imageModelOptions[0];
				if (fallback) selectedModel = fallback.selectValue;
			}
		}
		modelOptions = getActiveModelList();
		populateModelSelect();
		syncModeChrome();
		buildAspectPopover();
		void ensureMethodCreditsCache();
	}

	function revokeAttachmentBlobUrls() {
		attachmentBlobUrls.forEach((url) => {
			if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
		});
		attachmentBlobUrls.clear();
	}

	function hasAttachment() {
		return attachmentItems.length > 0 || attachmentUploadingCount > 0;
	}

	/** @returns {'t2i' | 'i2i' | 'i2v' | 't2v'} */
	function getComposerFlow() {
		if (isVideoMode()) {
			return hasAttachment() ? 'i2v' : 't2v';
		}
		return hasAttachment() ? 'i2i' : 't2i';
	}

	function syncComposerAccentFlow() {
		if (!(composerRoot instanceof HTMLElement)) return;
		composerRoot.setAttribute('data-composer-flow', getComposerFlow());
	}

	/**
	 * @returns {{ serverId: number, methodKey: string } | null}
	 */
	function getComposerSubmitRoute() {
		if (isVideoMode()) {
			const route = getSelectedVideoRoute();
			if (!route) return null;
			return { serverId: route.serverId, methodKey: route.methodKey };
		}
		if (hasAttachment()) {
			if (!mutateOptions.serverId || !mutateOptions.methodKey) return null;
			return { serverId: mutateOptions.serverId, methodKey: mutateOptions.methodKey };
		}
		const route = getSelectedImageRoute();
		if (!route) return null;
		return { serverId: route.serverId, methodKey: route.methodKey };
	}

	function methodCreditCacheKey(serverId, methodKey) {
		return `${serverId}:${methodKey}`;
	}

	function hydrateMethodCreditsFromStorage() {
		try {
			const raw = localStorage.getItem(STORAGE_KEYS.methodCredits);
			if (!raw || !String(raw).trim()) return;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return;
			for (const [key, value] of Object.entries(parsed)) {
				const n = typeof value === 'number' ? value : parseFloat(String(value));
				if (Number.isFinite(n) && n >= 0) methodCreditByKey.set(key, n);
			}
		} catch (_) {}
	}

	function persistMethodCreditsToStorage() {
		/** @type {Record<string, number>} */
		const obj = {};
		for (const [key, value] of methodCreditByKey) {
			if (Number.isFinite(value)) obj[key] = value;
		}
		try {
			localStorage.setItem(STORAGE_KEYS.methodCredits, JSON.stringify(obj));
		} catch (_) {}
	}

	/** @returns {VideoModelOption} */
	function buildBootstrapVideoOption() {
		const ltxKey = encodeVideoRouteKey(
			PARASCENE_BLUE_SERVER_ID,
			MUTATE_VIDEO_LTX_METHOD_KEY,
			MUTATE_VIDEO_LTX_MODEL
		);
		/** @type {VideoModelOption} */
		let option = {
			selectValue: ltxKey,
			value: MUTATE_VIDEO_LTX_MODEL,
			label: 'LTX Self-hosted',
			serverId: PARASCENE_BLUE_SERVER_ID,
			methodKey: MUTATE_VIDEO_LTX_METHOD_KEY,
			methodLabel: getComposerMethodGroupLabel(null, MUTATE_VIDEO_LTX_METHOD_KEY),
		};
		try {
			const saved = localStorage.getItem(STORAGE_KEYS.videoModel);
			const parsed = saved ? parseVideoRouteKey(saved) : null;
			if (parsed) {
				option = {
					selectValue: saved,
					value: parsed.model,
					label: '',
					serverId: parsed.serverId,
					methodKey: parsed.methodKey,
					methodLabel: getComposerMethodGroupLabel(null, parsed.methodKey),
				};
				option.label = getVideoOptionLabel(option);
			}
		} catch (_) {}
		return option;
	}

	function bootstrapVideoModelOptions() {
		const option = buildBootstrapVideoOption();
		videoModelOptions = [option];
		if (isVideoMode()) {
			selectedModel = option.selectValue;
			modelOptions = getActiveModelList();
		}
	}

	function getComposerCreditCost() {
		const route = getComposerSubmitRoute();
		if (!route) return undefined;
		const cached = methodCreditByKey.get(methodCreditCacheKey(route.serverId, route.methodKey));
		return Number.isFinite(cached) ? cached : undefined;
	}

	function isComposerCreditCostReady() {
		return Number.isFinite(getComposerCreditCost());
	}

	function updateComposerCostDisplay() {
		if (!(costEl instanceof HTMLElement)) return;
		const cost = getComposerCreditCost();
		costEl.classList.remove('insufficient');
		if (!Number.isFinite(cost)) {
			costEl.textContent = '';
			updateSubmitButtonState();
			return;
		}
		const label = formatCreditAmount(cost);
		costEl.textContent = `${label} credit${cost === 1 ? '' : 's'}`;
		if (creditsBalance != null && creditsBalance < cost) {
			costEl.classList.add('insufficient');
		}
		updateSubmitButtonState();
	}

	async function ensureMethodCreditsCache() {
		if (methodCreditsFetchStarted) return;
		methodCreditsFetchStarted = true;
		try {
			const qs = getAssetQuery();
			const { loadMutateServerOptions } = await import(`/shared/mutateOptions.js${qs}`);
			const servers = await loadMutateServerOptions();
			for (const server of servers) {
				const cfg = parseServerConfig(server);
				const methods =
					cfg?.methods && typeof cfg.methods === 'object'
						? /** @type {Record<string, unknown>} */ (cfg.methods)
						: null;
				if (!methods) continue;
				const serverId = Number(server.id);
				for (const [methodKey, methodDef] of Object.entries(methods)) {
					const credits = parseMethodCredits(methodDef);
					if (!Number.isFinite(credits)) continue;
					methodCreditByKey.set(methodCreditCacheKey(serverId, methodKey), credits);
				}
			}
			persistMethodCreditsToStorage();
		} catch (_) {
			// keep hydrated storage values
		}
		updateComposerCostDisplay();
	}

	function loadComposerCreditsBalance() {
		const CACHE_KEY = 'create-credits-cache';
		try {
			const cached = localStorage.getItem(CACHE_KEY);
			if (cached) {
				const parsed = JSON.parse(cached);
				const balance = parsed?.balance;
				if (typeof balance === 'number' && Number.isFinite(balance)) {
					creditsBalance = Math.max(0, Math.round(balance * 10) / 10);
					updateComposerCostDisplay();
				}
			}
		} catch (_) {}

		const qs = getAssetQuery();
		import(`/shared/api.js${qs}`)
			.then(({ fetchJsonWithStatusDeduped }) =>
				fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 })
			)
			.then((result) => {
				if (result?.ok && typeof result.data?.balance === 'number') {
					creditsBalance = Math.max(0, Math.round(result.data.balance * 10) / 10);
					try {
						localStorage.setItem(
							CACHE_KEY,
							JSON.stringify({ balance: creditsBalance, ts: Date.now() })
						);
					} catch (_) {}
				} else {
					creditsBalance = creditsBalance ?? 0;
				}
				updateComposerCostDisplay();
			})
			.catch(() => {
				try {
					const stored = localStorage.getItem('credits-balance');
					if (stored !== null) {
						const n = parseFloat(stored);
						if (Number.isFinite(n)) creditsBalance = Math.max(0, Math.round(n * 10) / 10);
					}
				} catch (_) {}
				updateComposerCostDisplay();
			});
	}

	const onCreditsUpdated = (event) => {
		const count = event?.detail?.count;
		if (typeof count === 'number' && Number.isFinite(count)) {
			creditsBalance = Math.max(0, Math.round(count * 10) / 10);
			updateComposerCostDisplay();
		} else {
			loadComposerCreditsBalance();
		}
	};
	document.addEventListener('credits-updated', onCreditsUpdated);
	teardownFns.push(() => document.removeEventListener('credits-updated', onCreditsUpdated));

	function isAttachmentUploading() {
		return attachmentUploadingCount > 0 || attachmentItems.some((item) => item instanceof File);
	}

	function getAspectRatioForSubmit() {
		return shouldShowAspectSelector() ? selectedAspect : undefined;
	}

	function syncAspectFooterState() {
		const selectable = canSelectAspectRatio();
		const displayRatio = selectable ? selectedAspect : '1:1';
		updateAspectBtnLabel(displayRatio);
		if (aspectBtn instanceof HTMLButtonElement) {
			aspectBtn.classList.toggle('is-readonly', !selectable);
			aspectBtn.setAttribute('aria-haspopup', 'dialog');
			aspectBtn.setAttribute(
				'aria-label',
				selectable
					? `Aspect ratio: ${displayRatio}`
					: isVideoMode()
						? 'Aspect ratio not configurable for this video model'
						: 'Aspect ratio: 1:1 (square only for this model)'
			);
		}
	}

	function getPromptPlaceholder() {
		if (isVideoMode()) {
			return hasAttachment()
				? 'Describe the motion or camera movement…'
				: 'Add an image, then describe the motion…';
		}
		return hasAttachment()
			? 'Describe what you want to change…'
			: 'Describe what you want to create…';
	}

	function syncModeToggleUi() {
		modeBtns.forEach((btn) => {
			if (!(btn instanceof HTMLButtonElement)) return;
			const mode = btn.getAttribute('data-create-mode');
			const on = mode === outputMode;
			btn.classList.toggle('is-active', on);
			btn.setAttribute('aria-selected', on ? 'true' : 'false');
		});
		if (promptInput instanceof HTMLTextAreaElement) {
			promptInput.placeholder = getPromptPlaceholder();
		}
	}

	function setOutputMode(mode) {
		if (mode !== 'image' && mode !== 'video') return;
		if (outputMode === mode) return;
		outputMode = mode;
		try {
			localStorage.setItem(STORAGE_KEYS.outputMode, mode);
		} catch (_) {}
		setAspectPopoverOpen(false);
		modelOptions = getActiveModelList();
		populateModelSelect();
		syncModeToggleUi();
		syncModeChrome();
		buildAspectPopover();
	}

	function syncModeChrome() {
		const attached = hasAttachment();
		syncModeToggleUi();
		if (submitBtn) {
			if (isVideoMode()) {
				submitBtn.setAttribute('aria-label', 'Animate');
			} else {
				submitBtn.setAttribute('aria-label', attached ? 'Edit image' : 'Create');
			}
		}
		syncAspectFooterState();
		updateSubmitButtonState();
		syncComposerAccentFlow();
		updateComposerCostDisplay();
	}

	function savePrompt() {
		const value = promptInput?.value || '';
		try {
			localStorage.setItem(STORAGE_KEYS.prompt, value);
			localStorage.setItem(STORAGE_KEYS.promptText, value);
			localStorage.setItem(STORAGE_KEYS.promptImageEdit, value);
		} catch (_) {}
	}

	function saveStyleSelected(value) {
		try {
			localStorage.setItem(STORAGE_KEYS.styleSelected, String(value ?? ''));
		} catch (_) {}
	}

	function saveAspectRatio(value) {
		try {
			localStorage.setItem(STORAGE_KEYS.aspectRatio, String(value ?? ''));
		} catch (_) {}
	}

	function syncFromSharedSettings() {
		try {
			const settings = readSharedCreateSettings();
			const prompt = resolveSharedPrompt(settings);
			if (promptInput instanceof HTMLTextAreaElement && promptInput.value !== prompt) {
				promptInput.value = prompt;
				syncStyleSelectionFromPrompt();
				updateSubmitButtonState();
				try {
					refreshAutoGrow(host);
				} catch (_) {}
			}
			const savedAspect = settings.aspectRatio?.trim();
			if (savedAspect && MVP_ASPECT_RATIOS.includes(savedAspect) && savedAspect !== selectedAspect) {
				selectedAspect = savedAspect;
				syncAspectFooterState();
				buildAspectPopover();
			}
			const storedMode = settings.outputMode;
			if ((storedMode === 'video' || storedMode === 'image') && storedMode !== outputMode) {
				setOutputMode(storedMode);
			}
			const modelRoute = settings.modelRoute?.trim();
			if (modelRoute) {
				const routeOptions = getActiveRouteOptions();
				if (
					routeOptions.some((option) => option.selectValue === modelRoute) &&
					modelRoute !== selectedModel
				) {
					applySelectedModel(modelRoute);
				}
			}
		} catch (_) {}
	}

	function saveAttachmentsToStorage() {
		const urls = [];
		const sourceIds = [];
		for (let i = 0; i < attachmentItems.length; i++) {
			const item = attachmentItems[i];
			if (typeof item !== 'string' || !item.trim()) continue;
			urls.push(item.trim());
			const sid = attachmentMutateSourceIds[i];
			sourceIds.push(Number.isFinite(sid) && sid > 0 ? sid : null);
		}
		try {
			if (urls.length > 0) {
				localStorage.setItem(STORAGE_KEYS.imageEditSelection, JSON.stringify(urls));
			} else {
				localStorage.removeItem(STORAGE_KEYS.imageEditSelection);
			}
		} catch (_) {}
		try {
			syncMutateQueueFromComposerAttachments(urls, sourceIds);
		} catch (_) {}
	}

	function getAttachmentPreviewSrc(item, index) {
		if (typeof item === 'string' && item.trim()) return item.trim();
		if (item instanceof File) {
			let blob = attachmentBlobUrls.get(index);
			if (!blob) {
				blob = URL.createObjectURL(item);
				attachmentBlobUrls.set(index, blob);
			}
			return blob;
		}
		return '';
	}

	function renderAttachmentStrip() {
		if (!attachmentsList || !attachmentsEl) return;
		const hasMedia = hasAttachment();
		attachmentsEl.classList.toggle('create-composer-attachments--has-media', hasMedia);

		attachmentsList.querySelectorAll('.create-composer-attachment').forEach((el) => el.remove());
		revokeAttachmentBlobUrls();

		const insertBefore = addBtn instanceof HTMLElement ? addBtn : null;
		attachmentItems.forEach((item, index) => {
			const wrap = document.createElement('div');
			wrap.className = 'create-composer-attachment';
			const uploading = item instanceof File;

			if (uploading) {
				const uploadingEl = document.createElement('span');
				uploadingEl.className = 'create-composer-attachment-uploading';
				uploadingEl.innerHTML =
					'<span class="create-composer-attachment-spinner" aria-hidden="true"></span>';
				wrap.appendChild(uploadingEl);
			} else {
				const src = getAttachmentPreviewSrc(item, index);
				const preview = document.createElement('img');
				preview.className =
					'create-composer-attachment-preview create-composer-attachment-preview--clickable';
				preview.alt = '';
				if (src) preview.src = src;
				preview.addEventListener('click', () => openAttachmentLightbox(src, preview));
				wrap.appendChild(preview);

				const remove = document.createElement('button');
				remove.type = 'button';
				remove.className = 'create-composer-attachment-remove';
				remove.setAttribute('aria-label', 'Remove image');
				remove.textContent = '×';
				remove.addEventListener('click', (e) => {
					e.stopPropagation();
					removeAttachmentAt(index);
				});
				wrap.appendChild(remove);
			}

			if (insertBefore) attachmentsList.insertBefore(wrap, insertBefore);
			else attachmentsList.appendChild(wrap);
		});
	}

	function clearAttachments() {
		revokeAttachmentBlobUrls();
		attachmentItems = [];
		attachmentMutateSourceIds = [];
		attachmentUploadAspects = [];
		attachmentUploadingCount = 0;
		saveAttachmentsToStorage();
		renderAttachmentStrip();
		syncModeChrome();
	}

	function removeAttachmentAt(index) {
		if (index < 0 || index >= attachmentItems.length) return;
		const removed = attachmentItems[index];
		if (typeof removed === 'string' && removed.trim() && isUrlInMutateQueue(removed.trim())) {
			try {
				removeFromMutateQueueByImageUrl(removed.trim());
			} catch {
				// ignore storage errors
			}
			return;
		}
		attachmentItems.splice(index, 1);
		attachmentMutateSourceIds.splice(index, 1);
		attachmentUploadAspects.splice(index, 1);
		saveAttachmentsToStorage();
		renderAttachmentStrip();
		syncModeChrome();
	}

	function addAttachmentUrl(url, options = {}) {
		const trimmed = typeof url === 'string' ? url.trim() : '';
		if (!trimmed) return;
		const cid = Number(options?.mutateSourceCreationId);
		attachmentItems.push(trimmed);
		attachmentMutateSourceIds.push(Number.isFinite(cid) && cid > 0 ? cid : null);
		attachmentUploadAspects.push(null);
		saveAttachmentsToStorage();
		renderAttachmentStrip();
		syncModeChrome();
	}

	function getEarlyUploadAspectRatio() {
		return shouldShowAspectSelector() ? selectedAspect : '1:1';
	}

	async function addAttachmentFromFile(file) {
		if (!(file instanceof File)) return;
		const index = attachmentItems.length;
		const uploadAspect = getEarlyUploadAspectRatio();
		attachmentItems.push(file);
		attachmentMutateSourceIds.push(null);
		attachmentUploadAspects.push(null);
		attachmentUploadingCount += 1;
		renderAttachmentStrip();
		syncModeChrome();
		try {
			const uploaded = await uploadImageFile(file);
			if (typeof uploaded === 'string' && uploaded.trim()) {
				attachmentItems[index] = uploaded.trim();
				attachmentUploadAspects[index] = null;
				saveAttachmentsToStorage();
			} else {
				attachmentItems.splice(index, 1);
				attachmentMutateSourceIds.splice(index, 1);
				attachmentUploadAspects.splice(index, 1);
			}
		} catch (err) {
			attachmentItems.splice(index, 1);
			attachmentMutateSourceIds.splice(index, 1);
			attachmentUploadAspects.splice(index, 1);
			alert(err?.message || 'Image upload failed');
		} finally {
			attachmentUploadingCount = Math.max(0, attachmentUploadingCount - 1);
			renderAttachmentStrip();
			syncModeChrome();
		}
	}

	function restoreAttachments(urls) {
		revokeAttachmentBlobUrls();
		attachmentItems = urls
			.map((v) => (typeof v === 'string' ? v.trim() : ''))
			.filter(Boolean);
		attachmentMutateSourceIds = attachmentItems.map(() => null);
		attachmentUploadAspects = attachmentItems.map(() => null);
		hydrateAttachmentMutateSourcesFromQueue();
		renderAttachmentStrip();
		syncModeChrome();
	}

	function openImagePicker() {
		const qs = getAssetQuery();
		import(`/shared/providerFormFields.js${qs}`)
			.then(({ openImagePickerModal }) => {
				openImagePickerModal({
					async onSelect(value) {
						if (value instanceof File) {
							await addAttachmentFromFile(value);
							return;
						}
						if (typeof value === 'string' && value.trim()) {
							addAttachmentUrl(value.trim());
						}
					},
				});
			})
			.catch((err) => {
				console.error('[createComposer] image picker failed to load:', err);
			});
	}

	function openAttachmentLightbox(src, previewEl) {
		if (!src) return;
		const qs = getAssetQuery();
		import(`/shared/chatInlineImageLightbox.js${qs}`).then(({ openChatInlineImageLightbox }) => {
			openChatInlineImageLightbox(src, {
				sourceImg: previewEl instanceof HTMLImageElement ? previewEl : null,
			});
		});
	}

	function extractStyleSigilKeys(text) {
		const out = [];
		const re = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g;
		let match;
		while ((match = re.exec(String(text || ''))) !== null) {
			if (match[1]) out.push(match[1].toLowerCase());
		}
		return out;
	}

	function resolveSubmitStyleKey(promptText) {
		const sigils = extractStyleSigilKeys(promptText);
		if (sigils.length > 0) return sigils[sigils.length - 1];
		return undefined;
	}

	function getSelectedStyleKey() {
		try {
			return (localStorage.getItem(STORAGE_KEYS.styleSelected) || 'none').trim();
		} catch {
			return 'none';
		}
	}

	function syncStyleSelectionFromPrompt() {
		if (!(promptInput instanceof HTMLTextAreaElement)) return;
		const sigils = extractStyleSigilKeys(promptInput.value);
		if (sigils.length === 0) {
			saveStyleSelected('none');
			return;
		}
		saveStyleSelected(sigils[sigils.length - 1]);
	}

	function setComposerSubmitting(active) {
		submitInFlight = Boolean(active);
		if (composerRoot instanceof HTMLElement) {
			composerRoot.classList.toggle('is-submitting', submitInFlight);
			if (submitInFlight) {
				composerRoot.setAttribute('aria-busy', 'true');
			} else {
				composerRoot.removeAttribute('aria-busy');
			}
		}
		if (submitBtn instanceof HTMLButtonElement) {
			submitBtn.classList.toggle('is-loading', submitInFlight);
			if (submitInFlight) {
				submitBtn.setAttribute('aria-busy', 'true');
				submitBtn.setAttribute('aria-label', 'Creating…');
			} else {
				submitBtn.removeAttribute('aria-busy');
				submitBtn.setAttribute('aria-label', isVideoMode() ? 'Animate' : hasAttachment() ? 'Edit image' : 'Create');
			}
		}
		if (promptInput instanceof HTMLTextAreaElement) {
			promptInput.readOnly = submitInFlight;
			if (submitInFlight) {
				promptInput.setAttribute('aria-busy', 'true');
			} else {
				promptInput.removeAttribute('aria-busy');
			}
		}
		if (addBtn instanceof HTMLButtonElement) {
			addBtn.disabled = submitInFlight || attachmentUploadingCount > 0;
		}
		if (modelSelect instanceof HTMLSelectElement) {
			modelSelect.disabled = submitInFlight;
		}
		modeBtns.forEach((btn) => {
			if (btn instanceof HTMLButtonElement) btn.disabled = submitInFlight;
		});
		updateSubmitButtonState();
	}

	function clearComposerState() {
		if (promptInput instanceof HTMLTextAreaElement) {
			promptInput.value = '';
		}
		try {
			localStorage.setItem(STORAGE_KEYS.prompt, '');
			localStorage.setItem(STORAGE_KEYS.promptText, '');
			localStorage.setItem(STORAGE_KEYS.promptImageEdit, '');
		} catch (_) {}
		revokeAttachmentBlobUrls();
		attachmentItems = [];
		attachmentMutateSourceIds = [];
		attachmentUploadAspects = [];
		attachmentUploadingCount = 0;
		try {
			localStorage.removeItem(STORAGE_KEYS.imageEditSelection);
			localStorage.removeItem(STORAGE_KEYS.imageEditCarryover);
		} catch (_) {}
		renderAttachmentStrip();
		syncModeChrome();
		try {
			refreshAutoGrow(host);
		} catch (_) {}
	}

	async function dispatchCreationSubmit(payload) {
		try {
			await submitCreationWithPending({
				...payload,
				navigate,
				onError: async (err) => {
					const message =
						err && typeof err === 'object' && 'message' in err
							? String(/** @type {{ message?: unknown }} */ (err).message || '')
							: '';
					if (message) alert(message);
				},
			});
			clearComposerState();
		} catch (_) {
			// onError surfaced; keep composer content for retry
		} finally {
			setComposerSubmitting(false);
		}
	}

	function updateSubmitButtonState() {
		if (!(submitBtn instanceof HTMLButtonElement)) return;
		if (submitInFlight) {
			submitBtn.disabled = true;
			return;
		}
		if (!isComposerCreditCostReady()) {
			submitBtn.disabled = true;
			return;
		}
		if (isAttachmentUploading()) {
			submitBtn.disabled = true;
			return;
		}
		if (isVideoMode()) {
			submitBtn.disabled = !hasAttachment();
			return;
		}
		const hasPrompt = (promptInput?.value || '').trim().length > 0;
		if (hasAttachment()) {
			const hasMutate = Boolean(mutateOptions.serverId && mutateOptions.methodKey);
			submitBtn.disabled = !hasPrompt || !hasMutate;
		} else {
			submitBtn.disabled = !hasPrompt;
		}
	}

	function positionAspectPopover() {
		if (!aspectPopover || !aspectBtn || aspectPopover.hidden) return;
		const rect = aspectBtn.getBoundingClientRect();
		aspectPopover.style.left = `${Math.round(rect.left)}px`;
		aspectPopover.style.top = `${Math.round(rect.top)}px`;
	}

	function setAspectPopoverOpen(open) {
		if (!aspectPopover || !aspectBtn) return;
		const on = Boolean(open);
		aspectPopover.hidden = !on;
		aspectBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
		if (on) {
			buildAspectPopover();
			positionAspectPopover();
		}
	}

	function updateAspectBtnLabel(ratio) {
		const label = ratio || selectedAspect;
		if (aspectLabel) aspectLabel.textContent = label;
		if (aspectBtn) aspectBtn.setAttribute('aria-label', `Aspect ratio: ${label}`);
		syncAspectToolbarIcon(label);
	}

	function syncAspectToolbarIcon(ratio) {
		const svg = aspectBtn?.querySelector('.create-composer-aspect-icon-svg');
		const rect = svg?.querySelector('rect');
		if (!rect) return;
		const parsed = parseAspectRatioString(ratio);
		const [w, h] = parsed || ASPECT_RATIO_PRESETS[ratio] || [1, 1];
		const max = 17;
		const minSide = 7;
		let rw = max;
		let rh = max;
		if (w >= h) {
			rh = Math.max(minSide, Math.round((max * h) / w));
		} else {
			rw = Math.max(minSide, Math.round((max * w) / h));
		}
		rect.setAttribute('x', String((24 - rw) / 2));
		rect.setAttribute('y', String((24 - rh) / 2));
		rect.setAttribute('width', String(rw));
		rect.setAttribute('height', String(rh));
	}

	function buildAspectPopover() {
		if (!aspectPopoverBody) return;
		const selectable = canSelectAspectRatio();
		const activeRatio = selectable ? selectedAspect : '1:1';
		aspectPopoverBody.innerHTML = '';
		const group = document.createElement('div');
		group.className = 'aspect-ratio-selector create-composer-aspect-grid';
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', 'Aspect ratio');

		for (const value of MVP_ASPECT_RATIOS) {
			const preset = parseAspectRatioString(value) || ASPECT_RATIO_PRESETS[value];
			if (!preset) continue;
			const [w, h] = preset;
			const dims = aspectShapeDimensions(w, h, 28);
			const shortLabel = ASPECT_RATIO_SELECTOR_LABELS[value] || value;
			const isSelected = value === activeRatio;

			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'aspect-ratio-option';
			btn.setAttribute('role', 'radio');
			btn.setAttribute('data-value', value);
			btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
			btn.disabled = !selectable;
			if (!selectable) btn.setAttribute('aria-disabled', 'true');
			if (isSelected) btn.classList.add('is-selected');

			const ratioEl = document.createElement('span');
			ratioEl.className = 'aspect-ratio-option-ratio';
			ratioEl.textContent = value;

			const shapeEl = document.createElement('span');
			shapeEl.className = 'aspect-ratio-option-shape';
			shapeEl.setAttribute('aria-hidden', 'true');
			const shapeInner = document.createElement('span');
			shapeInner.className = 'aspect-ratio-option-shape-inner';
			shapeInner.style.width = `${dims.width}px`;
			shapeInner.style.height = `${dims.height}px`;
			shapeEl.appendChild(shapeInner);

			const labelEl = document.createElement('span');
			labelEl.className = 'aspect-ratio-option-label';
			labelEl.textContent = shortLabel;

			btn.append(ratioEl, shapeEl, labelEl);
			if (selectable) {
				btn.addEventListener('click', () => {
					selectedAspect = value;
					saveAspectRatio(value);
					updateAspectBtnLabel(value);
					group.querySelectorAll('.aspect-ratio-option').forEach((el) => {
						const sel = el.getAttribute('data-value') === value;
						el.classList.toggle('is-selected', sel);
						el.setAttribute('aria-checked', sel ? 'true' : 'false');
					});
					setAspectPopoverOpen(false);
				});
			}
			group.appendChild(btn);
		}
		aspectPopoverBody.appendChild(group);
	}

	async function resolveAttachmentUrls(uploadFn) {
		const imageUrls = [];
		for (let i = 0; i < attachmentItems.length; i++) {
			const item = attachmentItems[i];
			if (typeof item === 'string' && item.trim()) {
				imageUrls.push(item.trim());
				continue;
			}
			if (item instanceof File) {
				let uploadAspect =
					(typeof attachmentUploadAspects[i] === 'string' && attachmentUploadAspects[i].trim()) ||
					getEarlyUploadAspectRatio();
				if (!shouldShowAspectSelector()) {
					const dims = await readRasterFileDimensions(item);
					if (dims) {
						uploadAspect = closestAspectRatioPreset(dims.width, dims.height);
					}
				}
				const uploaded = await uploadFn(item);
				if (typeof uploaded === 'string' && uploaded.trim()) {
					imageUrls.push(uploaded.trim());
					attachmentUploadAspects[i] = null;
				}
			}
		}
		return imageUrls;
	}

	async function handleSubmit() {
		if (submitInFlight) return;
		const userPrompt = (promptInput?.value || '').trim();

		if (isVideoMode()) {
			if (!hasAttachment()) return;
			if (!userPrompt) return;
			const route = getSelectedVideoRoute();
			if (!route) return;
			if (!(await confirmAspectMismatchBeforeSubmit())) return;
			setComposerSubmitting(true);
			let imageUrls;
			try {
				imageUrls = await resolveAttachmentUrls(uploadImageFile);
			} catch (err) {
				setComposerSubmitting(false);
				alert(err?.message || 'Image upload failed');
				return;
			}
			if (imageUrls.length === 0) {
				setComposerSubmitting(false);
				alert('Please choose an image.');
				return;
			}
			const primaryImage = imageUrls[0];
			const ltxVideo = isLtxVideoRoute(route);
			const videoAspect = ltxVideo ? getAspectRatioForSubmit() || selectedAspect : undefined;
			const args = ltxVideo
				? {
						seed: '',
						model: route.value,
						prompt: userPrompt,
						input_images: imageUrls,
						...(videoAspect ? { aspect_ratio: videoAspect } : {}),
					}
				: {
						prompt: userPrompt,
						image: primaryImage,
						model: route.value,
					};
			const mutateLineage = getMutateLineageForSubmit();
			const mentions = extractMentions(userPrompt);
			if (mentions.length === 0) {
				dispatchCreationSubmit({
					serverId: route.serverId,
					methodKey: route.methodKey,
					args,
					hydrateMentions: false,
					...mutateLineage,
				});
				return;
			}
			const validateResult = await validateMentionsSimple({ args });
			if (validateResult.ok) {
				dispatchCreationSubmit({
					serverId: route.serverId,
					methodKey: route.methodKey,
					args,
					hydrateMentions: true,
					...mutateLineage,
				});
				return;
			}
			const message = formatMentionsFailureForDialog(validateResult.data);
			if (window.confirm(message + '\n\nSubmit anyway?')) {
				dispatchCreationSubmit({
					serverId: route.serverId,
					methodKey: route.methodKey,
					args,
					hydrateMentions: false,
					...mutateLineage,
				});
				return;
			}
			setComposerSubmitting(false);
			return;
		}

		if (!userPrompt) return;

		if (hasAttachment()) {
			if (!mutateOptions.serverId || !mutateOptions.methodKey) {
				return;
			}
			if (!(await confirmAspectMismatchBeforeSubmit())) {
				return;
			}
		}

		setComposerSubmitting(true);

		if (hasAttachment()) {
			let imageUrls;
			try {
				imageUrls = await resolveAttachmentUrls(uploadImageFile);
			} catch (err) {
				setComposerSubmitting(false);
				alert(err?.message || 'Image upload failed');
				return;
			}
			if (imageUrls.length === 0) {
				setComposerSubmitting(false);
				alert('Please choose an image.');
				return;
			}
			const imageRoute = getSelectedImageRoute();
			const mutateArgs = {
				prompt: userPrompt,
				model: imageRoute?.value || selectedModel,
				input_images: imageUrls,
			};
			if (imageUrls.length === 1) mutateArgs.image_url = imageUrls[0];
			const args = buildSubmitArgs(mutateArgs, getAspectRatioForSubmit(), getFormFieldContext());
			const mutateLineage = getMutateLineageForSubmit();
			const mentions = extractMentions(userPrompt);
			if (mentions.length === 0) {
				dispatchCreationSubmit({
					serverId: mutateOptions.serverId,
					methodKey: mutateOptions.methodKey,
					args,
					hydrateMentions: false,
					...mutateLineage,
				});
				return;
			}
			const validateResult = await validateMentionsSimple({ args });
			if (validateResult.ok) {
				dispatchCreationSubmit({
					serverId: mutateOptions.serverId,
					methodKey: mutateOptions.methodKey,
					args,
					hydrateMentions: true,
					...mutateLineage,
				});
				return;
			}
			const message = formatMentionsFailureForDialog(validateResult.data);
			if (window.confirm(message + '\n\nSubmit anyway?')) {
				dispatchCreationSubmit({
					serverId: mutateOptions.serverId,
					methodKey: mutateOptions.methodKey,
					args,
					hydrateMentions: false,
					...mutateLineage,
				});
				return;
			}
			setComposerSubmitting(false);
			return;
		}

		const imageRoute = getSelectedImageRoute();
		const submitRoute = getComposerSubmitRoute();
		if (!imageRoute || !submitRoute) {
			setComposerSubmitting(false);
			return;
		}
		const styleKey = resolveSubmitStyleKey(userPrompt);
		const args = buildSubmitArgs(
			{ prompt: userPrompt, model: imageRoute.value },
			getAspectRatioForSubmit(),
			getFormFieldContext()
		);
		const mutateLineage = getMutateLineageForSubmit();
		const mentions = extractMentions(userPrompt);
		const hasStyleSigils = extractStyleSigilKeys(userPrompt).length > 0;
		if (mentions.length === 0 && !hasStyleSigils) {
			dispatchCreationSubmit({
				serverId: submitRoute.serverId,
				methodKey: submitRoute.methodKey,
				args,
				styleKey,
				hydrateMentions: false,
				...mutateLineage,
			});
			return;
		}
		const validateResult = await validateMentionsSimple({ args: { prompt: userPrompt } });
		if (!validateResult.ok) {
			const failedStyles = Array.isArray(validateResult.data?.failed_styles)
				? validateResult.data.failed_styles
				: [];
			if (failedStyles.length > 0) {
				alert(formatStylesFailureForDialog(validateResult.data));
				setComposerSubmitting(false);
				return;
			}
			const message = formatMentionsFailureForDialog(validateResult.data);
			if (window.confirm(message + '\n\nSubmit anyway?')) {
				dispatchCreationSubmit({
					serverId: submitRoute.serverId,
					methodKey: submitRoute.methodKey,
					args,
					styleKey,
					hydrateMentions: false,
					...mutateLineage,
				});
				return;
			}
			setComposerSubmitting(false);
			return;
		}
		dispatchCreationSubmit({
			serverId: submitRoute.serverId,
			methodKey: submitRoute.methodKey,
			args,
			styleKey,
			hydrateMentions: mentions.length > 0,
			...mutateLineage,
		});
	}

	// Restore state
	hydrateMethodCreditsFromStorage();
	bootstrapVideoModelOptions();
	try {
		const savedAspect = localStorage.getItem(STORAGE_KEYS.aspectRatio);
		if (savedAspect && MVP_ASPECT_RATIOS.includes(savedAspect)) selectedAspect = savedAspect;
	} catch (_) {}
	syncAspectFooterState();
	buildAspectPopover();

	populateModelSelect();
	updateComposerCostDisplay();

	void refreshModelOptions();

	const onServersUpdated = () => {
		void refreshModelOptions();
	};
	document.addEventListener('servers-updated', onServersUpdated);
	teardownFns.push(() => document.removeEventListener('servers-updated', onServersUpdated));

	if (promptInput instanceof HTMLTextAreaElement) {
		let restored = '';
		try {
			restored = localStorage.getItem(STORAGE_KEYS.prompt) || '';
			if (!restored.trim()) {
				const carried = localStorage.getItem(STORAGE_KEYS.imageEditCarryover);
				const savedImage = localStorage.getItem(STORAGE_KEYS.imageEditSelection);
				const hadImage =
					(typeof carried === 'string' && carried.trim()) ||
					(typeof savedImage === 'string' && savedImage.trim());
				restored = hadImage
					? localStorage.getItem(STORAGE_KEYS.promptImageEdit) || ''
					: localStorage.getItem(STORAGE_KEYS.promptText) || '';
			}
		} catch (_) {}
		promptInput.value = typeof restored === 'string' ? restored : '';
	}

	try {
		const carried = localStorage.getItem(STORAGE_KEYS.imageEditCarryover);
		if (typeof carried === 'string' && carried.trim()) {
			restoreAttachments([carried.trim()]);
			try {
				localStorage.setItem(STORAGE_KEYS.imageEditSelection, JSON.stringify([carried.trim()]));
			} catch (_) {}
			localStorage.removeItem(STORAGE_KEYS.imageEditCarryover);
		} else {
			const saved = readStoredAttachmentUrls();
			if (saved.length > 0) restoreAttachments(saved);
		}
		applyQueueSnapshotToAttachments();
	} catch (_) {}

	syncFromSharedSettings();

	const onMutateQueueUpdated = () => {
		applyQueueSnapshotToAttachments({ allowEmpty: true });
	};
	document.addEventListener(MUTATE_QUEUE_UPDATED_EVENT, onMutateQueueUpdated);
	teardownFns.push(() => document.removeEventListener(MUTATE_QUEUE_UPDATED_EVENT, onMutateQueueUpdated));

	const onCreateSettingsUpdated = () => syncFromSharedSettings();
	document.addEventListener(CREATE_SETTINGS_UPDATED_EVENT, onCreateSettingsUpdated);
	teardownFns.push(() =>
		document.removeEventListener(CREATE_SETTINGS_UPDATED_EVENT, onCreateSettingsUpdated)
	);

	syncModeChrome();
	void ensureMethodCreditsCache();
	loadComposerCreditsBalance();
	try {
		refreshAutoGrow(host);
	} catch (_) {}

	const schedulePromptSave = () => {
		clearTimeout(promptSaveTimer);
		promptSaveTimer = setTimeout(savePrompt, 300);
	};

	if (addBtn instanceof HTMLButtonElement) {
		const onAdd = () => openImagePicker();
		addBtn.addEventListener('click', onAdd);
		teardownFns.push(() => addBtn.removeEventListener('click', onAdd));
	}

	if (promptInput) {
		const onPromptInput = () => {
			syncStyleSelectionFromPrompt();
			schedulePromptSave();
			updateSubmitButtonState();
			try {
				refreshAutoGrow(host);
			} catch (_) {}
		};
		const onPaste = (ev) => {
			const imageFiles = clipboardImageFiles(ev.clipboardData);
			if (imageFiles.length === 0) return;
			ev.preventDefault();
			for (const file of imageFiles) void addAttachmentFromFile(file);
		};
		const onPromptKeydown = (ev) => {
			if (ev.key !== 'Enter' || ev.isComposing) return;
			if (!composerEnterKeySubmits()) return;
			if (ev.shiftKey) return;
			if (checkSuggestPopupOpen(promptInput)) return;
			ev.preventDefault();
			void handleSubmit();
		};
		promptInput.addEventListener('input', onPromptInput);
		promptInput.addEventListener('change', schedulePromptSave);
		promptInput.addEventListener('paste', onPaste);
		promptInput.addEventListener('keydown', onPromptKeydown);
		teardownFns.push(() => {
			promptInput.removeEventListener('input', onPromptInput);
			promptInput.removeEventListener('change', schedulePromptSave);
			promptInput.removeEventListener('paste', onPaste);
			promptInput.removeEventListener('keydown', onPromptKeydown);
		});
		const promptInputRow = promptInput.closest('.create-composer-input-row');
		attachPromptFieldClear(promptInput, {
			variant: 'icon',
			wrap: promptInputRow instanceof HTMLElement ? promptInputRow : null,
			trackEmpty: false,
			afterClear: () => {
				syncStyleSelectionFromPrompt();
				schedulePromptSave();
				updateSubmitButtonState();
				try {
					refreshAutoGrow(host);
				} catch (_) {}
			},
		});
	}

	if (composerRoot instanceof HTMLElement) {
		const onComposerPaste = (ev) => {
			if (ev.target === promptInput) return;
			const imageFiles = clipboardImageFiles(ev.clipboardData);
			if (imageFiles.length === 0) return;
			ev.preventDefault();
			for (const file of imageFiles) void addAttachmentFromFile(file);
		};
		composerRoot.addEventListener('paste', onComposerPaste);
		teardownFns.push(() => composerRoot.removeEventListener('paste', onComposerPaste));
	}

	if (composerRoot instanceof HTMLElement && composerDropSurface instanceof HTMLElement) {
		const unbindDrop = bindCreateComposerCreationDropTargets(composerRoot, composerDropSurface, {
			isDisabled: () => submitInFlight,
			onAttachImageUrl: (url, detail) => {
				if (outputMode !== 'image') setOutputMode('image');
				const cid = Number(detail?.creationId);
				if (Number.isFinite(cid) && cid > 0) {
					setMutateAttachmentFromCreation(url, cid, detail?.published === true);
					return;
				}
				addAttachmentUrl(url);
			},
		});
		teardownFns.push(unbindDrop);
	}

	if (promptInput instanceof HTMLTextAreaElement) {
		if (typeof opts.attachPromptSuggest === 'function') {
			opts.attachPromptSuggest(promptInput);
		} else {
			const qs = getAssetQuery();
			import(`/shared/triggeredSuggest.js${qs}`)
				.then(({ attachCreateComposerSuggest }) => {
					if (typeof attachCreateComposerSuggest === 'function') {
						attachCreateComposerSuggest(promptInput);
					}
				})
				.catch((err) => {
					console.error('[createComposer] suggest failed to load:', err);
				});
		}
	}

	if (advancedLink) {
		const onAdvanced = async (e) => {
			e.preventDefault();
			if (attachmentUploadingCount > 0) return;
			savePrompt();
			saveAspectRatio(selectedAspect);
			saveAttachmentsToStorage();
			// Explicit Advanced navigation always carries the visible model route (pre-a472186
			// behavior). shouldComposerSnapshotIncludeModelRoute is for passive sync only.
			saveModelSelection(selectedModel);
			writeSharedCreateSettingsFromComposerSnapshot({
				prompt: promptInput?.value || '',
				aspectRatio: selectedAspect,
				outputMode,
				modelRoute: selectedModel,
				styleSelected: getSelectedStyleKey(),
			});
			mergeSharedSettingsIntoSessionSelections();
			try {
				const v =
					document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() ||
					'';
				const qs = v ? `?v=${encodeURIComponent(v)}` : '';
				const runtimeMod = await import(`/shared/createPageRuntime.js${qs}`);
				runtimeMod.setCreateEditorMode('advanced');
				const { navigateToCreateFromSpa } = await import(`/shared/creationDetailOverlay.js${qs}`);
				navigateToCreateFromSpa('/create', e, { forceReload: true });
			} catch {
				window.location.assign('/create');
			}
		};
		advancedLink.addEventListener('click', onAdvanced);
		teardownFns.push(() => advancedLink.removeEventListener('click', onAdvanced));
	}

	if (modelSelect instanceof HTMLSelectElement) {
		const onModelChange = () => applySelectedModel(modelSelect.value);
		modelSelect.addEventListener('change', onModelChange);
		teardownFns.push(() => modelSelect.removeEventListener('change', onModelChange));
	}

	modeBtns.forEach((btn) => {
		if (!(btn instanceof HTMLButtonElement)) return;
		const onMode = () => {
			const mode = btn.getAttribute('data-create-mode');
			if (mode === 'image' || mode === 'video') setOutputMode(mode);
		};
		btn.addEventListener('click', onMode);
		teardownFns.push(() => btn.removeEventListener('click', onMode));
	});

	if (outputMode === 'video') {
		modelOptions = getActiveModelList();
		populateModelSelect();
	}

	if (aspectBtn) {
		const onAspectClick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const willOpen = Boolean(aspectPopover?.hidden);
			aspectPopoverIgnoreDocClose = true;
			setAspectPopoverOpen(willOpen);
			requestAnimationFrame(() => {
				aspectPopoverIgnoreDocClose = false;
			});
		};
		aspectBtn.addEventListener('click', onAspectClick);
		teardownFns.push(() => aspectBtn.removeEventListener('click', onAspectClick));
	}
	if (aspectPopoverClose) {
		const onAspectClose = () => setAspectPopoverOpen(false);
		aspectPopoverClose.addEventListener('click', onAspectClose);
		teardownFns.push(() => aspectPopoverClose.removeEventListener('click', onAspectClose));
	}

	const onDocClickCloseToolbarPopovers = (e) => {
		if (aspectPopoverIgnoreDocClose) return;
		const target = e.target instanceof Node ? e.target : null;
		if (aspectPopover && !aspectPopover.hidden) {
			if (
				!target ||
				(!aspectPopover.contains(target) &&
					!aspectBtn?.contains(target) &&
					!aspectWrap?.contains(target))
			) {
				setAspectPopoverOpen(false);
			}
		}
	};
	document.addEventListener('click', onDocClickCloseToolbarPopovers);
	teardownFns.push(() => document.removeEventListener('click', onDocClickCloseToolbarPopovers));

	const onRepositionToolbarPopovers = () => {
		if (aspectPopover && !aspectPopover.hidden) positionAspectPopover();
	};
	window.addEventListener('resize', onRepositionToolbarPopovers);
	window.addEventListener('scroll', onRepositionToolbarPopovers, true);
	teardownFns.push(() => {
		window.removeEventListener('resize', onRepositionToolbarPopovers);
		window.removeEventListener('scroll', onRepositionToolbarPopovers, true);
	});

	if (submitBtn) {
		const onSubmitClick = () => void handleSubmit();
		submitBtn.addEventListener('click', onSubmitClick);
		teardownFns.push(() => submitBtn.removeEventListener('click', onSubmitClick));
	}

	return {
		refreshModelOptions,
		syncFromMutateQueue: () => applyQueueSnapshotToAttachments({ allowEmpty: true }),
		syncFromSharedSettings,
		destroy() {
			clearTimeout(promptSaveTimer);
			setAspectPopoverOpen(false);
			for (const fn of teardownFns) {
				try {
					fn();
				} catch (_) {}
			}
			revokeAttachmentBlobUrls();
			host.innerHTML = '';
		},
	};
}
