import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDataRoutes } from '../routes/appData.js';
import { performCreditTip } from '../services/credits/tip.js';

const NOW = () => new Date('2026-04-01T00:00:00.000Z').getTime();

function sender(overrides = {}) {
	return {
		id: 42,
		created_at: '2020-01-01T00:00:00.000Z',
		meta: { plan: 'free' },
		...overrides
	};
}

function tip(overrides = {}) {
	const calls = { transfer: [], record: [], notify: [] };
	const result = performCreditTip({
		sender: sender(),
		toUserId: 7,
		amount: 1.25,
		createdImageId: 31885,
		message: '  thanks  ',
		findUser: async (id) => ({ id }),
		findCreation: async (id) => ({ id }),
		policyValue: async () => '60',
		transfer: async (...args) => { calls.transfer.push(args); return { from_balance: 8.8, to_balance: 1.2 }; },
		recordTip: async (...args) => { calls.record.push(args); },
		notify: async (...args) => { calls.notify.push(args); },
		now: NOW,
		...overrides
	});
	return { calls, result };
}

test('a creation tip transfers credits, logs the tip, and notifies the recipient', async () => {
	const { calls, result } = tip();
	const response = await result;
	assert.deepEqual(response, { status: 200, body: { success: true, fromBalance: 8.8, toBalance: 1.2 } });
	assert.deepEqual(calls.transfer, [[42, 7, 1.3]]);
	assert.deepEqual(calls.record, [[42, 7, 31885, 1.3, 'thanks', 'creation', null]]);
	assert.equal(calls.notify[0][0], 7);
	assert.equal(calls.notify[0][4], '/creations/31885');
	assert.equal(calls.notify[0][6], 'tip');
	assert.deepEqual(calls.notify[0][7], { creation_id: 31885 });
	assert.deepEqual(calls.notify[0][8], { amount: 1.3, tip_note: 'thanks' });
});

test('tip validation matches the www credit tip contract', async () => {
	assert.equal((await tip({ toUserId: 0 }).result).body.error, 'Invalid recipient user id');
	assert.equal((await tip({ amount: 0 }).result).body.error, 'Invalid amount');
	assert.equal((await tip({ toUserId: 42 }).result).body.error, 'Cannot tip yourself');
	assert.equal((await tip({ message: 'x'.repeat(501) }).result).body.error, 'Message is too long');
	assert.equal((await tip({ createdImageId: 'nope' }).result).body.error, 'Invalid creation id');
	assert.equal((await tip({ findCreation: async () => null }).result).status, 404);
	assert.equal((await tip({ findUser: async () => null }).result).body.error, 'Recipient not found');
	const insufficient = await tip({ transfer: async () => { throw new Error('insufficient credits'); } }).result;
	assert.deepEqual(insufficient, { status: 400, body: { error: 'Insufficient credits' } });
});

test('free accounts wait out the tip policy and upgraded accounts do not', async () => {
	const blocked = await tip({ sender: sender({ created_at: '2026-03-20T00:00:00.000Z' }) }).result;
	assert.equal(blocked.status, 403);
	assert.match(blocked.body.errorHtml, /tip-error-pricing-link/);
	const founder = await tip({ sender: sender({ created_at: '2026-03-20T00:00:00.000Z', meta: { plan: 'founder' } }) }).result;
	assert.equal(founder.status, 200);
	const subscribed = await tip({
		sender: sender({ created_at: '2026-03-20T00:00:00.000Z', meta: { plan: 'free', stripeSubscriptionId: 'sub_123' } })
	}).result;
	assert.equal(subscribed.status, 200);
});

test('a tip without a creation is recorded as an admin tip and still succeeds if logging fails', async () => {
	const logged = tip({ createdImageId: null, message: '' });
	const loggedResponse = await logged.result;
	assert.equal(loggedResponse.status, 200);
	assert.equal(logged.calls.record[0][5], 'admin');
	assert.equal(logged.calls.notify[0][4], '/');
	const failed = await tip({
		recordTip: async () => { throw new Error('log failed'); },
		notify: async () => { throw new Error('notify failed'); }
	}).result;
	assert.equal(failed.status, 200);
	assert.equal(failed.body.success, true);
});

test('the tip route returns the performer result for the signed-in sender', async () => {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer test') req.auth = { userId: 42 }; next(); });
	const seen = [];
	app.use(createAppDataRoutes({
		users: { byId: async (id) => ({ id: Number(id), role: 'consumer', meta: { plan: 'founder' }, created_at: '2020-01-01T00:00:00.000Z' }) },
		credits: {
			get: async () => ({ balance: 0, last_daily_claim_at: null }),
			claimDaily: async () => ({ success: true, balance: 0 }),
			tip: async (input) => { seen.push(input); return { status: 200, body: { success: true, fromBalance: 4, toBalance: 6 } }; }
		}
	}));
	const server = app.listen(0);
	try {
		const response = await fetch(`http://127.0.0.1:${server.address().port}/api/credits/tip`, {
			method: 'POST',
			headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
			body: JSON.stringify({ toUserId: 7, amount: 2, createdImageId: 11, message: 'hi' })
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { success: true, fromBalance: 4, toBalance: 6 });
		assert.equal(seen[0].sender.id, 42);
		assert.equal(seen[0].toUserId, 7);
		assert.equal(seen[0].createdImageId, 11);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
