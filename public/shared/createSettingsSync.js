/**
 * Bidirectional sync for shared create settings (composer ↔ /create).
 */

export const CREATE_SETTINGS_UPDATED_EVENT = 'create-settings-updated';

export const CREATE_SETTINGS_STORAGE_KEYS = {
	prompt: 'create_page_prompt',
	promptText: 'create_page_prompt_text',
	promptImageEdit: 'create_page_prompt_image_edit',
	aspectRatio: 'create_page_aspect_ratio',
	model: 'create_page_model',
	modelLabel: 'create_page_model_label',
	styleIndex: 'create_page_style_index',
	styleSelected: 'create_page_style_selected',
	outputMode: 'create_page_output_mode',
	videoModel: 'create_page_video_model',
};

export const CREATE_PAGE_SELECTIONS_SESSION_KEY = 'create-page-selections';

function getLocalStorage() {
	try {
		return typeof window !== 'undefined' ? window.localStorage : null;
	} catch {
		return null;
	}
}

function getSessionStorage() {
	try {
		return typeof window !== 'undefined' ? window.sessionStorage : null;
	} catch {
		return null;
	}
}

function readString(storage, key) {
	try {
		const value = storage?.getItem(key);
		return typeof value === 'string' ? value : '';
	} catch {
		return '';
	}
}

/**
 * @param {string} fieldKey
 * @param {object | null | undefined} field
 * @returns {boolean}
 */
export function isPromptLikeFieldKey(fieldKey, field) {
	const key = String(fieldKey || '');
	const label = String(field?.label || '');
	return /prompt/i.test(key) || /prompt/i.test(label);
}

/**
 * @returns {object}
 */
export function readSharedCreateSettings() {
	const ls = getLocalStorage();
	if (!ls) return {};
	const outputModeRaw = readString(ls, CREATE_SETTINGS_STORAGE_KEYS.outputMode);
	const outputMode = outputModeRaw === 'video' ? 'video' : 'image';
	const modelKey =
		outputMode === 'video'
			? CREATE_SETTINGS_STORAGE_KEYS.videoModel
			: CREATE_SETTINGS_STORAGE_KEYS.model;
	return {
		prompt: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.prompt),
		promptText: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.promptText),
		promptImageEdit: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.promptImageEdit),
		aspectRatio: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.aspectRatio),
		modelRoute: readString(ls, modelKey),
		modelLabel: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.modelLabel),
		styleSelected: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.styleSelected),
		styleIndex: readString(ls, CREATE_SETTINGS_STORAGE_KEYS.styleIndex),
		outputMode,
	};
}

/**
 * @param {ReturnType<typeof readSharedCreateSettings>} [settings]
 * @returns {string}
 */
export function resolveSharedPrompt(settings = readSharedCreateSettings()) {
	if (settings.prompt?.trim()) return settings.prompt.trim();
	if (settings.promptImageEdit?.trim()) return settings.promptImageEdit.trim();
	if (settings.promptText?.trim()) return settings.promptText.trim();
	return '';
}

/**
 * @param {string} routeKey
 * @returns {{ serverId: number, methodKey: string, model: string } | null}
 */
export function parseSharedModelRoute(routeKey) {
	const parts = String(routeKey || '').split('\x1e');
	if (parts.length < 3) return null;
	const serverId = Number(parts[0]);
	const methodKey = parts[1];
	const model = parts.slice(2).join('\x1e');
	if (!Number.isFinite(serverId) || serverId < 1 || !methodKey || !model) return null;
	return { serverId, methodKey, model };
}

/**
 * @param {number} serverId
 * @param {string} methodKey
 * @param {string} model
 * @returns {string}
 */
export function encodeSharedModelRoute(serverId, methodKey, model) {
	return `${serverId}\x1e${methodKey}\x1e${model}`;
}

export function notifyCreateSettingsUpdated() {
	if (typeof document === 'undefined') return;
	document.dispatchEvent(new CustomEvent(CREATE_SETTINGS_UPDATED_EVENT));
}

/**
 * @param {string} prompt
 * @param {{ notify?: boolean }} [options]
 */
export function persistSharedPrompt(prompt, { notify = true } = {}) {
	const value = typeof prompt === 'string' ? prompt : '';
	const ls = getLocalStorage();
	if (!ls) return;
	try {
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.prompt, value);
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.promptText, value);
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.promptImageEdit, value);
	} catch {
		// ignore storage errors
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {string} aspectRatio
 * @param {{ notify?: boolean }} [options]
 */
export function persistSharedAspectRatio(aspectRatio, { notify = true } = {}) {
	const ls = getLocalStorage();
	if (!ls) return;
	try {
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.aspectRatio, String(aspectRatio ?? ''));
	} catch {
		// ignore storage errors
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {string} routeKey
 * @param {{ outputMode?: 'image' | 'video', notify?: boolean }} [options]
 */
export function persistSharedModelRoute(routeKey, { outputMode = 'image', notify = true } = {}) {
	const ls = getLocalStorage();
	if (!ls) return;
	const key =
		outputMode === 'video'
			? CREATE_SETTINGS_STORAGE_KEYS.videoModel
			: CREATE_SETTINGS_STORAGE_KEYS.model;
	try {
		ls.setItem(key, String(routeKey ?? ''));
	} catch {
		// ignore storage errors
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {string} styleSelected
 * @param {{ notify?: boolean }} [options]
 */
export function persistSharedStyleSelected(styleSelected, { notify = true } = {}) {
	const ls = getLocalStorage();
	if (!ls) return;
	try {
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.styleSelected, String(styleSelected ?? ''));
	} catch {
		// ignore storage errors
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {'image' | 'video'} outputMode
 * @param {{ notify?: boolean }} [options]
 */
export function persistSharedOutputMode(outputMode, { notify = true } = {}) {
	const ls = getLocalStorage();
	if (!ls) return;
	const mode = outputMode === 'video' ? 'video' : 'image';
	try {
		ls.setItem(CREATE_SETTINGS_STORAGE_KEYS.outputMode, mode);
	} catch {
		// ignore storage errors
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {{
 *   prompt?: string,
 *   aspectRatio?: string,
 *   outputMode?: 'image' | 'video',
 *   modelRoute?: string,
 *   styleSelected?: string,
 *   notify?: boolean,
 * }} snapshot
 */
export function writeSharedCreateSettingsFromComposerSnapshot(snapshot = {}) {
	const { notify = true } = snapshot;
	if (typeof snapshot.prompt === 'string') {
		persistSharedPrompt(snapshot.prompt, { notify: false });
	}
	if (typeof snapshot.aspectRatio === 'string') {
		persistSharedAspectRatio(snapshot.aspectRatio, { notify: false });
	}
	if (snapshot.outputMode === 'image' || snapshot.outputMode === 'video') {
		persistSharedOutputMode(snapshot.outputMode, { notify: false });
	}
	if (typeof snapshot.modelRoute === 'string') {
		persistSharedModelRoute(snapshot.modelRoute, {
			outputMode: snapshot.outputMode === 'video' ? 'video' : 'image',
			notify: false,
		});
	}
	if (typeof snapshot.styleSelected === 'string') {
		persistSharedStyleSelected(snapshot.styleSelected, { notify: false });
	}
	if (notify) notifyCreateSettingsUpdated();
}

/**
 * Merge localStorage shared settings into sessionStorage create-page-selections.
 * Shared settings win for prompt, aspect_ratio, and model route server/method.
 *
 * @param {string} [sessionKey]
 */
export function mergeSharedSettingsIntoSessionSelections(
	sessionKey = CREATE_PAGE_SELECTIONS_SESSION_KEY
) {
	const ss = getSessionStorage();
	if (!ss) return;

	const settings = readSharedCreateSettings();
	const prompt = resolveSharedPrompt(settings);

	let selections = {};
	try {
		const stored = ss.getItem(sessionKey);
		if (stored) selections = JSON.parse(stored);
	} catch {
		selections = {};
	}
	if (!selections || typeof selections !== 'object') selections = {};
	if (!selections.fieldValues || typeof selections.fieldValues !== 'object') {
		selections.fieldValues = {};
	}
	if (!selections.advancedOptions || typeof selections.advancedOptions !== 'object') {
		selections.advancedOptions = {};
	}

	if (settings.aspectRatio?.trim()) {
		selections.fieldValues.aspect_ratio = settings.aspectRatio.trim();
	}

	if (prompt) {
		selections.advancedOptions.prompt = prompt;
		selections.fieldValues.prompt = prompt;
	}

	const parsed = parseSharedModelRoute(settings.modelRoute);
	if (parsed) {
		selections.serverId = parsed.serverId;
		selections.methodKey = parsed.methodKey;
		if (parsed.model) selections.fieldValues.model = parsed.model;
	}

	try {
		ss.setItem(sessionKey, JSON.stringify(selections));
	} catch {
		// ignore storage errors
	}
}

/**
 * @param {Record<string, unknown> | null | undefined} methodFields
 * @returns {Record<string, string>}
 */
export function getSharedFieldValueOverrides(methodFields) {
	const settings = readSharedCreateSettings();
	/** @type {Record<string, string>} */
	const overrides = {};

	if (settings.aspectRatio?.trim()) {
		overrides.aspect_ratio = settings.aspectRatio.trim();
	}

	const prompt = resolveSharedPrompt(settings);
	if (prompt && methodFields && typeof methodFields === 'object') {
		for (const [key, field] of Object.entries(methodFields)) {
			if (isPromptLikeFieldKey(key, field)) {
				overrides[key] = prompt;
			}
		}
	}

	const parsed = parseSharedModelRoute(settings.modelRoute);
	if (parsed?.model && methodFields?.model) {
		overrides.model = parsed.model;
	}

	return overrides;
}

/**
 * @returns {string}
 */
export function getSharedAdvancedPrompt() {
	return resolveSharedPrompt();
}

/**
 * @param {Record<string, unknown> | null | undefined} fieldValues
 * @param {Record<string, unknown> | null | undefined} methodFields
 * @param {{ notify?: boolean }} [options]
 */
export function syncCreatePageFieldValuesToSharedStorage(fieldValues, methodFields, { notify = true } = {}) {
	if (!fieldValues || typeof fieldValues !== 'object') return;

	if (typeof fieldValues.aspect_ratio === 'string' && fieldValues.aspect_ratio.trim()) {
		persistSharedAspectRatio(fieldValues.aspect_ratio.trim(), { notify: false });
	}

	if (methodFields && typeof methodFields === 'object') {
		for (const [key, field] of Object.entries(methodFields)) {
			if (!isPromptLikeFieldKey(key, field)) continue;
			const val = fieldValues[key];
			if (typeof val === 'string') {
				persistSharedPrompt(val, { notify: false });
				break;
			}
		}
	}

	if (notify) notifyCreateSettingsUpdated();
}

/**
 * @param {{
 *   fieldValues?: Record<string, unknown> | null,
 *   methodFields?: Record<string, unknown> | null,
 *   serverId?: number | null,
 *   methodKey?: string | null,
 *   advancedPrompt?: string,
 *   outputMode?: 'image' | 'video',
 * }} state
 * @param {{ notify?: boolean }} [options]
 */
export function syncCreatePageSelectionsToSharedStorage(state = {}, { notify = true } = {}) {
	const { fieldValues, methodFields, serverId, methodKey, advancedPrompt, outputMode } = state;

	if (typeof fieldValues?.aspect_ratio === 'string' && fieldValues.aspect_ratio.trim()) {
		persistSharedAspectRatio(fieldValues.aspect_ratio.trim(), { notify: false });
	}

	// Data Builder tab passes advancedPrompt explicitly; provider-form saves omit it so an
	// empty Data Builder field cannot clobber the live provider prompt.
	if (typeof advancedPrompt === 'string') {
		persistSharedPrompt(advancedPrompt, { notify: false });
	} else {
		syncCreatePageFieldValuesToSharedStorage(fieldValues, methodFields, { notify: false });
	}

	const modelValue =
		fieldValues && typeof fieldValues.model === 'string' ? fieldValues.model.trim() : '';
	if (serverId && methodKey && modelValue) {
		persistSharedModelRoute(encodeSharedModelRoute(Number(serverId), methodKey, modelValue), {
			outputMode: outputMode === 'video' ? 'video' : 'image',
			notify: false,
		});
	}

	if (notify) notifyCreateSettingsUpdated();
}
