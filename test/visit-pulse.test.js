import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitPulseMiddleware } from '../server/routes/middleware/visitPulse.js';
import { msUntilNextVisitPulseFlush, recoverableUsEastDayKeys, runVisitPulseFlush } from '../server/services/feed/visitPulseFlush.js';

function tick() {
	return new Promise((resolve) => setImmediate(resolve));
}

test('visit pulse records authed and anonymous visitors and skips static and polls', async () => {
	const seen = [];
	let nowMs = 1_000_000;
	const middleware = createVisitPulseMiddleware({
		recordPulse: async (key, at, day) => { seen.push({ key, at, day }); },
		dayKeyFor: () => '2026-11-18',
		now: () => nowMs
	});
	const next = () => {};
	middleware({ method: 'GET', path: '/api/feed', auth: { userId: 9 }, cookies: {} }, {}, next);
	middleware({ method: 'GET', path: '/app.js', auth: { userId: 9 } }, {}, next);
	middleware({ method: 'GET', path: '/api/notifications/unread-count', auth: { userId: 9 } }, {}, next);
	middleware({ method: 'GET', path: '/', clientId: 'cid-1' }, {}, next);
	await tick();
	assert.deepEqual(seen, [
		{ key: 'u:9', at: nowMs, day: '2026-11-18' },
		{ key: 'v:cid-1', at: nowMs, day: '2026-11-18' }
	]);
	middleware({ method: 'GET', path: '/api/creations/1', auth: { userId: 9 } }, {}, next);
	await tick();
	assert.equal(seen.length, 2);
	nowMs += 60_000;
	middleware({ method: 'GET', path: '/api/creations/1', auth: { userId: 9 } }, {}, next);
	await tick();
	assert.equal(seen.length, 3);
	assert.equal(seen[2].key, 'u:9');
});

test('flush keeps stored visits when Redis visits are empty and still writes feed impressions', async () => {
	let saved = null;
	const queries = {
		selectVisitPulseDay: { get: async () => ({ day: '2026-11-17', unique_visitors: 4, authed_visitors: 1, anon_visitors: 3, total_hits: 8, total_active_blocks: 2, details: { visitors: [{ visitor_key: 'u:1' }] } }) },
		upsertVisitPulseDay: { run: async (row) => { saved = row; } }
	};
	const result = await runVisitPulseFlush({
		args: { day: '2026-11-17' },
		queries,
		loadVisit: async () => ({ day: '2026-11-17', unique_visitors: 0, authed_visitors: 0, anon_visitors: 0, total_hits: 0, total_active_blocks: 0, details: { visitors: [] } }),
		loadFeed: async () => ({ unique_impressors: 6, total_impressions: 20, dwell_impressions: 15, click_impressions: 5 }),
		loadLanding: async () => null
	});
	assert.equal(result.ok, true);
	assert.equal(result.preserved_visits, true);
	assert.equal(saved.unique_visitors, 4);
	assert.equal(saved.details.feed_impressions.unique_impressors, 6);
	assert.deepEqual(saved.details.visitors, [{ visitor_key: 'u:1' }]);
});

test('flush skips a day whose Redis window has expired and whose feed keys are gone', async () => {
	let writes = 0;
	const result = await runVisitPulseFlush({
		args: { day: '2026-11-10' },
		queries: {
			selectVisitPulseDay: { get: async () => ({ unique_visitors: 12, details: {} }) },
			upsertVisitPulseDay: { run: async () => { writes += 1; } }
		},
		loadVisit: async () => ({ unique_visitors: 0, details: {} }),
		loadFeed: async () => ({ unique_impressors: 0 }),
		loadLanding: async () => null
	});
	assert.equal(result.skipped, true);
	assert.equal(writes, 0);
});

test('boot catch-up covers the three US East days still inside the Redis TTL', () => {
	assert.deepEqual(
		recoverableUsEastDayKeys(3, new Date(Date.UTC(2026, 10, 18, 15, 0, 0))),
		['2026-11-17', '2026-11-16', '2026-11-15']
	);
});

test('nightly flush is 05:10 UTC', () => {
	const before = msUntilNextVisitPulseFlush(new Date(Date.UTC(2026, 10, 18, 5, 9, 0)));
	const after = msUntilNextVisitPulseFlush(new Date(Date.UTC(2026, 10, 18, 5, 11, 0)));
	assert.equal(before, 60_000);
	assert.equal(after, 24 * 60 * 60 * 1000 - 60_000);
});
