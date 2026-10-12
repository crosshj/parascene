import assert from 'node:assert/strict';
import test from 'node:test';
import { creationCardMarkup } from '../client/shared/creationGrid.js';
import { creationGpuWaitLabel } from '../client/shared/creationGpuWait.js';
import { createPendingCreationsStore } from '../client/providers/creations/pending.js';

function installSession() {
	const store = new Map();
	globalThis.sessionStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => { store.set(key, String(value)); },
		removeItem: (key) => { store.delete(key); }
	};
}

test('an in-flight server row hides the placeholder without forgetting the optimistic wait', () => {
	installSession();
	const pending = createPendingCreationsStore('viewer');
	sessionStorage.setItem(pending.key, JSON.stringify([{
		id: 41,
		status: 'creating',
		created_at: new Date().toISOString(),
		creation_token: 'crt_test',
		placeholder_id: 'pending-1'
	}]));
	const visible = pending.reconcile([{ id: 41, status: 'creating', meta: { creation_token: 'crt_test' } }]);
	assert.deepEqual(visible, []);
	assert.equal(pending.read().length, 1);
	const afterFinish = pending.reconcile([{ id: 41, status: 'completed', meta: { creation_token: 'crt_test' } }]);
	assert.deepEqual(afterFinish, []);
	assert.equal(pending.read().length, 0);
});

test('queued is the optimistic wait and generating starts once the server row is creating', () => {
	const optimistic = creationCardMarkup({ id: 41, status: 'creating', __optimistic: true, creation_token: 'crt_test' });
	const confirmed = creationCardMarkup({ id: 41, status: 'creating', meta: { creation_token: 'crt_test' } });
	assert.match(optimistic, />QUEUED</);
	assert.doesNotMatch(optimistic, /GENERATING/);
	assert.match(confirmed, /GENERATING…/);
	assert.doesNotMatch(confirmed, />QUEUED</);
	assert.equal(creationGpuWaitLabel('creating'), 'Generating…');
	assert.equal(creationGpuWaitLabel('pending'), 'QUEUED');
});

test('a timed-out creation shows the timeout state on the grid', () => {
	const failed = creationCardMarkup({
		id: 9,
		status: 'failed',
		meta: { error_code: 'timeout' },
	});
	const stillRunning = creationCardMarkup({
		id: 10,
		status: 'processing',
		meta: { timeout_at: '2020-01-01T00:00:00.000Z' },
	});
	const messageOnly = creationCardMarkup({
		id: 11,
		status: 'failed',
		meta: { error: 'Timed out waiting for generation to finish.' },
	});
	const clockThenFailed = creationCardMarkup({
		id: 12,
		status: 'failed',
		meta: { timeout_at: '2020-01-01T00:00:00.000Z', error_code: 'provider_error' },
	});
	const plainFailed = creationCardMarkup({
		id: 13,
		status: 'failed',
		meta: { error_code: 'provider_error', error: 'Server is not active' },
	});
	for (const markup of [failed, stillRunning, messageOnly, clockThenFailed]) {
		assert.match(markup, /creation-grid__status is-timeout/);
		assert.match(markup, /TIMED OUT/);
		assert.doesNotMatch(markup, />FAILED</);
		assert.doesNotMatch(markup, /route-media-wait/);
	}
	assert.match(plainFailed, />FAILED</);
	assert.doesNotMatch(plainFailed, /TIMED OUT/);
	assert.doesNotMatch(stillRunning, /GENERATING/);
});
