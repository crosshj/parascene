import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createFinanceRoutes, financeDevEnabled } from '../server/routes/finance.js';
import { createFinanceLedger } from '../server/services/finance/ledger.js';

async function withApp(router, run, { remoteAddress } = {}) {
	const app = express();
	app.set('trust proxy', true);
	if (remoteAddress) {
		app.use((req, res, next) => {
			Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true });
			next();
		});
	}
	app.use(router);
	app.use((req, res) => res.status(418).send('app shell fallback'));
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	try {
		await run(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

function memorySupabase(users = []) {
	const tables = {
		prsn_users: users.map((row) => ({ ...row })),
		prsn_user_profiles: [],
		prsn_chat_threads: [],
		prsn_chat_members: [],
		prsn_chat_messages: []
	};
	let seq = 1;
	function from(name) {
		const rows = tables[name];
		const query = {
			filters: [],
			op: 'select',
			payload: null,
			select() { return this; },
			eq(key, value) { this.filters.push({ key, value, op: 'eq' }); return this; },
			ilike(key, value) { this.filters.push({ key, value, op: 'ilike' }); return this; },
			order() { return this; },
			limit() { return this; },
			insert(payload) { this.op = 'insert'; this.payload = payload; return this; },
			update(payload) { this.op = 'update'; this.payload = payload; return this; },
			maybeSingle() { return Promise.resolve(this.exec(true)); },
			single() { return Promise.resolve(this.exec(true)); },
			then(resolve, reject) { return Promise.resolve(this.exec(this.op !== 'select')).then(resolve, reject); },
			exec(one) {
				const matches = (row) => this.filters.every((filter) => {
					const left = row[filter.key];
					if (filter.op === 'ilike') return String(left).toLowerCase() === String(filter.value).toLowerCase();
					return left === filter.value;
				});
				if (this.op === 'insert') {
					const row = { id: seq++, created_at: new Date().toISOString(), ...this.payload };
					rows.push(row);
					return { data: row, error: null };
				}
				const found = rows.filter(matches);
				if (this.op === 'update') {
					if (!found[0]) return { data: null, error: { message: 'not found' } };
					Object.assign(found[0], this.payload);
					return { data: found[0], error: null };
				}
				return { data: one ? (found[0] || null) : found, error: null };
			}
		};
		return query;
	}
	return { from, tables };
}

test('finance stays unmounted outside local dev', () => {
	assert.equal(financeDevEnabled({ NODE_ENV: 'production' }), false);
	assert.equal(financeDevEnabled({ NODE_ENV: 'development', VERCEL: '1' }), false);
	assert.equal(financeDevEnabled({ NODE_ENV: 'production', LOCAL_FINANCE_ENABLED: '0' }), false);
	assert.equal(financeDevEnabled({ NODE_ENV: 'production', LOCAL_FINANCE_ENABLED: '1' }), true);
	assert.equal(financeDevEnabled({ NODE_ENV: 'production', LOCAL_FINANCE_ENABLED: '1', VERCEL: '1' }), false);
	assert.equal(createFinanceRoutes({ enabled: false }), null);
});

test('local finance rejects remote clients even with forwarded localhost headers', async () => {
	const enabled = financeDevEnabled({ NODE_ENV: 'production', LOCAL_FINANCE_ENABLED: '1' });
	await withApp(createFinanceRoutes({ enabled, ledger: { async read() { return {}; }, async write() { return {}; } } }), async (origin) => {
		for (const file of ['', 'index.html', 'api/ledger', 'server.js']) {
			const response = await fetch(`${origin}/finance/${file}`, {
				headers: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost' }
			});
			assert.equal(response.status, 404, file);
			assert.deepEqual(await response.json(), { error: 'Finance resource not found' });
		}
	}, { remoteAddress: '203.0.113.5' });
});

test('dev server serves the finance page on /finance/', async () => {
	const router = createFinanceRoutes({ enabled: true, ledger: { async read() { return { kind: 'finance_ledger_v1' }; }, async write(body) { return body; } } });
	assert.ok(router);
	await withApp(router, async (origin) => {
		const redirect = await fetch(`${origin}/finance?tab=ledger`, { redirect: 'manual' });
		assert.equal(redirect.status, 301);
		assert.equal(redirect.headers.get('location'), '/finance/?tab=ledger');

		const page = await fetch(`${origin}/finance/`);
		const html = await page.text();
		assert.equal(page.status, 200);
		assert.match(page.headers.get('content-type') || '', /html/);
		assert.match(html, /Parascene finances/);
		assert.match(html, /fetch\('api\/ledger'/);

		const script = await fetch(`${origin}/finance/server.js`);
		assert.equal(script.status, 404);
		assert.deepEqual(await script.json(), { error: 'Finance resource not found' });
	});
});

test('finance ledger reads and writes through the notes-to-self message', async (t) => {
	const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parascene-finance-'));
	t.after(() => fs.rm(backupDir, { recursive: true, force: true }));
	const client = memorySupabase([{ id: 7, email: 'owner@example.com' }]);
	const ledger = createFinanceLedger({
		client,
		backupDir,
		env: { FINANCE_USER_ID: '7' }
	});
	await withApp(createFinanceRoutes({ enabled: true, ledger }), async (origin) => {
		const first = await fetch(`${origin}/finance/api/ledger`);
		assert.equal(first.status, 200);
		assert.equal(first.headers.get('cache-control'), 'no-store');
		const body = await first.json();
		assert.equal(body.kind, 'finance_ledger_v1');
		assert.equal(body.storage.userEmail, 'owner@example.com');
		assert.equal(client.tables.prsn_chat_messages.length, 1);

		body.transactions.push({ id: 'extra', type: 'expense', amount: 3, vendor: 'Test', account: 'business-card', status: 'actual' });
		const saved = await fetch(`${origin}/finance/api/ledger`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		assert.equal(saved.status, 200);
		const again = await (await fetch(`${origin}/finance/api/ledger`)).json();
		assert.equal(again.transactions.some((row) => row.vendor === 'Test'), true);
		const backups = await fs.readdir(backupDir);
		assert.equal(backups.length, 1);
	});
});

test('finance ledger reports a missing local user without leaving the page mount', async () => {
	const ledger = createFinanceLedger({
		client: memorySupabase(),
		backupDir: path.join(os.tmpdir(), 'parascene-finance-unused'),
		env: {}
	});
	await withApp(createFinanceRoutes({ enabled: true, ledger }), async (origin) => {
		const response = await fetch(`${origin}/finance/api/ledger`);
		assert.equal(response.status, 500);
		assert.match((await response.json()).error, /id 219/);
		const page = await fetch(`${origin}/finance/`);
		assert.equal(page.status, 200);
	});
});
