import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
	buildAttachmentSnapshotFromQueue,
	getMutateLineageForImageUrls,
	getMutateQueuePrefillForProviderFields,
	normalizeMutateQueueImageUrl,
	persistCreateAttachmentUrls,
	readPersistedCreateAttachmentUrls,
	CREATE_ATTACHMENT_STORAGE_KEYS,
} from '../public/shared/mutateQueueSync.js';

describe('normalizeMutateQueueImageUrl', () => {
	test('normalizes to origin + path', () => {
		expect(normalizeMutateQueueImageUrl('https://app.test/api/images/generic/a.png')).toBe(
			'https://app.test/api/images/generic/a.png'
		);
	});
});

describe('buildAttachmentSnapshotFromQueue', () => {
	test('maps queue items to attachment snapshots', () => {
		const snapshots = buildAttachmentSnapshotFromQueue([
			{
				sourceId: 42,
				imageUrl: 'https://app.test/api/images/generic/frame.png',
				fromFrame: true,
				frameTimeSec: 1.5,
				published: false,
			},
		]);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0].sourceId).toBe(42);
		expect(snapshots[0].fromFrame).toBe(true);
	});
});

describe('getMutateLineageForImageUrls', () => {
	test('returns parent ids matched by normalized URL', () => {
		global.window = { location: { origin: 'https://app.test' } };
		const lineage = getMutateLineageForImageUrls(
			['https://app.test/api/images/generic/frame.png'],
			[
				{
					sourceId: 99,
					imageUrl: '/api/images/generic/frame.png',
				},
			]
		);
		expect(lineage.mutateParentIds).toEqual([99]);
		expect(lineage.mutateOfId).toBe(99);
		delete global.window;
	});
});

describe('getMutateQueuePrefillForProviderFields', () => {
	test('prefills all queue urls into image_url_array fields', () => {
		const prefill = getMutateQueuePrefillForProviderFields(
			{ input_images: { type: 'image_url_array', label: 'Input Images' } },
			[
				{ sourceId: 1, imageUrl: 'https://app.test/a.png' },
				{ sourceId: 2, imageUrl: 'https://app.test/b.png' },
			]
		);
		expect(prefill.input_images).toEqual(['https://app.test/a.png', 'https://app.test/b.png']);
	});
});

describe('syncMutateQueueOrderFromImageUrls', () => {
	const storage = new Map();

	beforeEach(() => {
		storage.clear();
		global.window = {
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => {
					storage.set(key, value);
				},
				removeItem: (key) => {
					storage.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('reorders queue to match image array order', async () => {
		const { addToMutateQueue, loadMutateQueue } = await import('../public/shared/mutateQueue.js');
		const { syncMutateQueueOrderFromImageUrls } = await import('../public/shared/mutateQueueSync.js');

		addToMutateQueue({ sourceId: 1, imageUrl: 'https://app.test/a.png', published: false });
		addToMutateQueue({ sourceId: 2, imageUrl: 'https://app.test/b.png', published: false });

		expect(loadMutateQueue().map((item) => item.imageUrl)).toEqual([
			'https://app.test/b.png',
			'https://app.test/a.png',
		]);

		syncMutateQueueOrderFromImageUrls([
			'https://app.test/a.png',
			'https://app.test/b.png',
		]);

		expect(loadMutateQueue().map((item) => item.imageUrl)).toEqual([
			'https://app.test/a.png',
			'https://app.test/b.png',
		]);
	});
});

describe('syncMutateQueueFromComposerAttachments', () => {
	const storage = new Map();

	beforeEach(() => {
		storage.clear();
		global.window = {
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => {
					storage.set(key, value);
				},
				removeItem: (key) => {
					storage.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('adds pasted composer urls to empty queue', async () => {
		const { loadMutateQueue } = await import('../public/shared/mutateQueue.js');
		const { syncMutateQueueFromComposerAttachments } = await import('../public/shared/mutateQueueSync.js');

		syncMutateQueueFromComposerAttachments(['https://app.test/pasted.png']);

		expect(loadMutateQueue()).toEqual([
			expect.objectContaining({ imageUrl: 'https://app.test/pasted.png', sourceId: null }),
		]);
	});
});

describe('replaceMutateQueueHead', () => {
	const storage = new Map();

	beforeEach(() => {
		storage.clear();
		global.window = {
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => {
					storage.set(key, value);
				},
				removeItem: (key) => {
					storage.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('replaces head and keeps tail when basic picks a new image', async () => {
		const { loadMutateQueue, replaceMutateQueueFromImageUrls, replaceMutateQueueHead } =
			await import('../public/shared/mutateQueue.js');

		replaceMutateQueueFromImageUrls([
			'https://app.test/a.png',
			'https://app.test/b.png',
		]);

		replaceMutateQueueHead('https://app.test/new.png');

		expect(loadMutateQueue().map((item) => item.imageUrl)).toEqual([
			'https://app.test/new.png',
			'https://app.test/b.png',
		]);
	});
});

describe('syncMutateQueueFromProviderFieldValues', () => {
	const storage = new Map();

	beforeEach(() => {
		storage.clear();
		global.window = {
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => {
					storage.set(key, value);
				},
				removeItem: (key) => {
					storage.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('syncs pasted advanced array urls into queue', async () => {
		const { loadMutateQueue } = await import('../public/shared/mutateQueue.js');
		const { syncMutateQueueFromProviderFieldValues } = await import('../public/shared/mutateQueueSync.js');

		syncMutateQueueFromProviderFieldValues(
			{ input_images: ['https://app.test/one.png', 'https://app.test/two.png'] },
			{ input_images: { type: 'image_url_array', label: 'Images' } }
		);

		expect(loadMutateQueue().map((item) => item.imageUrl)).toEqual([
			'https://app.test/one.png',
			'https://app.test/two.png',
		]);
	});
});

describe('persistCreateAttachmentUrls', () => {
	const storage = new Map();

	beforeEach(() => {
		storage.clear();
		global.window = {
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => {
					storage.set(key, value);
				},
				removeItem: (key) => {
					storage.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('round-trips attachment urls', () => {
		persistCreateAttachmentUrls(['https://app.test/a.png', 'https://app.test/b.png']);
		expect(readPersistedCreateAttachmentUrls()).toEqual([
			'https://app.test/a.png',
			'https://app.test/b.png',
		]);
		expect(storage.has(CREATE_ATTACHMENT_STORAGE_KEYS.imageEditSelection)).toBe(true);
	});
});

describe('resolveMutateSubmitRoute', () => {
	test('maps image edit to default replicate route', async () => {
		const { resolveMutateSubmitRoute } = await import('../public/shared/mutateQueueSync.js');
		expect(resolveMutateSubmitRoute('image-to-image')).toEqual({
			serverId: 1,
			methodKey: 'replicate',
			model: 'xai/grok-imagine-image',
			outputMode: 'image',
		});
	});

	test('maps wan i2v to replicate video route', async () => {
		const { resolveMutateSubmitRoute } = await import('../public/shared/mutateQueueSync.js');
		expect(resolveMutateSubmitRoute('image-to-video', 'wan')).toEqual({
			serverId: 1,
			methodKey: 'replicateVideo',
			model: 'wan-video/wan-2.2-i2v-fast',
			outputMode: 'video',
		});
	});

	test('maps ltx i2v to parascene blue route', async () => {
		const { resolveMutateSubmitRoute } = await import('../public/shared/mutateQueueSync.js');
		expect(resolveMutateSubmitRoute('image-to-video', 'ltx')).toEqual({
			serverId: 6,
			methodKey: 'image2video',
			model: 'ltx_i2v',
			outputMode: 'video',
		});
	});
});

describe('syncMutatePageToAdvancedCreate', () => {
	const ls = new Map();
	const ss = new Map();

	beforeEach(() => {
		ls.clear();
		ss.clear();
		global.window = {
			localStorage: {
				getItem: (key) => ls.get(key) ?? null,
				setItem: (key, value) => {
					ls.set(key, value);
				},
				removeItem: (key) => {
					ls.delete(key);
				},
			},
			sessionStorage: {
				getItem: (key) => ss.get(key) ?? null,
				setItem: (key, value) => {
					ss.set(key, value);
				},
				removeItem: (key) => {
					ss.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
			document: {
				dispatchEvent: () => {},
			},
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('queues image and persists shared route + session selections', async () => {
		const { loadMutateQueue } = await import('../public/shared/mutateQueue.js');
		const { syncMutatePageToAdvancedCreate } = await import('../public/shared/mutateQueueSync.js');
		const { readSharedCreateSettings, CREATE_PAGE_SELECTIONS_SESSION_KEY } = await import(
			'../public/shared/createSettingsSync.js'
		);

		syncMutatePageToAdvancedCreate({
			mode: 'image-to-image',
			prompt: 'make it blue',
			aspectRatio: '16:9',
			imageUrl: 'https://app.test/source.png',
			sourceId: 42,
			published: true,
		});

		expect(loadMutateQueue()).toEqual([
			expect.objectContaining({
				sourceId: 42,
				imageUrl: 'https://app.test/source.png',
				published: true,
			}),
		]);

		const settings = readSharedCreateSettings();
		expect(settings.prompt).toBe('make it blue');
		expect(settings.aspectRatio).toBe('16:9');
		expect(settings.outputMode).toBe('image');

		const selections = JSON.parse(ss.get(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(selections.serverId).toBe(1);
		expect(selections.methodKey).toBe('replicate');
		expect(selections.tab).toBe('basic');
		expect(selections.fieldValues.model).toBe('xai/grok-imagine-image');
		expect(selections.fieldValues.aspect_ratio).toBe('16:9');
		expect(selections.fieldValues.prompt).toBe('make it blue');
	});
});

describe('syncCreationDetailToAdvancedCreate', () => {
	const ls = new Map();
	const ss = new Map();

	beforeEach(() => {
		ls.clear();
		ss.clear();
		global.window = {
			localStorage: {
				getItem: (key) => ls.get(key) ?? null,
				setItem: (key, value) => {
					ls.set(key, value);
				},
				removeItem: (key) => {
					ls.delete(key);
				},
			},
			sessionStorage: {
				getItem: (key) => ss.get(key) ?? null,
				setItem: (key, value) => {
					ss.set(key, value);
				},
				removeItem: (key) => {
					ss.delete(key);
				},
			},
			location: { origin: 'https://app.test' },
			document: {
				dispatchEvent: () => {},
			},
		};
	});

	afterEach(() => {
		delete global.window;
	});

	test('persists full provider args and route from creation meta', async () => {
		const { loadMutateQueue } = await import('../public/shared/mutateQueue.js');
		const { syncCreationDetailToAdvancedCreate } = await import('../public/shared/mutateQueueSync.js');
		const { readSharedCreateSettings, CREATE_PAGE_SELECTIONS_SESSION_KEY } = await import(
			'../public/shared/createSettingsSync.js'
		);

		loadMutateQueue().push({
			sourceId: 99,
			imageUrl: 'https://app.test/wrong-output.png',
			published: true,
		});

		const result = syncCreationDetailToAdvancedCreate({
			serverId: 2,
			methodKey: 'replicate',
			args: {
				prompt: '{"cast":[]}',
				model: 'bytedance/seedream-4',
				aspect_ratio: '1:1',
				duration: 8,
				image_url: 'https://app.test/input.png',
				image_url_array: ['https://app.test/ref-a.png', 'https://app.test/ref-b.png'],
			},
			userPrompt: 'A holy vehicle in bubbling darkness',
			outputMode: 'video',
			styleKey: 'cinematic',
		});

		expect(result).toEqual({
			serverId: 2,
			methodKey: 'replicate',
			model: 'bytedance/seedream-4',
			outputMode: 'video',
		});

		expect(loadMutateQueue()).toEqual([]);

		const settings = readSharedCreateSettings();
		expect(settings.prompt).toBe('A holy vehicle in bubbling darkness');
		expect(settings.aspectRatio).toBe('1:1');
		expect(settings.outputMode).toBe('video');
		expect(settings.styleSelected).toBe('cinematic');

		const selections = JSON.parse(ss.get(CREATE_PAGE_SELECTIONS_SESSION_KEY));
		expect(selections.serverId).toBe(2);
		expect(selections.methodKey).toBe('replicate');
		expect(selections.fieldValues.model).toBe('bytedance/seedream-4');
		expect(selections.fieldValues.duration).toBe(8);
		expect(selections.fieldValues.prompt).toBe('A holy vehicle in bubbling darkness');
		expect(selections.fieldValues.image_url).toBe('https://app.test/input.png');
		expect(selections.fieldValues.image_url_array).toEqual([
			'https://app.test/ref-a.png',
			'https://app.test/ref-b.png',
		]);
	});
});
