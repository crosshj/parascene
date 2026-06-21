import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
	CREATE_PAGE_SELECTIONS_SESSION_KEY,
	CREATE_SETTINGS_STORAGE_KEYS,
	encodeSharedModelRoute,
	getSharedFieldValueOverrides,
	mergeSharedSettingsIntoSessionSelections,
	parseSharedModelRoute,
	persistSharedAspectRatio,
	clearSharedCreatePrompt,
	persistSharedPrompt,
	readSharedCreateSettings,
	resolveSharedPrompt,
	shouldComposerSnapshotIncludeModelRoute,
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

	test('merges server/method from dedicated keys when model route is absent', () => {
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.serverId, '6');
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.methodKey, 'image2video');

		mergeSharedSettingsIntoSessionSelections();

		const parsed = JSON.parse(sessionStorage.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(parsed.serverId).toBe(6);
		expect(parsed.methodKey).toBe('image2video');
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

	test('provider-form save with empty prompt field does not clobber shared prompt', () => {
		persistSharedPrompt('keep me', { notify: false });

		syncCreatePageSelectionsToSharedStorage({
			fieldValues: { prompt: '' },
			methodFields: { prompt: { label: 'Prompt' } },
			notify: false,
		});

		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.prompt)).toBe('keep me');
	});

	test('persists server and method before model is chosen', () => {
		syncCreatePageSelectionsToSharedStorage({
			fieldValues: {},
			serverId: 6,
			methodKey: 'image2video',
			notify: false,
		});

		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.serverId)).toBe('6');
		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.methodKey)).toBe('image2video');
		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.model)).toBeNull();
	});

	test('composer-only model keys do not affect advanced session merge', () => {
		const sessionStorage = makeStorage();
		global.window = { localStorage, sessionStorage };
		const advancedRoute = encodeSharedModelRoute(99, 'txt2img', 'flux-special');
		persistSharedPrompt('advanced prompt', { notify: false });
		writeSharedCreateSettingsFromComposerSnapshot({
			modelRoute: advancedRoute,
			outputMode: 'image',
			notify: false,
		});
		localStorage.setItem(
			CREATE_SETTINGS_STORAGE_KEYS.composerModel,
			encodeSharedModelRoute(1, 'replicate', 'xai/grok-imagine-image')
		);

		mergeSharedSettingsIntoSessionSelections();

		const parsed = JSON.parse(sessionStorage.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(parsed.serverId).toBe(99);
		expect(parsed.methodKey).toBe('txt2img');
		expect(parsed.fieldValues.model).toBe('flux-special');
	});
});

describe('shouldComposerSnapshotIncludeModelRoute', () => {
	const grokRoute = encodeSharedModelRoute(1, 'replicate', 'xai/grok-imagine-image');
	const fluxRoute = encodeSharedModelRoute(99, 'txt2img', 'flux-special');
	const representable = [grokRoute];

	test('includes model when shared route is absent', () => {
		expect(
			shouldComposerSnapshotIncludeModelRoute({
				selectedModelRoute: grokRoute,
				representableRouteKeys: representable,
			})
		).toBe(true);
	});

	test('includes model when shared route is also representable', () => {
		expect(
			shouldComposerSnapshotIncludeModelRoute({
				selectedModelRoute: grokRoute,
				sharedModelRoute: grokRoute,
				representableRouteKeys: representable,
			})
		).toBe(true);
	});

	test('omits fallback model when shared advanced route is outside composer', () => {
		expect(
			shouldComposerSnapshotIncludeModelRoute({
				selectedModelRoute: grokRoute,
				sharedModelRoute: fluxRoute,
				representableRouteKeys: representable,
			})
		).toBe(false);
	});

	test('includes model when user explicitly picked composer model over unrepresentable shared route', () => {
		expect(
			shouldComposerSnapshotIncludeModelRoute({
				selectedModelRoute: grokRoute,
				sharedModelRoute: fluxRoute,
				composerSavedModelRoute: grokRoute,
				representableRouteKeys: representable,
			})
		).toBe(true);
	});
});

describe('clearSharedCreatePrompt', () => {
	test('clears localStorage prompt keys and session prompt-like field values', () => {
		const localStorage = makeStorage();
		const sessionStorage = makeStorage();
		global.window = { localStorage, sessionStorage };
		const dispatched = [];
		global.document = { dispatchEvent: (event) => dispatched.push(event) };

		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.prompt, 'hello');
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.promptText, 'hello');
		localStorage.setItem(CREATE_SETTINGS_STORAGE_KEYS.promptImageEdit, 'hello');
		sessionStorage.setItem(
			CREATE_PAGE_SELECTIONS_SESSION_KEY,
			JSON.stringify({
				fieldValues: { prompt: 'hello', negative_prompt: 'bad', model: 'flux' },
				advancedOptions: { prompt: 'hello' },
			})
		);

		clearSharedCreatePrompt({ notify: true });

		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.prompt)).toBe('');
		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.promptText)).toBe('');
		expect(localStorage.getItem(CREATE_SETTINGS_STORAGE_KEYS.promptImageEdit)).toBe('');
		const selections = JSON.parse(sessionStorage.getItem(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(selections.fieldValues.prompt).toBe('');
		expect(selections.fieldValues.negative_prompt).toBe('');
		expect(selections.fieldValues.model).toBe('flux');
		expect(selections.advancedOptions.prompt).toBe('');
		expect(dispatched.length).toBe(1);

		delete global.window;
		delete global.document;
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
