import { describe, expect, test } from '@jest/globals';
import {
	buildFullChallengeConfigBody,
	normalizeChallengeConfigMessageIds,
	pickCanonicalChallengeConfigMessageId,
	persistSingleChallengeConfigMessage
} from '../api_routes/utils/challengeConfigMessage.js';

describe('challengeConfigMessage', () => {
	test('picks newest id as canonical', () => {
		expect(pickCanonicalChallengeConfigMessageId([10, 40, 20])).toBe(40);
		expect(normalizeChallengeConfigMessageIds([20, 10, 20, null, 0])).toEqual([10, 20]);
	});

	test('builds full body from merge + patch', () => {
		const body = buildFullChallengeConfigBody(
			{
				kind: 'challenge_config',
				challenge_id: 'c1',
				title: 'Week of 2026-08-02',
				hero_image_url: '/creations/1',
				_last_msg_id: 99
			},
			'c1',
			{ hero_image_url: '/creations/2', cover_image_url: '' }
		);
		expect(body).toEqual({
			kind: 'challenge_config',
			challenge_id: 'c1',
			title: 'Week of 2026-08-02',
			hero_image_url: '/creations/2',
			cover_image_url: ''
		});
		expect(body._last_msg_id).toBeUndefined();
	});

	test('persist updates canonical and deletes siblings', async () => {
		const calls = [];
		const sb = {
			from(table) {
				const state = { table, mode: null, payload: null };
				const chain = {
					update(payload) {
						state.mode = 'update';
						state.payload = payload;
						calls.push({ op: 'update', table, payload });
						return chain;
					},
					delete() {
						state.mode = 'delete';
						calls.push({ op: 'delete', table });
						return chain;
					},
					in(col, vals) {
						calls.push({ op: 'in', col, vals });
						return chain;
					},
					eq(col, val) {
						calls.push({ op: 'eq', col, val });
						if (state.mode === 'update' && col === 'thread_id') {
							return Promise.resolve({ error: null });
						}
						if (state.mode === 'delete' && col === 'thread_id') {
							return Promise.resolve({ error: null });
						}
						return chain;
					}
				};
				return chain;
			}
		};

		const result = await persistSingleChallengeConfigMessage({
			sb,
			threadId: 100,
			challengeId: 'c1',
			messageIds: [1, 3, 2],
			merged: { title: 'Hello', track: 'weekly' },
			patch: { hero_image_url: '/creations/9' }
		});

		expect(result.messageId).toBe(3);
		expect(result.deletedIds).toEqual([1, 2]);
		expect(result.payload.title).toBe('Hello');
		expect(result.payload.hero_image_url).toBe('/creations/9');
		expect(calls.some((c) => c.op === 'update')).toBe(true);
		expect(calls.some((c) => c.op === 'delete')).toBe(true);
		expect(calls.some((c) => c.op === 'in' && Array.isArray(c.vals) && c.vals.includes(1))).toBe(
			true
		);
	});
});
