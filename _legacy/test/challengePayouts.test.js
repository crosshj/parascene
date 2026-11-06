import { describe, expect, jest, test } from '@jest/globals';
import {
	HARD_MAX_PER_PAYOUT,
	prepareChallengeResultsPublish,
	pendingPayoutRows,
	executeChallengePayouts,
	mergeResultsPreservingPaid,
	challengePrizeTipNote,
	challengePrizeNotificationCopy
} from '../api_routes/utils/challengePayouts.js';

const mergedConfig = (overrides = {}) => ({
	kind: 'challenge_config',
	challenge_id: 'c1',
	title: 'July Monsters',
	track: 'monthly',
	prizes: {
		main: { first: 700, second: 400, third: 200 },
		top_submitters: { enabled: true, amounts: [100, 50] },
		top_voters: { enabled: true, amounts: [100, 50] }
	},
	...overrides
});

const stats = () => ({
	entries: [
		{ messageId: 1, senderId: 10, creationId: 101, voteValue: 30, voteCount: 6, createdAt: null },
		{ messageId: 2, senderId: 20, creationId: 102, voteValue: 25, voteCount: 5, createdAt: null },
		{ messageId: 3, senderId: 30, creationId: 103, voteValue: 20, voteCount: 4, createdAt: null }
	],
	votesPerUserId: new Map([
		[40, 12],
		[41, 9]
	]),
	submissionsPerSenderId: new Map([
		[10, 2],
		[20, 1],
		[30, 1]
	]),
	globalAverage: 3
});

describe('prepareChallengeResultsPublish', () => {
	test('builds pending payouts from validated winners + participation', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: {
				winners: [
					{ place: 1, message_id: 1 },
					{ place: 2, message_id: 2 },
					{ place: 3, message_id: 3 }
				],
				top_submitters: [{ user_id: 10, amount: 100 }],
				top_voters: [{ user_id: 40, amount: 100 }]
			},
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(true);
		expect(prep.totalAmount).toBe(700 + 400 + 200 + 100 + 100);
		expect(prep.results.winners).toEqual([
			{ place: 1, message_id: 1, created_image_id: 101, user_id: 10, score: 30 },
			{ place: 2, message_id: 2, created_image_id: 102, user_id: 20, score: 25 },
			{ place: 3, message_id: 3, created_image_id: 103, user_id: 30, score: 20 }
		]);
		expect(prep.results.payouts).toHaveLength(5);
		expect(prep.results.payouts.every((p) => p.paid_at === null && p.source === 'tip')).toBe(true);
	});

	test('refuses when results already published (payout idempotency)', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig({ results_published_at: '2026-08-01T00:00:00.000Z' }),
			body: { winners: [{ place: 1, message_id: 1 }] },
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(false);
		expect(prep.error).toMatch(/already published/i);
	});

	test('rejects winners that are not submissions of this challenge', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: { winners: [{ place: 1, message_id: 999 }] },
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(false);
		expect(prep.error).toMatch(/not a submission/i);
	});

	test('rejects duplicate places and duplicate submissions', () => {
		const dupPlace = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: {
				winners: [
					{ place: 1, message_id: 1 },
					{ place: 1, message_id: 2 }
				]
			},
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(dupPlace.ok).toBe(false);
		const dupMsg = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: {
				winners: [
					{ place: 1, message_id: 1 },
					{ place: 2, message_id: 1 }
				]
			},
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(dupMsg.ok).toBe(false);
	});

	test('uses configured place prizes and ignores client amount overrides', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: { winners: [{ place: 1, message_id: 1, amount: HARD_MAX_PER_PAYOUT * 5 }] },
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(true);
		expect(prep.results.payouts[0].amount).toBe(700);
	});

	test('rejects participation rows for users with no activity', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig(),
			body: {
				winners: [{ place: 1, message_id: 1 }],
				top_voters: [{ user_id: 12345, amount: 50 }]
			},
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(false);
		expect(prep.error).toMatch(/no voter activity/i);
	});

	test('zero configured place prize records the win without a payout row', () => {
		const prep = prepareChallengeResultsPublish({
			merged: mergedConfig({
				prizes: {
					main: { first: 0, second: 400, third: 200 },
					top_submitters: { enabled: false, amounts: [0, 0, 0] },
					top_voters: { enabled: false, amounts: [0, 0, 0] }
				}
			}),
			body: { winners: [{ place: 1, message_id: 1, amount: 999 }] },
			stats: stats(),
			confirmedByUserId: 99
		});
		expect(prep.ok).toBe(true);
		expect(prep.results.winners).toHaveLength(1);
		expect(prep.results.payouts).toHaveLength(0);
		expect(prep.totalAmount).toBe(0);
	});
});

describe('pendingPayoutRows', () => {
	test('returns only unpaid positive rows', () => {
		const results = {
			payouts: [
				{ user_id: 1, amount: 100, paid_at: null },
				{ user_id: 2, amount: 100, paid_at: '2026-08-01T00:00:00.000Z' },
				{ user_id: 3, amount: 0, paid_at: null }
			]
		};
		expect(pendingPayoutRows(results).map((r) => r.user_id)).toEqual([1]);
		expect(pendingPayoutRows(null)).toEqual([]);
	});
});

describe('executeChallengePayouts', () => {
	const makeQueries = ({ failForUserId } = {}) => {
		const transfers = [];
		return {
			transfers,
			queries: {
				transferCredits: {
					run: jest.fn(async (from, to, amount) => {
						if (to === failForUserId) throw new Error('insufficient balance');
						transfers.push({ from, to, amount });
					})
				},
				insertTipActivity: { run: jest.fn(async () => {}) },
				insertNotification: { run: jest.fn(async () => {}) }
			}
		};
	};

	test('pays pending rows via tips and stamps paid_at as each succeeds', async () => {
		const { queries, transfers } = makeQueries();
		const results = {
			payouts: [
				{ user_id: 10, amount: 700, reason: '1st place', source: 'tip', paid_at: null },
				{ user_id: 20, amount: 400, reason: '2nd place', source: 'tip', paid_at: null }
			]
		};
		const persisted = [];
		const out = await executeChallengePayouts({
			queries,
			results,
			source: { type: 'tip', fromUserId: 99 },
			challengeId: 'c1',
			challengeTitle: 'July Monsters',
			afterRowPaid: async () => persisted.push(pendingPayoutRows(results).length)
		});
		expect(out.paid).toBe(2);
		expect(out.failed).toEqual([]);
		expect(transfers).toEqual([
			{ from: 99, to: 10, amount: 700 },
			{ from: 99, to: 20, amount: 400 }
		]);
		expect(results.payouts.every((p) => typeof p.paid_at === 'string')).toBe(true);
		// persisted after each row: 1 pending left, then 0
		expect(persisted).toEqual([1, 0]);
		expect(queries.insertTipActivity.run).toHaveBeenCalledTimes(2);
		expect(queries.insertNotification.run).toHaveBeenCalledTimes(2);
		expect(queries.insertTipActivity.run.mock.calls[0][4]).toBe(
			challengePrizeTipNote({ title: 'July Monsters', reason: '1st place', amount: 700 })
		);
		expect(queries.insertNotification.run.mock.calls[0][2]).toBe(
			challengePrizeNotificationCopy({ title: 'July Monsters', reason: '1st place', amount: 700 }).title
		);
		expect(queries.insertNotification.run.mock.calls[0][3]).toBe(
			challengePrizeNotificationCopy({ title: 'July Monsters', reason: '1st place', amount: 700 }).message
		);
	});

	test('failed transfer stays pending and is reported; retry pays only pending rows', async () => {
		const first = makeQueries({ failForUserId: 20 });
		const results = {
			payouts: [
				{ user_id: 10, amount: 700, reason: '1st place', source: 'tip', paid_at: null },
				{ user_id: 20, amount: 400, reason: '2nd place', source: 'tip', paid_at: null }
			]
		};
		const out1 = await executeChallengePayouts({
			queries: first.queries,
			results,
			source: { type: 'tip', fromUserId: 99 },
			challengeId: 'c1'
		});
		expect(out1.paid).toBe(1);
		expect(out1.failed).toHaveLength(1);
		expect(out1.failed[0]).toMatchObject({ user_id: 20, amount: 400 });
		expect(pendingPayoutRows(results).map((r) => r.user_id)).toEqual([20]);

		// Retry (e.g. after topping up): only the pending row transfers.
		const second = makeQueries();
		const out2 = await executeChallengePayouts({
			queries: second.queries,
			results,
			source: { type: 'tip', fromUserId: 99 },
			challengeId: 'c1'
		});
		expect(out2.paid).toBe(1);
		expect(second.transfers).toEqual([{ from: 99, to: 20, amount: 400 }]);
		expect(pendingPayoutRows(results)).toEqual([]);
	});

	test('never tips the funding account its own payout', async () => {
		const { queries, transfers } = makeQueries();
		const results = {
			payouts: [{ user_id: 99, amount: 100, reason: 'top voter', source: 'tip', paid_at: null }]
		};
		const out = await executeChallengePayouts({
			queries,
			results,
			source: { type: 'tip', fromUserId: 99 },
			challengeId: 'c1'
		});
		expect(out.paid).toBe(0);
		expect(out.failed).toHaveLength(1);
		expect(transfers).toEqual([]);
		expect(results.payouts[0].paid_at).toBeNull();
	});

	test('rejects non-tip sources', async () => {
		await expect(
			executeChallengePayouts({
				queries: {},
				results: { payouts: [] },
				source: { type: 'system_mint' },
				challengeId: 'c1'
			})
		).rejects.toThrow(/unsupported payout source/i);
	});

	test('onlyIndex pays a single pending row and leaves others unpaid', async () => {
		const { queries, transfers } = makeQueries();
		const results = {
			payouts: [
				{ user_id: 10, amount: 700, reason: '1st place', source: 'tip', paid_at: null },
				{ user_id: 20, amount: 400, reason: '2nd place', source: 'tip', paid_at: null }
			]
		};
		const out = await executeChallengePayouts({
			queries,
			results,
			source: { type: 'tip', fromUserId: 99 },
			challengeId: 'c1',
			onlyIndex: 1
		});
		expect(out.paid).toBe(1);
		expect(transfers).toEqual([{ from: 99, to: 20, amount: 400 }]);
		expect(results.payouts[0].paid_at).toBeNull();
		expect(typeof results.payouts[1].paid_at).toBe('string');
	});
});

describe('challenge prize copy', () => {
	test('builds congratulatory tip note and notification', () => {
		expect(
			challengePrizeTipNote({ title: 'Monsters VS Aliens', reason: '1st place', amount: 2000 })
		).toBe('Congratulations! You earned 2,000 credits for 1st place in Monsters VS Aliens.');
		expect(
			challengePrizeNotificationCopy({
				title: 'Monsters VS Aliens',
				reason: 'Top 1 submitter',
				amount: 50
			})
		).toEqual({
			title: 'Congratulations on your challenge prize',
			message:
				'You received 50 credits for Top 1 submitter in Monsters VS Aliens. Thanks for taking part!'
		});
	});
});

describe('mergeResultsPreservingPaid', () => {
	test('keeps paid rows and allows unpaid recipient changes', () => {
		const existing = {
			winners: [{ place: 1, message_id: 1, created_image_id: 101, user_id: 10, score: 30 }],
			payouts: [
				{
					user_id: 10,
					amount: 700,
					reason: '1st place',
					source: 'tip',
					paid_at: '2026-08-01T00:00:00.000Z'
				},
				{ user_id: 40, amount: 100, reason: 'Top 1 voter', source: 'tip', paid_at: null }
			]
		};
		const next = {
			winners: [{ place: 1, message_id: 1, created_image_id: 101, user_id: 10, score: 30 }],
			payouts: [
				{ user_id: 10, amount: 700, reason: '1st place', source: 'tip', paid_at: null },
				{ user_id: 41, amount: 100, reason: 'Top 1 voter', source: 'tip', paid_at: null }
			]
		};
		const merged = mergeResultsPreservingPaid(existing, next);
		expect(merged.ok).toBe(true);
		expect(merged.results.payouts[0].paid_at).toBe('2026-08-01T00:00:00.000Z');
		expect(merged.results.payouts[1]).toMatchObject({ user_id: 41, paid_at: null });
	});

	test('rejects changing a paid recipient', () => {
		const existing = {
			payouts: [
				{
					user_id: 10,
					amount: 700,
					reason: '1st place',
					source: 'tip',
					paid_at: '2026-08-01T00:00:00.000Z'
				}
			]
		};
		const next = {
			payouts: [{ user_id: 20, amount: 700, reason: '1st place', source: 'tip', paid_at: null }]
		};
		const merged = mergeResultsPreservingPaid(existing, next);
		expect(merged.ok).toBe(false);
		expect(merged.error).toMatch(/already-paid/i);
	});
});
