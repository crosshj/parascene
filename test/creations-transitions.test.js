import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreationsRoutes } from '../server/routes/creations.js';

async function postTransitions(creations, { auth = { userId: 1 }, body } = {}) {
	const router = createCreationsRoutes({ creations, users: { byId: async () => null } });
	const route = router.stack.find((layer) => layer.route?.path === '/api/creations/transitions')?.route;
	const handler = route.stack[0].handle;
	let status = 200;
	let data;
	let ended = false;
	const res = {
		status(value) { status = value; return this; },
		json(value) { data = value; return this; },
		end() { ended = true; return this; },
		headersSent: false
	};
	await handler({ auth, body }, res, () => {});
	return { status, data, ended };
}

test('related browsing records a click-next transition for a signed-in viewer', async () => {
	const calls = [];
	const out = await postTransitions(
		{ recordTransition: async (fromId, toId) => { calls.push([fromId, toId]); } },
		{ body: { from_created_image_id: 10, to_created_image_id: '12' } }
	);
	assert.equal(out.status, 204);
	assert.equal(out.ended, true);
	assert.deepEqual(calls, [[10, 12]]);
});

test('related browsing rejects anonymous and self transitions', async () => {
	const out = await postTransitions(
		{ recordTransition: async () => { throw new Error('should not record'); } },
		{ auth: null, body: { from_created_image_id: 1, to_created_image_id: 2 } }
	);
	assert.equal(out.status, 401);
	const same = await postTransitions(
		{ recordTransition: async () => { throw new Error('should not record'); } },
		{ body: { from_created_image_id: 4, to_created_image_id: 4 } }
	);
	assert.equal(same.status, 400);
});
