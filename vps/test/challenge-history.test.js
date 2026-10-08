import test from 'node:test';
import assert from 'node:assert/strict';
import {
	challengeHistoryExpiresAt,
	challengeIsActive,
	createChallengeHistoryProvider,
	nextActiveChallengeInactiveAt
} from '../client/providers/challenges/history.js';
import { challengeEntryRequests } from '../client/providers/challenges/entryCreations.js';

function storage() {
	const data = new Map();
	return {
		get length() { return data.size; },
		key: (index) => [...data.keys()][index],
		getItem: (key) => data.get(key) || null,
		setItem: (key, value) => data.set(key, value),
		removeItem: (key) => data.delete(key)
	};
}

function config(id, fields) {
	return {
		id,
		created_at: fields.submission_start_at,
		body: JSON.stringify({ kind: 'challenge_config', challenge_id: id, title: id, ...fields })
	};
}

test('history expires when the soonest active challenge becomes inactive', () => {
	const now = Date.parse('2026-10-05T00:00:00Z');
	const weekly = {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	};
	const monthly = {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-20T00:00:00Z',
		voting_start_at: '2026-10-21T00:00:00Z',
		voting_end_at: '2026-10-25T00:00:00Z'
	};
	assert.equal(nextActiveChallengeInactiveAt(weekly, now), Date.parse('2026-10-08T00:00:00Z') + 1);
	assert.equal(nextActiveChallengeInactiveAt(monthly, now), Date.parse('2026-10-20T00:00:00Z') + 1);
	const messages = [config('weekly', weekly), config('monthly', monthly)];
	assert.equal(challengeHistoryExpiresAt(messages, now), Date.parse('2026-10-08T00:00:00Z') + 1);
	const voting = {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-04T00:00:00Z',
		voting_start_at: '2026-10-04T00:00:00Z',
		voting_end_at: '2026-10-18T00:00:00Z'
	};
	assert.equal(nextActiveChallengeInactiveAt(voting, now), Date.parse('2026-10-18T00:00:00Z') + 1);
});

function provider(store, clock, loadChannel) {
	return createChallengeHistoryProvider({
		viewerId: 10,
		storage: () => store,
		now: () => clock.now,
		activeMaxAge: 60_000,
		// loadChannel is supplied per request
	});
}

function once(history, spec) {
	return new Promise((resolve, reject) => {
		let stop = () => {};
		let done = false;
		stop = history.observe(spec, (delivery) => {
			if (done) return;
			if (delivery.paint === 'pending' && !delivery.error) return;
			done = true;
			queueMicrotask(() => stop());
			if (delivery.error && delivery.paint === 'pending') reject(delivery.error);
			else resolve(delivery);
		});
	});
}

test('a view request fetches the channel once, then serves main and challenge views from that cache', async () => {
	const store = storage();
	const clock = { now: Date.parse('2026-10-05T00:00:00Z') };
	const messages = [config('weekly', {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	}), config('past', {
		submission_start_at: '2026-01-01T00:00:00Z',
		voting_end_at: '2026-01-08T00:00:00Z'
	})];
	let fetches = 0;
	const history = provider(store, clock);
	const loadChannel = async () => { fetches += 1; return messages; };
	const board = await once(history, { threadId: 9, request: { kind: 'main' }, loadChannel });
	assert.equal(fetches, 1);
	assert.equal(board.paint, 'board');
	assert.equal(board.messages.length, 2);
	assert.equal(challengeIsActive(board.messages, 'weekly', clock.now), true);
	assert.equal(challengeIsActive(board.messages, 'past', clock.now), false);
	const again = await once(history, { threadId: 9, request: { kind: 'main' }, loadChannel });
	assert.equal(fetches, 1);
	assert.equal(again.source, 'cache');
	const past = await once(history, { threadId: 9, request: { kind: 'challenge', challengeId: 'past' }, loadChannel });
	assert.equal(fetches, 1);
	assert.equal(past.paint, 'challenge');
	assert.equal(past.active, false);
	assert.equal(past.source, 'cache');
	history.destroy();
});

test('an active challenge is not served from the channel cache, and a channel change updates the short cache', async () => {
	const store = storage();
	const clock = { now: Date.parse('2026-10-05T00:00:00Z') };
	const messages = [config('weekly', {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	})];
	let fetches = 0;
	const warmed = provider(store, clock);
	await once(warmed, { threadId: 9, request: { kind: 'main' }, loadChannel: async () => { fetches += 1; return messages; } });
	warmed.destroy();
	fetches = 0;
	const history = provider(store, clock);
	const loadChannel = async () => { fetches += 1; return messages; };
	const seen = [];
	const stop = history.observe({
		threadId: 9,
		request: { kind: 'challenge', challengeId: 'weekly' },
		loadChannel
	}, (delivery) => { seen.push(delivery.paint); });
	assert.equal(seen[0], 'pending');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(fetches, 1);
	assert.equal(seen.at(-1), 'challenge');
	const cached = await once(history, { threadId: 9, request: { kind: 'challenge', challengeId: 'weekly' }, loadChannel });
	assert.equal(fetches, 1);
	assert.equal(cached.source, 'cache');
	assert.equal(cached.active, true);
	const changed = [config('weekly', {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	}), {
		id: 50,
		created_at: '2026-10-05T01:00:00Z',
		body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'weekly' })
	}];
	history.invalidateActive(9, { reason: 'reaction', messages: changed });
	assert.equal(fetches, 1);
	const fresh = await once(history, { threadId: 9, request: { kind: 'challenge', challengeId: 'weekly' }, loadChannel });
	assert.equal(fresh.messages.some((message) => Number(message.id) === 50), true);
	stop();
	history.destroy();
});

test('a stale channel is served and then updated', async () => {
	const store = storage();
	const clock = { now: Date.parse('2026-10-05T00:00:00Z') };
	const messages = [config('weekly', {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	})];
	const warmed = provider(store, clock);
	await once(warmed, { threadId: 9, request: { kind: 'main' }, loadChannel: async () => messages });
	warmed.destroy();
	clock.now = Date.parse('2026-10-08T00:00:00Z') + 1;
	let fetches = 0;
	const history = provider(store, clock);
	const seen = [];
	const stop = history.observe({
		threadId: 9,
		request: { kind: 'main' },
		loadChannel: async () => { fetches += 1; return messages; }
	}, (delivery) => { if (delivery.paint !== 'pending') seen.push(delivery.source); });
	assert.equal(seen[0], 'stale');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(fetches, 1);
	assert.equal(seen.at(-1), 'cache');
	stop();
	history.destroy();
});

test('challenge entry creations are fetched once and then served from cache', async () => {
	const store = storage();
	const clock = { now: Date.parse('2026-10-05T00:00:00Z') };
	const fields = {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-10T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z',
		hero_image_url: '/creations/12'
	};
	const messages = [
		config('weekly', fields),
		{ id: 8, created_at: '2026-10-02T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'weekly', created_image_id: 55 }) }
	];
	assert.deepEqual(challengeEntryRequests(messages, 'weekly'), [
		{ id: 55, messageId: 8 },
		{ id: 12, messageId: null }
	]);
	let posts = 0;
	const history = provider(store, clock);
	await once(history, {
		threadId: 9,
		request: { kind: 'challenge', challengeId: 'weekly' },
		loadChannel: async () => messages,
		loadEntryCreations: async (_threadId, challengeId, items) => {
			posts += 1;
			assert.equal(challengeId, 'weekly');
			assert.deepEqual(items.map((item) => item.id), [55, 12]);
			return { items: items.map((item) => ({ id: item.id, creator: { user_name: 'oceanman' } })) };
		}
	});
	for (let i = 0; i < 20 && !history.entryCreations(9, 'weekly'); i += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.equal(posts, 1);
	assert.equal(history.entryCreations(9, 'weekly').length, 2);
	const again = await history.ensureEntryCreations(9, 'weekly', [{ id: 55, messageId: 8 }, { id: 12, messageId: null }]);
	assert.equal(posts, 1);
	assert.equal(again[0].creator.user_name, 'oceanman');
	history.destroy();
});

test('a live channel snapshot replaces the cached main page with the new submission', async () => {
	const store = storage();
	const clock = { now: Date.parse('2026-10-05T00:00:00Z') };
	const fields = {
		submission_start_at: '2026-10-01T00:00:00Z',
		submission_end_at: '2026-10-08T00:00:00Z',
		voting_start_at: '2026-10-01T00:00:00Z',
		voting_end_at: '2026-10-12T00:00:00Z'
	};
	const messages = [config('weekly', fields)];
	let fetches = 0;
	const history = provider(store, clock);
	const loadChannel = async () => { fetches += 1; return messages; };
	await once(history, { threadId: 9, request: { kind: 'main' }, loadChannel });
	assert.equal(fetches, 1);
	history.applyChannelSnapshot(9, [...messages, {
		id: 50,
		created_at: '2026-10-05T01:00:00Z',
		body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'weekly', created_image_id: 9 })
	}]);
	const again = await once(history, { threadId: 9, request: { kind: 'main' }, loadChannel });
	assert.equal(fetches, 1);
	assert.equal(again.paint, 'board');
	assert.equal(again.messages.some((message) => Number(message.id) === 50), true);
	history.destroy();
});
