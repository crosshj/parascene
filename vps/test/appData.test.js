import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDataRoutes } from '../routes/appData.js';

async function withApp(run) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer test') req.auth = { userId: 42 }; next(); });
	app.use(createAppDataRoutes({
		users: {
			byId: async (id) => ({ id: Number(id), email: 'creator@example.com', role: 'consumer', created_at: '2025-01-01T00:00:00.000Z', meta: { plan: 'founder', enableNsfw: true, apiKeyHash: 'secret' } }),
			profileByUserId: async (id) => ({ user_id: Number(id), user_name: 'creator', display_name: 'Creator' })
		},
		credits: {
			get: async () => ({ balance: 130, last_daily_claim_at: null }),
			claimDaily: async () => ({ success: true, balance: 140, lastClaimDate: new Date().toISOString(), message: 'Daily credits claimed successfully' })
		},
		notifications: {
			list: async () => [{ id: 9, title: 'Hello', message: 'World', link: '/creations/31885', type: 'comment', target: { creation_id: 31885 }, created_at: '2025-01-02T00:00:00.000Z', acknowledged_at: null }],
			acknowledge: async () => 1,
			acknowledgeAll: async () => 1
		}
	}));
	const server = app.listen(0);
	try { await run(`http://127.0.0.1:${server.address().port}`); }
	finally { await new Promise((resolve) => server.close(resolve)); }
}

test('mock sidebar APIs retain www-shaped thread and server payloads', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test' };
		const threads = await fetch(`${origin}/api/chat/threads`, { headers }).then((res) => res.json());
		const servers = await fetch(`${origin}/api/servers`, { headers }).then((res) => res.json());
		assert.equal(threads.viewer_id, 42);
		assert.ok(threads.threads.some((row) => row.type === 'dm' && row.other_user?.user_name));
		assert.ok(threads.threads.some((row) => row.type === 'channel' && Number.isFinite(row.unread_count)));
		assert.ok(Array.isArray(servers.servers) && servers.servers[0].name);
	});
});

test('credits API exposes www-compatible balance and daily claim contract', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
		const credits = await fetch(`${origin}/api/credits`, { headers }).then((res) => res.json());
		const claimed = await fetch(`${origin}/api/credits/claim`, { method: 'POST', headers, body: '{}' }).then((res) => res.json());
		assert.equal(credits.balance, 130);
		assert.equal(credits.canClaim, true);
		assert.equal(claimed.balance, 140);
		assert.equal(claimed.success, true);
	});
});

test('app data routes require an authenticated viewer', async () => {
	await withApp(async (origin) => {
		const response = await fetch(`${origin}/api/chat/threads`);
		assert.equal(response.status, 401);
	});
});

test('creation detail profile APIs return the current viewer and creator profile shapes', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test' };
		const viewer = await fetch(`${origin}/api/profile`, { headers }).then((res) => res.json());
		const creator = await fetch(`${origin}/api/users/42/profile`, { headers }).then((res) => res.json());
		assert.equal(viewer.id, 42);
		assert.equal(viewer.profile.user_name, 'creator');
		assert.equal(viewer.enableNsfw, true);
		assert.equal(viewer.meta.apiKeyHash, undefined);
		assert.equal(viewer.hasApiKey, true);
		assert.equal(creator.user.id, 42);
		assert.equal(creator.profile.display_name, 'Creator');
	});
});

test('notification APIs list and acknowledge current-user notifications', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
		const list = await fetch(`${origin}/api/notifications`, { headers }).then((res) => res.json());
		const acknowledged = await fetch(`${origin}/api/notifications/acknowledge`, { method: 'POST', headers, body: '{"id":9}' }).then((res) => res.json());
		assert.equal(list.notifications[0].creation_id, 31885);
		assert.equal(acknowledged.updated, 1);
	});
});
