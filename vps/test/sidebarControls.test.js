import assert from 'node:assert/strict';
import test from 'node:test';
import { sidebarRowMenuItems } from '../client/config/sidebar.js';
import { createServersStore } from '../db/servers.js';
import { createThreadsStore } from '../db/threads.js';

test('sidebar gear menus match the live row actions', () => {
	const dm = sidebarRowMenuItems({ section: 'dm', profilePath: '/p/ada', pinKey: 'pair:1:2', pinned: false });
	assert.deepEqual(dm.map((item) => item.action || 'separator'), ['profile', 'mark-read', 'pin', 'separator', 'hide']);
	assert.equal(sidebarRowMenuItems({ section: 'dm', profilePath: '/p/ada', pinKey: 'pair:1:2', pinned: true })[2].label, 'Unpin Chat');
	const server = sidebarRowMenuItems({ section: 'server', server: { id: 4 }, route: { threadId: 9 } });
	assert.deepEqual(server.map((item) => item.label), ['Mark as Read', 'Server details']);
	const channel = sidebarRowMenuItems({ section: 'channel', route: { threadId: 9 } });
	assert.equal(channel.at(-1).action, 'leave');
	assert.equal(sidebarRowMenuItems({ section: 'channel', route: { threadId: 0 } }).some((item) => item.action === 'leave'), false);
});

function queryClient(reply) {
	return {
		from(table) {
			const state = { table, op: 'select', payload: null };
			const builder = {
				select() { return builder; },
				insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
				update(payload) { state.op = 'update'; state.payload = payload; return builder; },
				delete() { state.op = 'delete'; return builder; },
				upsert(payload, options) { state.op = 'upsert'; state.payload = payload; state.options = options; return builder; },
				eq() { return builder; },
				single() { return reply(state); },
				maybeSingle() { return reply(state); },
				then(resolve, reject) { return Promise.resolve(reply(state)).then(resolve, reject); },
			};
			return builder;
		},
	};
}

test('opening a DM reuses the pair and clears a hidden sidebar row', async () => {
	const calls = [];
	const client = queryClient((state) => {
		calls.push(state.op);
		if (state.op === 'select') return { data: { id: 44 } };
		return { data: null };
	});
	const store = createThreadsStore(client, { byId: async () => ({ id: 8 }) });
	const opened = await store.openDm(3, { otherUserId: 8 });
	assert.equal(opened.thread.dm_pair_key, '3:8');
	assert.deepEqual(calls, ['select', 'upsert', 'update']);
});

test('hiding is limited to direct messages and leaving is limited to channels', async () => {
	const client = queryClient((state) => ({ data: state.table === 'prsn_chat_threads' ? { id: 4, type: 'channel' } : { user_id: 1 } }));
	const store = createThreadsStore(client, {});
	await assert.rejects(store.hideThread(1, 4), (error) => error.status === 400);
	const left = await store.leaveThread(1, 4);
	assert.equal(left.left, true);
});

test('server details keep credentials with the people who can manage', async () => {
	const server = {
		id: 4, user_id: 9, name: 'Studio', description: 'A studio', status: 'active',
		members_count: 2, created_at: '2020-01-01', updated_at: '2020-01-02',
		meta: { avatar_url: '/a.png' }, server_url: 'https://provider.example/api', auth_token: 'secret',
		server_config: { methods: { draw: { name: 'Draw' } }, custom_headers: { 'X-Key': 'hide' }, auth_token: 'nope' },
	};
	const client = {
		from(table) {
			const builder = {
				select() { return builder; },
				eq() { return builder; },
				maybeSingle() {
					return Promise.resolve({ data: table === 'prsn_servers' ? server : { server_id: 4 } });
				},
			};
			return builder;
		},
	};
	const users = {
		byId: async (id) => ({ id: Number(id), email: 'ada@example.com', role: 'user' }),
		profileByUserId: async () => ({ user_name: 'ada', display_name: 'Ada', avatar_url: '' }),
	};
	const store = createServersStore(client, users);
	const member = await store.getById(3, 4);
	assert.equal(member.server.can_manage, false);
	assert.equal(member.server.is_member, true);
	assert.equal(member.server.owner.display_name, 'Ada');
	assert.equal(member.server.auth_token, undefined);
	assert.equal(member.server.server_url, undefined);
	assert.equal(member.server.server_config.methods.draw.name, 'Draw');
	assert.equal(member.server.server_config.custom_headers, undefined);
	const owner = await store.getById(9, 4);
	assert.equal(owner.server.can_manage, true);
	assert.equal(owner.server.server_url, 'https://provider.example/api');
	assert.equal(owner.server.auth_token, 'secret');
	assert.equal(owner.server.server_config.custom_headers['X-Key'], 'hide');
	await assert.rejects(store.update(3, 4, { name: 'Nope' }), (error) => error.status === 403);
});

test('public generation servers cannot be joined or left', async () => {
	let inserted = false;
	const client = {
		from() {
			return {
				select() { return this; },
				eq() { return this; },
				insert() { inserted = true; return this; },
				maybeSingle() { return Promise.resolve({ data: { id: 1, user_id: 9, status: 'active' } }); },
			};
		},
	};
	const store = createServersStore(client, {});
	await assert.rejects(store.join(3, 1), (error) => error.status === 400);
	await assert.rejects(store.leave(3, 1), (error) => error.status === 400 && error.message === 'You cannot leave this server');
	assert.equal(inserted, false);
});
