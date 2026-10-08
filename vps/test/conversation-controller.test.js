import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationController } from '../client/components/Messages/ConversationController.js';
import { createQuery } from '../client/core/query.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(send, getViewer) {
	const snapshots = [];
	let released = false;
	const query = createQuery({ load: async () => ({ messages: [], hasMore: false, nextBefore: null }) });
	const inbox = { threads: [{ id: 7, type: 'channel', channel_slug: 'general' }] };
	const provider = {
		query: createQuery({ initialData: inbox, load: async () => inbox }),
		acquireMessages: () => ({ query, release() { released = true; query.destroy(); } }),
		send,
	};
	const controller = createConversationController({ view: { render: (data) => snapshots.push(structuredClone(data)), setStatus() {}, setReady() {} }, provider, route: { kind: 'channel', slug: 'general' }, viewerId: 1, getViewer });
	return { controller, query, snapshots, get released() { return released; } };
}

test('failed sends retain their body and retry replaces the temporary row with one confirmed message', async () => {
	let attempts = 0;
	const state = fixture(async (_thread, body) => {
		if (++attempts === 1) throw new Error('Offline');
		return { id: 9, body, sender_id: 1, created_at: new Date().toISOString() };
	});
	await settle();
	state.controller.send('Hello');
	await settle();
	const failed = state.snapshots.at(-1).messages[0];
	assert.equal(failed.body, 'Hello');
	assert.equal(failed.delivery.status, 'failed');
	state.controller.retrySend(failed.id);
	await settle();
	assert.deepEqual(state.snapshots.at(-1).messages.map((row) => row.id), [9]);
	state.controller.destroy();
});

test('an optimistic row uses the viewer founder plan before the server confirms', async () => {
	let complete;
	const state = fixture(() => new Promise((resolve) => { complete = resolve; }), () => ({ plan: 'founder', profile: { user_name: 'ada' } }));
	await settle();
	state.controller.send('Hello');
	const pending = state.snapshots.at(-1).messages[0];
	assert.equal(pending.sender_plan, 'founder');
	assert.equal(pending.sender_user_name, 'ada');
	assert.equal(pending.delivery.status, 'pending');
	complete({ id: 9, body: 'Hello', sender_id: 1, sender_plan: 'founder', created_at: pending.created_at });
	await settle();
	state.controller.destroy();
});

test('unmount releases the message query and a late send result cannot render into the old view', async () => {
	let complete;
	const state = fixture(() => new Promise((resolve) => { complete = resolve; }));
	await settle();
	state.controller.send('Hello');
	state.controller.destroy();
	const count = state.snapshots.length;
	complete({ id: 9, body: 'Hello', sender_id: 1 });
	await settle();
	assert.equal(state.released, true);
	assert.equal(state.snapshots.length, count);
});
