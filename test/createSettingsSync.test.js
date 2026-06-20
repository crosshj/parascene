import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
	CREATE_PAGE_SELECTIONS_SESSION_KEY,
	CREATE_SETTINGS_STORAGE_KEYS,
	encodeSharedModelRoute,
	getSharedFieldValueOverrides,
	mergeSharedSettingsIntoSessionSelections,
	parseSharedModelRoute,
	persistSharedAspectRatio,
	persistSharedPrompt,
	readSharedCreateSettings,
	resolveSharedPrompt,
	syncCreatePageSelectionsToSharedStorage,
	writeSharedCreateSettingsFromComposerSnapshot,
} from '../public/shared/createSettingsSync.js';

function makeStorage() {
	/** @type {Record<string, string>} */
	const data = {};
	return {
		getItem(key) {
			return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
		},
		setItem(key, value) {
			data[key] = String(value);
		},
		removeItem(key) {
			delete data[key];
		},
		clear() {
			for (const key of Object.keys(data)) delete data[key];
		},
	};
}

describe('parseSharedModelRoute', () => {
	test('parses encoded composer route key', () => {
		const key = encodeSharedModelRoute(1, 'txt2img', 'flux-dev');
		expect(parseSharedModelRoute(key)).toEqual({
			serverId: 1,
			methodKey: 'txt2img',
			model: 'flux-dev',
		});
	});
});

describe('resolveSharedPrompt', () => {
	test('prefers unified prompt key', () => {
		expect(
			resolveSharedPrompt({
				prompt: ' unified ',
				promptText: 'text',
				promptImageEdit: 'edit',
			})
		).toBe('unified');
	});
});

describe('mergeSharedSettingsIntoSessionSelections', () => {
	/** @type {ReturnType<typeof makeStorage>} */
	let localStorage;
	/** @type {ReturnType<typeof makeStorage>} */
	let sessionStorage;

	beforeEach(() => {
		localStorage = makeStorage();
		sessionStorage = makeStorage();
		global.window = {
			localStorage,
			sessionStorage,
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('merges aspect ratio and prompt into session selections', () => {
		sessionStorage.setItem(
			CREATE_PAGE_SELECTIONS_SESSION_KEY,
			JSON.stringify({
				serverId: 2,
				methodKey: 'old',
				fieldValues: { aspect_ratio: '1:1', prompt: 'old prompt' },
				advancedOptions: { prompt: 'old prompt' },
			})
		);
		persistSharedPrompt('new prompt from composer', { notify: false });
		persistSharedAspectRatio('9:16', { notify: false });

		mergeSharedSettingsIntoSessionSelections();

		const parsed = JSON.parse(sessionStorage.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(parsed.fieldValues.aspect_ratio).toBe('9:16');
		expect(parsed.fieldValues.prompt).toBe('new prompt from composer');
		expect(parsed.advancedOptions.prompt).toBe('new prompt from composer');
	});

	test('merges server/method/model from shared route key', () => {
		writeSharedCreateSettingsFromComposerSnapshot({
			modelRoute: encodeSharedModelRoute(5, 'img2img', 'sdxl'),
			outputMode: 'image',
			notify: false,
		});

		mergeSharedSettingsIntoSessionSelections();

		const parsed = JSON.parse(sessionStorage.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(parsed.serverId).toBe(5);
		expect(parsed.methodKey).toBe('img2img');
		expect(parsed.fieldValues.model).toBe('sdxl');
	});
});

describe('getSharedFieldValueOverrides', () => {
	/** @type {ReturnType<typeof makeStorage>} */
	let localStorage;

	beforeEach(() => {
		localStorage = makeStorage();
		global.window = { localStorage, sessionStorage: makeStorage() };
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.aspectRatio, '9:16');
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.prompt, 'hello world');
	});

	afterEach(() => {
		delete global.window;
	});

	test('returns aspect and prompt-like field overrides', () => {
		const overrides = getSharedFieldValueOverrides({
			aspect_ratio: { type: 'string' },
			user_prompt: { label: 'Prompt text' },
			model: { type: 'select' },
		});
		expect(overrides.aspect_ratio).toBe('9:16');
		expect(overrides.user_prompt).toBe('hello world');
	});
});

describe('syncCreatePageSelectionsToSharedStorage', () => {
	/** @type {ReturnType<typeof makeStorage>} */
	let localStorage;

	beforeEach(() => {
		localStorage = makeStorage();
		global.window = { localStorage, sessionStorage: makeStorage() };
	});

	afterEach(() => {
		delete global.window;
	});

	test('provider-form save keeps prompt when Data Builder prompt is omitted', () => {
		persistSharedPrompt('original composer prompt', { notify: false });

		syncCreatePageSelectionsToSharedStorage({
			fieldValues: { prompt: 'updated on createAdvanced' },
			methodFields: { prompt: { label: 'Prompt' } },
			notify: false,
		});

		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.prompt)).toBe('updated on createAdvanced');
	});

	test('explicit empty Data Builder prompt can clear shared prompt', () => {
		persistSharedPrompt('will be cleared', { notify: false });

		syncCreatePageSelectionsToSharedStorage({
			advancedPrompt: '',
			notify: false,
		});

		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.prompt)).toBe('');
	});
});

describe('readSharedCreateSettings', () => {
	test('reads video model route when output mode is video', () => {
		const localStorage = makeStorage();
		global.window = { localStorage, sessionStorage: makeStorage() };
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.outputMode, 'video');
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.videoModel, '3\x1eltx\x1eltx-video');

		const settings = readSharedCreateSettings();
		expect(settings.outputMode).toBe('video');
		expect(settings.modelRoute).toBe('3\x1eltx\x1eltx-video');

		delete global.window;
	});
});
