import { describe, expect, test } from '@jest/globals';
import { scoreFeedBetaRow } from '../api_routes/feedBeta/score.js';

describe('scoreFeedBetaRow', () => {
	const nowMs = Date.parse('2025-06-01T12:00:00.000Z');

	test('ranks newer and engaged rows higher', () => {
		const ctx = {
			nowMs,
			followingIds: new Set(),
			newcomerAuthorIds: new Set(),
			newcomerHandles: new Set()
		};
		const hot = scoreFeedBetaRow(
			{
				created_at: '2025-05-31T12:00:00.000Z',
				like_count: 40,
				comment_count: 5,
				user_id: 1
			},
			ctx
		);
		const cold = scoreFeedBetaRow(
			{
				created_at: '2024-01-01T12:00:00.000Z',
				like_count: 0,
				comment_count: 0,
				user_id: 2
			},
			ctx
		);
		expect(hot.score).toBeGreaterThan(cold.score);
	});

	test('boosts followed and newcomer authors', () => {
		const base = {
			created_at: '2025-05-30T12:00:00.000Z',
			like_count: 2,
			comment_count: 0,
			user_id: 10
		};
		const plain = scoreFeedBetaRow(base, {
			nowMs,
			followingIds: new Set(),
			newcomerAuthorIds: new Set(),
			newcomerHandles: new Set()
		});
		const follow = scoreFeedBetaRow(base, {
			nowMs,
			followingIds: new Set(['10']),
			newcomerAuthorIds: new Set(),
			newcomerHandles: new Set()
		});
		const newcomer = scoreFeedBetaRow(base, {
			nowMs,
			followingIds: new Set(),
			newcomerAuthorIds: new Set(['10']),
			newcomerHandles: new Set()
		});
		expect(follow.score).toBeGreaterThan(plain.score);
		expect(newcomer.score).toBeGreaterThan(plain.score);
	});
});
