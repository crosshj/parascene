import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createCreationsRoutes } from '../server/routes/creations.js';

async function withApp({ creations, users, appendChallengeEligibility }, run) {
	const app = express();
	app.use((req, _res, next) => {
		if (req.headers.authorization === 'Bearer test') req.auth = { userId: 7 };
		next();
	});
	app.use(createCreationsRoutes({ creations, users, appendChallengeEligibility }));
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

const ownerCreation = {
	id: 42,
	user_id: 7,
	filename: '7_42_1_a.png',
	file_path: '7/7_42_1_a.png',
	status: 'completed',
	published: false,
	width: 64,
	height: 64,
	title: 'Entry',
	description: null,
	meta: {},
	created_at: '2026-01-01T00:00:00.000Z'
};

test('GET /api/creations/:id appends challenge_submit eligibility for the owner', async () => {
	let seen = null;
	await withApp(
		{
			creations: {
				byIdForViewer: async (viewerId, id) =>
					Number(viewerId) === 7 && Number(id) === 42 ? { ...ownerCreation } : null,
				safeKey: (key) => String(key || '')
			},
			users: {
				byId: async (id) => ({ id: Number(id), role: 'consumer', email: 'a@b.c', meta: {} }),
				profileByUserId: async (id) => ({
					user_id: Number(id),
					user_name: 'maker',
					display_name: 'Maker',
					avatar_url: null
				})
			},
			appendChallengeEligibility: async (req, viewer, row, meta, response) => {
				seen = { viewerId: viewer.id, rowId: row.id, meta, qs: req.query?.challenge_submit_thread };
				response.challenge_submit = {
					eligible: true,
					reason: null,
					thread_id: 99,
					challenge_id: 'ch1',
					challenges: [{ challenge_id: 'ch1', title: 'Weekly', details: '' }],
					challenge: { challenge_id: 'ch1', title: 'Weekly', details: '' }
				};
			}
		},
		async (origin) => {
			const res = await fetch(`${origin}/api/creations/42?challenge_submit_thread=99`, {
				headers: { Authorization: 'Bearer test' }
			});
			assert.equal(res.status, 200);
			const body = await res.json();
			assert.equal(seen?.viewerId, 7);
			assert.equal(seen?.rowId, 42);
			assert.equal(seen?.qs, '99');
			assert.equal(body.challenge_submit?.eligible, true);
			assert.equal(body.challenge_submit?.challenge_id, 'ch1');
			assert.equal(body.challenge_organizer?.active, false);
		}
	);
});

test('GET /api/creations/:id still works when eligibility hook is omitted', async () => {
	await withApp(
		{
			creations: {
				byIdForViewer: async () => ({ ...ownerCreation }),
				safeKey: (key) => String(key || '')
			},
			users: {
				byId: async (id) => ({ id: Number(id), role: 'consumer', email: 'a@b.c', meta: {} }),
				profileByUserId: async (id) => ({
					user_id: Number(id),
					user_name: 'maker',
					display_name: 'Maker',
					avatar_url: null
				})
			}
		},
		async (origin) => {
			const res = await fetch(`${origin}/api/creations/42`, {
				headers: { Authorization: 'Bearer test' }
			});
			assert.equal(res.status, 200);
			const body = await res.json();
			assert.equal(body.id, 42);
			assert.equal(body.challenge_submit, undefined);
		}
	);
});
