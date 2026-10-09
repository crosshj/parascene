import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createReportsRoutes, reportsDevEnabled } from '../routes/reports.js';

async function withApp(router, run) {
	const app = express();
	app.use(router);
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
	assert.equal(createReportsRoutes({ enabled: false }), null);
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
