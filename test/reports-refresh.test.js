import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createReportsRoutes } from '../server/routes/reports.js';
import { usEastDayKey, shiftDayKey } from '../scripts/analytics/overview/metrics.js';

async function listen(server) {
	server.listen(0, '127.0.0.1');
	await new Promise((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	return `http://127.0.0.1:${server.address().port}`;
}

async function refresh(origin, out, args = []) {
	const child = spawn(process.execPath, ['scripts/analytics/overview-refresh.js', '--no-live', '--out', out, ...args], {
		env: { ...process.env, SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (data) => { output += data; });
	child.stderr.on('data', (data) => { output += data; });
	const code = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', resolve);
	});
	assert.equal(code, 0, output);
	return output;
}

test('native refresh generates a snapshot for the HTML report, then refreshes incrementally', async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parascene-report-refresh-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const out = path.join(root, '.output', 'overview', 'store.json');
	const day = shiftDayKey(usEastDayKey(), -1);
	const earlier = shiftDayKey(day, -1);
	const timestamp = `${day}T12:00:00Z`;
	const users = [
		{ id: 1, email: 'ada@example.test', role: 'consumer', created_at: timestamp, meta: { plan: 'founder' } },
		{ id: 2, email: 'suspended@example.test', role: 'consumer', created_at: timestamp, meta: { suspended: true } },
		{ id: 3, email: 'admin@example.test', role: 'admin', created_at: timestamp, meta: {} },
		{ id: 4, email: 'grace@example.test', role: 'consumer', created_at: timestamp, meta: {} },
		{ id: 5, email: 'linus@example.test', role: 'consumer', created_at: timestamp, meta: {} }
	];
	const profiles = [
		{ user_id: 1, user_name: 'ada', display_name: ' Ada Lovelace ' },
		{ user_id: 3, user_name: 'admin', display_name: null },
		{ user_id: 4, user_name: 'grace', display_name: null }
	];
	const requests = [];
	const source = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		requests.push(url);
		const table = url.pathname.split('/').at(-1);
		let rows = [];
		if (table === 'prsn_users') rows = users;
		if (table === 'prsn_user_profiles') rows = profiles;
		if (table === 'prsn_created_images') rows = [
			{ user_id: 1, created_at: timestamp, published_at: timestamp, meta: { mutate_of_id: 42 } },
			{ user_id: 2, created_at: timestamp, meta: {} },
			{ user_id: 3, created_at: timestamp, meta: {} }
		];
		if (table === 'prsn_visit_pulse_days') rows = [{
			day, total_hits: 4, unique_visitors: 2, authed_visitors: 2, anon_visitors: 0,
			details: { visitors: [{ user_id: 1, hits: 2 }, { user_id: 3, hits: 2 }] }
		}];
		for (const key of ['id', 'user_id']) {
			const filter = url.searchParams.get(key);
			if (filter?.startsWith('in.(')) {
				const ids = filter.slice(4, -1).split(',').map(Number);
				rows = rows.filter((row) => ids.includes(row[key]));
			}
		}
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(rows));
	});
	const sourceOrigin = await listen(source);
	t.after(() => new Promise((resolve) => source.close(resolve)));
	assert.match(await refresh(sourceOrigin, out, ['--full']), /mode: full rebuild/);
	const store = JSON.parse(await fs.readFile(out, 'utf8'));
	assert.equal(store.meta.schemaVersion, 1);
	assert.deepEqual(store.users.map(({ id, label, paid }) => ({ id, label, paid })), [
		{ id: 1, label: 'Ada Lovelace', paid: true },
		{ id: 4, label: '@grace', paid: false },
		{ id: 5, label: '@linus', paid: false }
	]);
	assert.deepEqual(store.userDay, [{ u: 1, d: day, c: { creation: 1, mutations: 1, publish: 1 } }]);
	assert.deepEqual(store.userHandles, [{ id: 3, userName: 'admin' }]);
	assert.equal(store.visitDaily[0].hits, 4);

	// Historical rows survive an incremental refresh; the boundary day is replaced.
	store.userDay.unshift({ u: 1, d: earlier, c: { like: 7 } });
	await fs.writeFile(out, JSON.stringify(store));
	assert.match(await refresh(sourceOrigin, out), /mode: incremental/);
	const refreshed = JSON.parse(await fs.readFile(out, 'utf8'));
	assert.deepEqual(refreshed.userDay, [{ u: 1, d: earlier, c: { like: 7 } }, ...store.userDay.slice(1)]);
	assert.ok(requests.some((url) => url.searchParams.get('day') === `gte.${day}`));

	const app = express();
	app.use(createReportsRoutes({ root, enabled: true }));
	const api = http.createServer(app);
	const apiOrigin = await listen(api);
	t.after(() => new Promise((resolve) => api.close(resolve)));
	const response = await fetch(`${apiOrigin}/reports/store.json`);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), refreshed);
});
