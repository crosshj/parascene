import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createGearLabRoutes, isGearLabUser } from '../routes/gearLab.js';

async function withApp(userName, run) {
	const app = express();
	app.use((req, res, next) => {
		const id = Number(req.header('x-user'));
		if (id > 0) req.auth = { userId: id };
		next();
	});
	app.use(createGearLabRoutes({
		users: {
			async profileByUserId() {
				return { user_name: userName };
			}
		}
	}));
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

test('gear lab is oceanman only', () => {
	assert.equal(isGearLabUser('oceanman'), true);
	assert.equal(isGearLabUser('OceanMan'), true);
	assert.equal(isGearLabUser('paperman'), false);
	assert.equal(isGearLabUser(''), false);
});

test('gear lab redirects when signed out', async () => {
	await withApp('oceanman', async (origin) => {
		const page = await fetch(`${origin}/gear-lab`, { redirect: 'manual' });
		assert.equal(page.status, 302);
		assert.match(page.headers.get('location') || '', /\/auth\?returnUrl=/);
	});
});

test('gear lab serves the elimination page to oceanman', async () => {
	await withApp('oceanman', async (origin) => {
		const page = await fetch(`${origin}/gear-lab`, { headers: { 'x-user': '1' } });
		const html = await page.text();
		assert.equal(page.status, 200);
		assert.match(page.headers.get('content-type') || '', /html/);
		for (const label of ['bare', 'clip', 'hero', 'feed', 'grid', 'thumb', 'spin', 'svg', 'js', 'web', 'pulse', 'draw']) {
			assert.match(html, new RegExp(`id="${label}"`));
		}
	});
});

test('gear lab hides the page from other accounts', async () => {
	await withApp('paperman', async (origin) => {
		const page = await fetch(`${origin}/gear-lab`, { headers: { 'x-user': '2' } });
		assert.equal(page.status, 404);
	});
});
