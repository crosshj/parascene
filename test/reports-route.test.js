import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createReportsRoutes, reportsDevEnabled } from '../server/routes/reports.js';

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

test('reports stay unmounted outside local dev', () => {
	assert.equal(reportsDevEnabled({ NODE_ENV: 'production' }), false);
	assert.equal(reportsDevEnabled({ NODE_ENV: 'development', VERCEL: '1' }), false);
	assert.equal(reportsDevEnabled({ NODE_ENV: 'production', LOCAL_REPORTS_ENABLED: '0' }), false);
	assert.equal(reportsDevEnabled({ NODE_ENV: 'production', LOCAL_REPORTS_ENABLED: '1' }), true);
	assert.equal(reportsDevEnabled({ NODE_ENV: 'production', LOCAL_REPORTS_ENABLED: '1', VERCEL: '1' }), false);
	assert.equal(createReportsRoutes({ enabled: false }), null);
});

test('local production-mode reports reject remote clients even with forwarded localhost headers', async () => {
	const enabled = reportsDevEnabled({ NODE_ENV: 'production', LOCAL_REPORTS_ENABLED: '1' });
	await withApp(createReportsRoutes({ enabled }), async (origin) => {
		for (const file of ['', 'app.js', 'report.css', 'store.json']) {
			const response = await fetch(`${origin}/reports/${file}`, {
				headers: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost' }
			});
			assert.equal(response.status, 404);
			assert.deepEqual(await response.json(), { error: 'Report resource not found' });
		}
	}, { remoteAddress: '203.0.113.5' });
});

test('dev server serves the overview report on /reports/', async () => {
	const router = createReportsRoutes({ enabled: true });
	assert.ok(router);
	await withApp(router, async (origin) => {
		const page = await fetch(`${origin}/reports/`);
		const html = await page.text();
		assert.equal(page.status, 200);
		assert.match(page.headers.get('content-type') || '', /html/);
		assert.match(html, /Parascene — Reports/);
		assert.match(html, /src="\.\/app\.js"/);

		const css = await fetch(`${origin}/reports/report.css`);
		assert.equal(css.status, 200);
		assert.match(await css.text(), /--report-/);

		const appJs = await fetch(`${origin}/reports/app.js`);
		assert.equal(appJs.status, 200);
		assert.match(await appJs.text(), /from "\.\/metrics\.js"/);
	});
});

test('report URL redirects to a directory and serves its relative modules and CSS', async () => {
	await withApp(createReportsRoutes({ enabled: true }), async (origin) => {
		const redirect = await fetch(`${origin}/reports?tab=today`, { redirect: 'manual' });
		assert.equal(redirect.status, 301);
		assert.equal(redirect.headers.get('location'), '/reports/?tab=today');
		for (const [file, type, pattern] of [
			['', /html/, /Parascene — Reports/],
			['app.js', /javascript/, /from "\.\/metrics\.js"/],
			['metrics.js', /javascript/, /export const SCHEMA_VERSION/],
			['report.css', /css/, /--report-/]
		]) {
			const response = await fetch(`${origin}/reports/${file}`, { redirect: 'manual' });
			assert.equal(response.status, 200, file);
			assert.match(response.headers.get('content-type'), type);
			assert.match(await response.text(), pattern);
		}
	});
});

test('report serves the current snapshot and keeps missing resources out of the SPA', async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parascene-reports-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const storePath = path.join(root, '.output', 'overview', 'store.json');
	await fs.mkdir(path.dirname(storePath), { recursive: true });
	await withApp(createReportsRoutes({ root, enabled: true }), async (origin) => {
		const missing = await fetch(`${origin}/reports/store.json`);
		assert.equal(missing.status, 404);
		assert.match((await missing.json()).error, /overview-refresh\.js/);
		const asset = await fetch(`${origin}/reports/missing.js`);
		assert.equal(asset.status, 404);
		assert.deepEqual(await asset.json(), { error: 'Report resource not found' });

		for (const revision of [1, 2]) {
			const snapshot = { meta: { schemaVersion: 1, revision }, users: [], userDay: [] };
			await fs.writeFile(storePath, JSON.stringify(snapshot));
			const response = await fetch(`${origin}/reports/store.json`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.deepEqual(await response.json(), snapshot);
		}
	});
});
