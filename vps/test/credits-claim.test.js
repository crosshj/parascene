import assert from 'node:assert/strict';
import test from 'node:test';
import { createCreditsStore } from '../db/credits.js';

function creditsClient(row, { updates = 0 } = {}) {
	const filters = [];
	let remaining = updates;
	function builder(kind) {
		const query = {
			filters: [],
			select() { return query; },
			eq(column, value) { query.filters.push([column, value]); return query; },
			is(column, value) { query.filters.push([column, value]); return query; },
			upsert() { return { error: null }; },
			async maybeSingle() {
				if (kind === 'read') return { data: { ...row }, error: null };
				filters.push(query.filters);
				if (remaining > 0) {
					remaining -= 1;
					return { data: null, error: null };
				}
				row = {
					...row,
					balance: (Number(row.balance) || 0) + 10,
					last_daily_claim_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				};
				return { data: { balance: row.balance, last_daily_claim_at: row.last_daily_claim_at }, error: null };
			},
			async single() { return query.maybeSingle(); }
		};
		return query;
	}
	return {
		filters,
		from() {
			return {
				select() { return builder('read'); },
				update() { return builder('write'); },
				upsert() { return { error: null }; }
			};
		}
	};
}

test('daily claim revises by updated_at and awards a fractional balance', async () => {
	const client = creditsClient({
		user_id: 7,
		balance: 12.3,
		last_daily_claim_at: '2026-10-09T15:30:45.123456+00:00',
		updated_at: '2026-10-09T15:30:45.123456+00:00'
	});
	const result = await createCreditsStore(client).claimDaily(7, 10);
	assert.equal(result.success, true);
	assert.equal(result.balance, 22.3);
	assert.deepEqual(client.filters[0], [
		['user_id', 7],
		['updated_at', '2026-10-09T15:30:45.123456+00:00']
	]);
});

test('a claim that loses the revision retries and then reports an existing claim', async () => {
	const client = creditsClient({
		user_id: 7,
		balance: 12.3,
		last_daily_claim_at: '2026-10-09T15:30:45.123456+00:00',
		updated_at: '2026-10-09T15:30:45.123456+00:00'
	}, { updates: 1 });
	client.from = (() => {
		const original = client.from();
		let reads = 0;
		return () => ({
			select() {
				reads += 1;
				const claimed = reads > 2;
				return {
					eq() { return this; },
					async maybeSingle() {
						return {
							data: {
								user_id: 7,
								balance: claimed ? 22.3 : 12.3,
								last_daily_claim_at: claimed ? new Date().toISOString() : '2026-10-09T15:30:45.123456+00:00',
								updated_at: claimed ? new Date().toISOString() : '2026-10-09T15:30:45.123456+00:00'
							},
							error: null
						};
					}
				};
			},
			update() { return original.update(); }
		});
	})();
	const result = await createCreditsStore(client).claimDaily(7, 10);
	assert.equal(result.success, false);
	assert.equal(result.message, 'Daily credits already claimed today');
});
