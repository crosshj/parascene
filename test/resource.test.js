import assert from 'node:assert/strict';
import test from 'node:test';
import { createResource } from '../client/core/resource.js';

test('resource keeps cached data visible during refresh and persists replacements', async () => {
	let saved = { data: { files: ['cached'] }, updatedAt: Date.now() };
	let resolveLoad;
	const cache = { read: () => saved, write: (value) => { saved = value; } };
	const resource = createResource({ key: ['files', 7], cache, load: () => new Promise((resolve) => { resolveLoad = resolve; }) });
	assert.deepEqual(resource.data, { files: ['cached'] });
	const refresh = resource.refresh();
	assert.equal(resource.status, 'refreshing');
	assert.deepEqual(resource.data, { files: ['cached'] });
	await Promise.resolve();
	resolveLoad({ files: ['fresh'] });
	await refresh;
	assert.equal(resource.status, 'ready');
	assert.deepEqual(resource.data, { files: ['fresh'] });
	assert.deepEqual(saved.data, { files: ['fresh'] });
	resource.destroy();
});

test('resource reports stale refresh failure without discarding usable data', async () => {
	const resource = createResource({
		key: ['roster', 9],
		initialData: { dms: ['known-good'] },
		load: async () => { throw new Error('offline'); }
	});
	await assert.rejects(resource.refresh(), /offline/);
	assert.equal(resource.status, 'stale-error');
	assert.deepEqual(resource.data, { dms: ['known-good'] });
	resource.destroy();
});

test('resource deduplicates a read and rejects stale generations after force refresh', async () => {
	const deferred = [];
	const resource = createResource({ key: 'x', load: () => new Promise((resolve) => deferred.push(resolve)) });
	const first = resource.refresh();
	await Promise.resolve();
	const second = resource.refresh();
	assert.equal(deferred.length, 1);
	const forced = resource.refresh({ force: true });
	await Promise.resolve();
	assert.equal(deferred.length, 2);
	deferred[0]('obsolete');
	deferred[1]('current');
	await Promise.all([first, second, forced]);
	assert.equal(resource.data, 'current');
	resource.destroy();
});
