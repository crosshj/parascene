import { describe, expect, test } from '@jest/globals';
import {
	parseCreationImageIdFromStorageFilename,
	resolveCreatedImageRowForCreatedMediaPath,
	resolveCreatedImageStorageFilename,
} from '../api_routes/utils/resolveCreatedImageStorageFilename.js';

describe('parseCreationImageIdFromStorageFilename', () => {
	test('parses standard created image keys', () => {
		expect(parseCreationImageIdFromStorageFilename('42_9001_1710000000_abc.png')).toBe(9001);
	});

	test('parses anon upload keys', () => {
		expect(parseCreationImageIdFromStorageFilename('anon_9001_1710000000_abc.png')).toBe(9001);
	});

	test('ignores landscape prefix (resolved separately)', () => {
		expect(parseCreationImageIdFromStorageFilename('landscape/42_9001_1710000000_abc.png')).toBe(null);
	});
});

describe('resolveCreatedImageRowForCreatedMediaPath', () => {
	test('falls back to creation_id when filename no longer matches DB row', async () => {
		const currentRow = {
			id: 9001,
			filename: '42_9001_1710000001_new.png',
			file_path: '/api/images/created/42_9001_1710000001_new.png',
		};
		const queries = {
			selectCreatedImageByFilename: {
				get: async (filename) => (filename === currentRow.filename ? currentRow : undefined),
			},
			selectCreatedImageByIdAnyUser: {
				get: async (id) => (Number(id) === 9001 ? currentRow : undefined),
			},
		};

		const stalePath = '42_9001_1710000000_old.png';
		const row = await resolveCreatedImageRowForCreatedMediaPath({
			queries,
			filename: stalePath,
			query: { creation_id: '9001' },
		});

		expect(row).toEqual(currentRow);
		expect(resolveCreatedImageStorageFilename(row)).toBe('42_9001_1710000001_new.png');
	});

	test('falls back to embedded image id in stale filename without query params', async () => {
		const currentRow = {
			id: 77,
			filename: '5_77_2000000000_new.png',
		};
		const queries = {
			selectCreatedImageByFilename: {
				get: async () => undefined,
			},
			selectCreatedImageByIdAnyUser: {
				get: async (id) => (Number(id) === 77 ? currentRow : undefined),
			},
		};

		const row = await resolveCreatedImageRowForCreatedMediaPath({
			queries,
			filename: '5_77_1000000000_old.png',
		});

		expect(row).toEqual(currentRow);
	});
});
