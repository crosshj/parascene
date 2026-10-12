import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryRegistry } from '../client/core/queryRegistry.js';
import { claimedOnUtcDay, creditsControlLabel, dailyClaimAvailable, settleCredits } from '../client/providers/credits/dailyClaim.js';
import { createCreditsProvider } from '../client/providers/credits/index.js';

const now = new Date('2026-10-07T16:00:00.000Z');
const today = '2026-10-07T01:00:00.000Z';
const yesterday = '2026-10-06T23:00:00.000Z';

test('desktop and mobile read one credits view from the provider', () => {
	const provider = createCreditsProvider({ viewerId: 7, registry: createQueryRegistry() });
	try {
		provider.query.setData({ viewerId: 7, balance: 12, canClaim: true, lastClaimDate: null });
		assert.deepEqual(provider.viewState(), {
			known: true,
			balanceText: '12',
			claimAvailable: true,
			label: 'Credits, 12. Daily credits ready to claim',
		});
		provider.query.setData({ viewerId: 7, balance: 22, canClaim: true, lastClaimDate: new Date().toISOString() });
		const claimed = provider.viewState();
		assert.equal(claimed.claimAvailable, false);
		assert.equal(claimed.balanceText, '22');
		assert.equal(claimed.label, 'Credits, 22');
	} finally {
		provider.destroy();
	}
});

test('the credits indicator is shown only when a claim is available today', () => {
	assert.equal(dailyClaimAvailable(undefined, now), false);
	assert.equal(dailyClaimAvailable({ canClaim: false, lastClaimDate: null }, now), false);
	assert.equal(dailyClaimAvailable({ canClaim: true, lastClaimDate: null }, now), true);
	assert.equal(dailyClaimAvailable({ canClaim: true, lastClaimDate: yesterday }, now), true);
	assert.equal(dailyClaimAvailable({ canClaim: true, lastClaimDate: today }, now), false);
	assert.equal(claimedOnUtcDay(today, now), true);
	assert.equal(creditsControlLabel('', false), 'Credits');
	assert.equal(creditsControlLabel('12', true), 'Credits, 12. Daily credits ready to claim');
	assert.equal(creditsControlLabel('12', false), 'Credits, 12');
});

test('a later credits response cannot undo a claim from today', () => {
	const claimed = settleCredits({ balance: 20, canClaim: false, lastClaimDate: today, viewerId: 7 }, { balance: 10, canClaim: true, lastClaimDate: null }, now);
	const stale = settleCredits({ balance: 10, canClaim: true, lastClaimDate: null, viewerId: 7 }, claimed, now);
	assert.equal(stale.canClaim, false);
	assert.equal(stale.lastClaimDate, today);
	assert.equal(stale.balance, 20);
	assert.equal(dailyClaimAvailable(stale, now), false);
	const nextDay = settleCredits({ balance: 20, canClaim: true, lastClaimDate: today, viewerId: 7 }, claimed, new Date('2026-10-08T00:05:00.000Z'));
	assert.equal(dailyClaimAvailable(nextDay, new Date('2026-10-08T00:05:00.000Z')), true);
});

test('a credits refresh in flight cannot restore the indicator after a claim', async () => {
	let release;
	const original = globalThis.fetch;
	globalThis.fetch = (path) => {
		if (String(path).includes('/claim')) {
			return Promise.resolve({ ok: true, json: async () => ({ success: true, balance: 20, lastClaimDate: new Date().toISOString() }) });
		}
		return new Promise((resolve) => {
			release = () => resolve({ ok: true, json: async () => ({ viewer_id: 7, balance: 10, canClaim: true, lastClaimDate: null }) });
		});
	};
	const provider = createCreditsProvider({ viewerId: 7, registry: createQueryRegistry() });
	try {
		const refresh = provider.query.refresh({ force: true });
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(typeof release, 'function');
		const claimedAt = new Date().toISOString();
		provider.query.update((current) => settleCredits({ ...current, balance: 20, lastClaimDate: claimedAt, canClaim: false, viewerId: 7 }, current));
		release();
		await refresh;
		assert.equal(provider.query.data.canClaim, false);
		assert.equal(provider.query.data.balance, 20);
		assert.equal(dailyClaimAvailable(provider.query.data), false);
	} finally {
		provider.destroy();
		globalThis.fetch = original;
	}
});
