import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDataRoutes } from '../routes/appData.js';

async function withApp(run) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer test') req.auth = { userId: 42 }; next(); });
	app.use(createAppDataRoutes({
		users: { byId: async () => ({ role: 'consumer' }) },
		credits: {
			get: async () => ({ balance: 130, last_daily_claim_at: null }),
			claimDaily: async () => ({ success: true, balance: 140, lastClaimDate: new Date().toISOString(), message: 'Daily credits claimed successfully' })
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
