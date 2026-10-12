import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
	CREATE_SERVERS_CACHE_TTL_MS,
	clearCreateServersCache,
	getCreateServersPaint,
	isCreateServersCacheExpired,
	processCreateServers,
	readCreateServersCache,
	serversListSame,
	writeCreateServersCache,
} from '../public/shared/createServersCache.js';
import { DEFAULT_CREATE_SERVERS } from '../public/shared/createServersDefault.js';

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

describe('createServersCache', () => {
	/** @type {ReturnType<typeof makeStorage>} */
	let localStorage;

	beforeEach(() => {
		localStorage = makeStorage();
		global.localStorage = localStorage;
		clearCreateServersCache();
	});

	afterEach(() => {
		clearCreateServersCache();
		delete global.localStorage;
	});

	test('paints from bundled defaults when cache is empty', () => {
		const paint = getCreateServersPaint();
		expect(paint.source).toBe('bundle');
		expect(paint.shouldRefresh).toBe(true);
		expect(paint.servers.length).toBeGreaterThan(0);
		expect(paint.servers[0].id).toBe(DEFAULT_CREATE_SERVERS[0].id);
	});

	test('paints from cache when present and skips refresh while fresh', () => {
		const servers = [{ id: 99, name: 'Cached', server_config: { methods: {} } }];
		writeCreateServersCache(servers);
		const paint = getCreateServersPaint();
		expect(paint.source).toBe('cache');
		expect(paint.shouldRefresh).toBe(false);
		expect(paint.servers).toEqual(servers);
	});

	test('marks cache expired after TTL', () => {
		const servers = [{ id: 2, name: 'Old' }];
		writeCreateServersCache(servers);
		const cached = readCreateServersCache();
		expect(isCreateServersCacheExpired(cached.cachedAt)).toBe(false);
		expect(isCreateServersCacheExpired(cached.cachedAt - CREATE_SERVERS_CACHE_TTL_MS - 1)).toBe(true);

		const originalNow = Date.now;
		Date.now = () => cached.cachedAt + CREATE_SERVERS_CACHE_TTL_MS + 1;
		try {
			const paint = getCreateServersPaint();
			expect(paint.source).toBe('cache');
			expect(paint.shouldRefresh).toBe(true);
		} finally {
			Date.now = originalNow;
		}
	});

	test('processCreateServers keeps public and membership servers', () => {
		const processed = processCreateServers([
			{ id: 1, name: 'Public', suspended: false },
			{ id: 9, name: 'Member', is_member: true, suspended: false },
			{ id: 10, name: 'Suspended', is_member: true, suspended: true },
			{ id: 11, name: 'Stranger', suspended: false },
		]);
		expect(processed.map((s) => s.id)).toEqual([1, 9]);
	});

	test('serversListSame is true only for matching id/name/config', () => {
		const a = [{ id: 1, name: 'A', server_config: { x: 1 } }];
		expect(serversListSame(a, [{ id: 1, name: 'A', server_config: { x: 1 } }])).toBe(true);
		expect(serversListSame(a, [{ id: 1, name: 'A', server_config: { x: 2 } }])).toBe(false);
		expect(serversListSame(a, [{ id: 2, name: 'A', server_config: { x: 1 } }])).toBe(false);
	});
});
