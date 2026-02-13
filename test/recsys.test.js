import { describe, it, expect } from '@jest/globals';
import { createRecommender, _helpers } from './recsys.js';

function seededRng(seed = 42) {
	let s = seed >>> 0;
	return () => {
		// xorshift32
		s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
		return ((s >>> 0) % 1000000) / 1000000;
	};
}

function sampleData(now = '2026-02-13T00:00:00Z') {
	const pool = [
		{ id: 1, familyId: 'F1', creatorId: 'A', provider: 'p1', method: 'm1', createdAt: '2026-02-12T00:00:00Z', isActive: true },
		{ id: 2, familyId: 'F1', creatorId: 'A', provider: 'p1', method: 'm1', createdAt: '2026-02-12T01:00:00Z', isActive: true }, // lineage + creator + server/method
		{ id: 3, familyId: 'F1', creatorId: 'B', provider: 'p2', method: 'm2', createdAt: '2026-02-11T00:00:00Z', isActive: true }, // lineage only
		{ id: 4, familyId: 'F2', creatorId: 'A', provider: 'p1', method: 'm1', createdAt: '2026-02-12T02:00:00Z', isActive: true }, // creator + server/method
		{ id: 5, familyId: 'F3', creatorId: 'C', provider: 'p9', method: 'm9', createdAt: '2026-02-10T00:00:00Z', isActive: true }, // fallback-ish
		{ id: 6, familyId: 'F4', creatorId: 'D', provider: 'p1', method: 'm1', createdAt: '2026-01-01T00:00:00Z', isActive: true }, // old
		{ id: 7, familyId: 'F5', creatorId: 'E', provider: 'p8', method: 'm8', createdAt: '2026-02-12T03:00:00Z', isActive: true }
	];

	const transitions = [
		// from anchor 1 -> 4 has strongest click-next
		{ fromId: 1, toId: 4, count: 5, updatedAt: '2026-02-12T23:00:00Z' },
		{ fromId: 1, toId: 2, count: 2, updatedAt: '2026-02-12T23:00:00Z' },
		{ fromId: 1, toId: 7, count: 1, updatedAt: '2026-02-12T23:00:00Z' },
		{ fromId: 1, toId: 6, count: 10, updatedAt: '2025-12-01T00:00:00Z' } // very old; decays hard
	];

	return { pool, transitions, now };
}

describe('recsys recommender', () => {
	it('ranks with click-next + lineage + creator/server signals', () => {
		const { pool, transitions, now } = sampleData();
		const r = createRecommender({
			now: () => +new Date(now),
			rng: seededRng(1),
			randomFraction: 0,
			batchSize: 5
		});

		const out = r.recommend({
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		expect(out).toHaveLength(5);
		// Current scorer prioritizes id 2 in this fixture due to combined signals.
		expect(out[0].id).toBe(2);
		expect(out[0].reasons).toContain('clickNext');
		expect(out[0].reasons).toContain('lineage');
	});

	it('enforces lineage min slots', () => {
		const { pool, transitions, now } = sampleData();
		const r = createRecommender({
			now: () => +new Date(now),
			rng: seededRng(2),
			randomFraction: 0,
			batchSize: 4,
			lineageMinSlots: 2,
			// make click-next dominate to test promotion logic
			clickNextWeight: 500,
			lineageWeight: 10
		});

		const out = r.recommend({
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		const top4 = out.slice(0, 4);
		const lineageCount = top4.filter(x => [2, 3].includes(x.id)).length; // family F1 excluding anchor(1)
		expect(lineageCount).toBeGreaterThanOrEqual(2);
	});

	it('windowDays filters stale transitions when set', () => {
		const { pool, transitions, now } = sampleData();
		const r = createRecommender({
			now: () => +new Date(now),
			rng: seededRng(3),
			randomFraction: 0,
			batchSize: 6,
			windowDays: 14,
			decayHalfLifeDays: 7
		});

		const out = r.recommend({
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		// old item id 6 should not be boosted via transition due to window cutoff
		const old = out.find(x => x.id === 6);
		expect(old).toBeDefined();
		expect(old.reasons).not.toContain('clickNext');
	});

	it('random slots inject variability but remain score-sorted', () => {
		const { pool, transitions, now } = sampleData();
		const r = createRecommender({
			now: () => +new Date(now),
			rng: seededRng(999),
			randomSlotsPerBatch: 2,
			randomFraction: 0,
			batchSize: 5
		});

		const out = r.recommend({
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		expect(out).toHaveLength(5);
		for (let i = 1; i < out.length; i++) {
			expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
		}
	});

	it('transition decay helper behaves correctly', () => {
		const d0 = _helpers.transitionDecay(0, 7);
		const d7 = _helpers.transitionDecay(7, 7);
		const d14 = _helpers.transitionDecay(14, 7);

		expect(Math.round(d0 * 1000) / 1000).toBe(1);
		expect(Math.round(d7 * 1000) / 1000).toBe(0.5);
		expect(Math.round(d14 * 1000) / 1000).toBe(0.25);
	});
});
