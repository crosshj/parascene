import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadsStore } from '../db/threads.js';

function fakeClient({ member = {}, rows = [] } = {}) {
	const calls = [];
	return {
		calls,
		from(table) {
			const request = {
				select() { return this; }, eq() { return this; }, in() { return this; },
				maybeSingle() { return Promise.resolve({ data: table === 'prsn_chat_members' ? member : { id: 7, type: 'channel', meta: {} } }); },
				then(resolve, reject) { return Promise.resolve({ data: [] }).then(resolve, reject); },
			};
			return request;
		},
		async rpc(name, args) { calls.push({ name, args }); return { data: rows }; },
	};
}

test('message history refuses nonmembers before calling the message RPC', async () => {
	const client = fakeClient({ member: null });
	const store = createThreadsStore(client, {});
	await assert.rejects(store.messages(1, 7), (error) => error.status === 403);
	assert.equal(client.calls.length, 0);
});

test('message history retains WWW cursor contract and returns chronological pages', async () => {
	const client = fakeClient({ rows: [3, 2, 1].map((id) => ({ id, sender_id: 1, body: `Message ${id}`, created_at: `2026-10-01T12:00:0${id}Z` })) });
	const store = createThreadsStore(client, {});
	const page = await store.messages(1, 7, { limit: 2 });
	assert.deepEqual(page.messages.map((row) => row.id), [2, 3]);
	assert.equal(page.hasMore, true);
	assert.deepEqual(JSON.parse(Buffer.from(page.nextBefore, 'base64url')), { c: '2026-10-01T12:00:02Z', i: 2 });
	await store.messages(1, 7, { limit: 2, before: page.nextBefore });
	assert.deepEqual(client.calls[1].args, { p_thread_id: 7, p_before_created_at: '2026-10-01T12:00:02Z', p_before_id: 2, p_limit: 3 });
});

test('message history rejects malformed cursors without fetching data', async () => {
	const client = fakeClient();
	await assert.rejects(createThreadsStore(client, {}).messages(1, 7, { before: 'invalid' }), (error) => error.status === 400);
	assert.equal(client.calls.length, 0);
});

test('sending and read acknowledgements refuse nonmembers', async () => {
	const store = createThreadsStore(fakeClient({ member: null }), {}, { broadcast: async () => {} });
	await assert.rejects(store.send(1, 7, { body: 'Hello' }), (error) => error.status === 403);
	await assert.rejects(store.markRead(1, 7, 9), (error) => error.status === 403);
});

test('the restored message toolbar cannot delete another member\'s message', async () => {
	let deleted = false;
	const client = {
		from(table) {
			return {
				select() { return this; }, eq() { return this; },
				delete() { deleted = true; return this; },
				maybeSingle() { return Promise.resolve({ data: table === 'prsn_chat_messages' ? { id: 9, thread_id: 7, sender_id: 2, meta: {} } : table === 'prsn_chat_members' ? {} : { id: 7, type: 'channel', meta: {} } }); },
			};
		},
	};
	const store = createThreadsStore(client, { byId: async () => ({ role: 'user' }) });
	await assert.rejects(store.remove(1, 9), (error) => error.status === 403);
	assert.equal(deleted, false);
});

test('read acknowledgements validate the target thread and guard against backward updates', async () => {
	const calls = [];
	const client = {
		from(table) {
			const request = {
				select() { return this; }, eq(field, value) { calls.push([table, field, value]); return this; },
				update(value) { calls.push(['update', value]); return this; },
				or(value) { calls.push(['guard', value]); return Promise.resolve({ data: null }); },
				maybeSingle() { return Promise.resolve({ data: table === 'prsn_chat_members' ? { last_read_message_id: 12 } : table === 'prsn_chat_messages' ? { id: 9 } : { id: 7, meta: {} } }); },
			};
			return request;
		},
	};
	const response = await createThreadsStore(client, {}, { broadcast: async () => {} }).markRead(1, 7, 9);
	assert.equal(response.last_read_message_id, 12);
	assert.ok(calls.some((call) => call[0] === 'prsn_chat_messages' && call[1] === 'thread_id' && call[2] === 7));
	assert.ok(calls.some((call) => call[0] === 'guard' && call[1] === 'last_read_message_id.is.null,last_read_message_id.lt.9'));
});
