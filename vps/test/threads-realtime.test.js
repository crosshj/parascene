import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadsRealtime } from '../client/providers/threads/realtime.js';
import { createThreadsProvider } from '../client/providers/threads/index.js';
import { createQueryRegistry } from '../client/core/queryRegistry.js';
import { createQueryRefresh } from '../client/providers/threads/refresh.js';
import { createThreadMessagesQuery } from '../client/providers/threads/query.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
function transport(request) {
	const channels = [];
	const removed = [];
	let disconnected = false;
	const client = {
		auth: { async setSession() { return {}; }, stopAutoRefresh() {} },
		realtime: { disconnect() { disconnected = true; } },
		channel(topic) {
			const entry = { topic, listeners: {}, on(_type, { event }, callback) { this.listeners[event] = callback; return this; }, subscribe(callback) { this.status = callback; return this; } };
			channels.push(entry); return entry;
		},
		async removeChannel(channel) { removed.push(channel.topic); },
	};
	const realtime = createThreadsRealtime({ viewerId: 1, request: request || (async () => ({ viewer_id: 1, url: 'fixture', anonKey: 'fixture', access_token: 'fixture', refresh_token: 'fixture' })), makeClient: () => client });
	return { realtime, channels, removed, get disconnected() { return disconnected; } };
}

test('late authentication cannot attach a released room subscription', async () => {
	let complete;
	const state = transport(() => new Promise((resolve) => { complete = resolve; }));
	const release = state.realtime.subscribe('room:7', () => {});
	release();
	complete({ viewer_id: 1, url: 'fixture', anonKey: 'fixture' });
	await settle();
	assert.equal(state.channels.length, 0);
	state.realtime.destroy();
	assert.equal(state.disconnected, true);
});

test('first connection, broadcasts, and reconnect invalidate; teardown cancels queued invalidation', async () => {
	const state = transport();
	let dirty = 0;
	const release = state.realtime.subscribe('room:7', () => { dirty++; }, { debounceMs: 0 });
	await settle();
	const channel = state.channels[0];
	channel.status('SUBSCRIBED'); await settle();
	channel.listeners.dirty(); await settle();
	channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED'); await settle();
	assert.equal(dirty, 3);
	channel.listeners.dirty(); release(); await settle();
	assert.equal(dirty, 3);
	assert.deepEqual(state.removed, ['room:7']);
	state.realtime.destroy();
});

test('message leases share one room listener and the final release removes it', () => {
	const subscribed = [];
	const removed = [];
	const registry = createQueryRegistry();
	const provider = createThreadsProvider({ viewerId: 1, registry,
		apiFactory: () => ({}),
		realtimeFactory: () => ({ subscribe(topic) { subscribed.push(topic); return () => removed.push(topic); }, destroy() {}, retry() {} }),
	});
	const first = provider.acquireMessages(7);
	const second = provider.acquireMessages(7);
	assert.equal(first.query, second.query);
	assert.deepEqual(subscribed, ['room:7']);
	first.release(); assert.deepEqual(removed, []);
	second.release(); second.release(); assert.deepEqual(removed, ['room:7']);
	provider.destroy(); registry.clear();
});

test('an invalidation during an in-flight fetch schedules another fetch', async () => {
	let complete;
	let calls = 0;
	const refresh = createQueryRefresh({ refresh() { if (++calls === 1) return new Promise((resolve) => { complete = resolve; }); return Promise.resolve(); } });
	refresh.request(); refresh.request(); refresh.request();
	assert.equal(calls, 1); complete(); await settle();
	assert.equal(calls, 2); refresh.destroy(); refresh.request(); assert.equal(calls, 2);
});

test('a room refresh retains older history and fetches gaps accumulated while disconnected', async () => {
	const requested = [];
	const api = { async loadMessages(_id, { before }) {
		requested.push(before);
		return before === 'older' ? { messages: [{ id: 1, reactions: { heart: ['@person'] } }, { id: 2 }], hasMore: false, nextBefore: null }
			: before ? { messages: [{ id: 3 }, { id: 4 }], hasMore: true, nextBefore: 'older' }
			: { messages: [{ id: 5 }, { id: 6 }], hasMore: true, nextBefore: 'gap' };
	} };
	const registry = createQueryRegistry();
	const lease = createThreadMessagesQuery({ threadId: 7, api, registry });
	lease.query.setData({ messages: [{ id: 1 }, { id: 2 }, { id: 3 }], hasMore: false, nextBefore: null });
	await lease.query.refresh();
	assert.deepEqual(lease.query.data.messages.map((row) => row.id), [1, 2, 3, 4, 5, 6]);
	assert.equal(lease.query.data.hasMore, false);
	assert.deepEqual(requested, [undefined, 'gap', 'older']);
	assert.deepEqual(lease.query.data.messages[0].reactions, { heart: ['@person'] });
	lease.release();
});

test('a room refresh preserves older pages and send responses published during its fetch', async () => {
	let complete;
	const registry = createQueryRegistry();
	const lease = createThreadMessagesQuery({ threadId: 7, registry, api: { loadMessages: () => new Promise((resolve) => { complete = resolve; }) } });
	lease.query.setData({ messages: [{ id: 3 }, { id: 4 }], hasMore: true, nextBefore: 'old' });
	const request = lease.query.refresh();
	await settle();
	lease.query.setData({ messages: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 6 }], hasMore: false, nextBefore: null });
	complete({ messages: [{ id: 3 }, { id: 4 }, { id: 5 }], hasMore: true, nextBefore: 'old' });
	await request;
	assert.deepEqual(lease.query.data.messages.map((row) => row.id), [1, 2, 3, 4, 5, 6]);
	assert.equal(lease.query.data.hasMore, false);
	lease.release();
});
