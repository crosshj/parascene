import test from 'node:test';
import assert from 'node:assert/strict';
import {
	fetchThreadMessagesChronological,
	replaceWithLatestGlobalConfig
} from '../server/services/create/challengeSubmitShared.js';
import {
	resolveChallengeOrganizerAllowlistFromMessages,
	viewerCanOperateChallengePayout
} from '../shared/index.js';

const CHALLENGE_ID = '2026-09-29-suno-44f50b52';

function message(id, body, createdAt) {
	return {
		id,
		body: typeof body === 'string' ? body : JSON.stringify(body),
		created_at: createdAt,
		sender_id: 1,
		reactions: {}
	};
}

function queryClient(resolve) {
	return {
		from() {
			const state = { orders: [] };
			const builder = {
				select() {
					return builder;
				},
				eq() {
					return builder;
				},
				ilike(_column, pattern) {
					state.ilike = pattern;
					return builder;
				},
				order(column) {
					state.orders.push(column);
					return builder;
				},
				limit(count) {
					state.limit = count;
					return builder;
				},
				lt(column, value) {
					state.lt = [column, value];
					return builder;
				},
				range(from, to) {
					state.range = [from, to];
					return builder;
				},
				then(onOk, onErr) {
					return Promise.resolve(resolve(state)).then(onOk, onErr);
				}
			};
			return builder;
		}
	};
}

const staleGlobal = message(
	10,
	{ kind: 'challenges_global_config', organizers_by_track: { monthly: [], weekly: [], suno: [] } },
	'2026-11-01T00:00:00.000Z'
);
const realGlobal = message(
	80,
	{
		kind: 'challenges_global_config',
		organizers_by_track: { monthly: [], weekly: [], suno: ['galbatorix47'] }
	},
	'2026-08-01T00:00:00.000Z'
);
const challengeConfig = message(
	40,
	{ kind: 'challenge_config', challenge_id: CHALLENGE_ID, track: 'suno', title: 'Sounds of the Night' },
	'2026-09-29T00:00:00.000Z'
);
const submission = message(
	41,
	{ kind: 'challenge_submission', challenge_id: CHALLENGE_ID, created_image_id: 9 },
	'2026-10-01T00:00:00.000Z'
);

test('a stale newer-dated organizer list does not hide the real one', async () => {
	const sb = queryClient((state) => {
		if (state.ilike && state.ilike.includes('challenges_global_config') && !state.range) {
			return { data: [realGlobal], error: null };
		}
		if (state.range) {
			return { data: state.range[0] === 0 ? [challengeConfig, submission] : [], error: null };
		}
		if (state.orders[0] === 'created_at') {
			return { data: [staleGlobal], error: null };
		}
		return { data: [], error: null };
	});

	const messages = await fetchThreadMessagesChronological(sb, 100, undefined, {
		challengeId: CHALLENGE_ID
	});
	const allow = resolveChallengeOrganizerAllowlistFromMessages(messages);
	assert.equal(allow.includes('galbatorix47'), true);
	assert.equal(viewerCanOperateChallengePayout('galbatorix47', {
		monthly: [],
		weekly: [],
		suno: ['galbatorix47']
	}, 'suno'), true);
	assert.equal(
		messages.some((row) => {
			const body = JSON.parse(row.body);
			return body.kind === 'challenge_config' && body.challenge_id === CHALLENGE_ID;
		}),
		true
	);
	assert.equal(
		messages.some((row) => JSON.parse(row.body).kind === 'challenge_submission'),
		true
	);
});

test('an older text-search hit cannot replace a newer organizer list already loaded', () => {
	const kept = replaceWithLatestGlobalConfig([realGlobal], staleGlobal);
	assert.deepEqual(kept.map((row) => row.id), [80]);
});

test('when text search misses, payout still reads the challenge from the full thread', async () => {
	const sb = queryClient((state) => {
		if (state.ilike && state.ilike.includes('challenges_global_config') && !state.range) {
			return { data: [], error: null };
		}
		if (state.range) return { data: [], error: null };
		if (state.orders[0] === 'created_at') return { data: [staleGlobal], error: null };
		if (state.limit === 400) return { data: [realGlobal], error: null };
		if (state.limit === 500 && state.orders[0] === 'id') {
			return { data: [submission, challengeConfig, realGlobal].reverse(), error: null };
		}
		return { data: [], error: null };
	});

	const messages = await fetchThreadMessagesChronological(sb, 100, undefined, {
		challengeId: CHALLENGE_ID
	});
	assert.equal(resolveChallengeOrganizerAllowlistFromMessages(messages).includes('galbatorix47'), true);
	assert.equal(
		messages.some((row) => JSON.parse(row.body).kind === 'challenge_config'),
		true
	);
});
