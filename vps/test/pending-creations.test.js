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
