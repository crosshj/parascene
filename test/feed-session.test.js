import test from 'node:test';
import assert from 'node:assert/strict';
import { drawThreadPageFromCatalog } from '../server/services/feed/ranking/pools.js';
import { fillBetaPageFromPast } from '../server/services/feed/ranking/fillPageToLimit.js';
import { createFeedBetaSession, parseFeedBetaSession } from '../server/services/feed/ranking/feedSession.js';
import { parseFeedBetaAckFromQuery } from '../server/services/feed/ranking/continuation.js';
import { FEED_BETA_DEFAULT_PARAMS } from '../server/services/feed/ranking/params.js';
import { encodeFeedBetaAck } from '../client/shared/feedBetaContinuation.js';

const row = (id, userId = id) => ({ id, created_image_id: id, created_at: new Date(Date.UTC(2026, 0, 1) + id * 60000).toISOString(), user_id: userId, url: `/api/images/created/${id}.png`, like_count: id % 3, comment_count: 0 });
const scoreContext = { nowMs: Date.UTC(2026, 0, 2), followingIds: new Set(), newcomerAuthorIds: new Set(), newcomerHandles: new Set(), params: FEED_BETA_DEFAULT_PARAMS };

test('relaxed pool pages still skip creations already served in the feed session', () => {
	const catalog = Array.from({ length: 30 }, (_, index) => row(index + 1));
	const sessionServed = new Set(Array.from({ length: 25 }, (_, index) => String(index + 1)));
	const rows = drawThreadPageFromCatalog(catalog, { thread: 'other', take: 20, pageIndex: 8, seen: new Set(), sessionServed, scoreContext, shuffleSeed: 's', viewerUserId: 999 });
	assert.deepEqual(rows.map((r) => r.created_image_id).sort((a, b) => a - b), [26, 27, 28, 29, 30]);
});

test('past walk skips session-served ids, keeps seen ones, advances the cursor and ends at the oldest creation', async () => {
	const calls = [];
	const archive = [row(9, 1), row(8, 2), row(7, 3), row(6, 4), row(5, 5)];
	const queries = { selectFeedBetaSitewideCatalog: { getOlderThan: async (_viewer, opts) => {
		calls.push({ before: opts.beforeId, exclude: [...opts.exclude].sort() });
		const start = opts.beforeId == null ? 0 : archive.findIndex((r) => r.created_image_id < opts.beforeId);
		const picked = []; let last = null;
		for (const r of start < 0 ? [] : archive.slice(start)) { last = r; if (opts.exclude.has(String(r.created_image_id))) continue; picked.push(r); if (picked.length >= opts.limit) break; }
		const exhausted = !last || last === archive[archive.length - 1];
		return { rows: picked, cursor: last ? { created_at: last.created_at, created_image_id: last.created_image_id } : null, exhausted };
	} } };
	const session = createFeedBetaSession();
	session.served.add('8');
	const rows = await fillBetaPageFromPast(queries, 999, { rows: [row(20)], safeLimit: 4, session, pageIndex: 3, pageSeed: 'p' });
	assert.deepEqual(rows.map((r) => r.created_image_id), [20, 9, 7, 6]);
	assert.equal(rows[1].feed_beta_why.developer.pool, 'from_the_past');
	assert.deepEqual(calls[0], { before: null, exclude: ['20', '8'] });
	assert.equal(session.tail.created_image_id, 6);
	assert.equal(session.tailExhausted, false);
	session.served.add('9').add('7').add('6');
	const next = await fillBetaPageFromPast(queries, 999, { rows: [], safeLimit: 4, session, pageIndex: 4, pageSeed: 'p' });
	assert.deepEqual(next.map((r) => r.created_image_id), [5]);
	assert.equal(session.tailExhausted, true);
});

test('feed_beta_ack carries the feed session id from client to server', () => {
	const id = '0b0f6a52-2f3e-4d8e-9a7a-0d9f1c2b3a4e';
	const ack = encodeFeedBetaAck({ completed_page: 3, page_filled: true, served_count: 28, session_id: id });
	assert.deepEqual(parseFeedBetaAckFromQuery({ feed_beta_ack: ack }), { completed_page: 3, page_filled: true, served_count: 28, session_id: id });
	const legacy = encodeFeedBetaAck({ completed_page: 2, page_filled: false, served_count: 9 });
	assert.equal(parseFeedBetaAckFromQuery({ feed_beta_ack: legacy }).session_id, undefined);
});

test('stored feed sessions round-trip served ids and the past cursor', () => {
	const id = '0b0f6a52-2f3e-4d8e-9a7a-0d9f1c2b3a4e';
	const session = parseFeedBetaSession({ served: ['1', '2'], tail: { created_at: '2026-01-01T00:00:00.000Z', created_image_id: 2 }, tail_exhausted: false }, id);
	assert.equal(session.id, id);
	assert.deepEqual([...session.served], ['1', '2']);
	assert.deepEqual(session.tail, { created_at: '2026-01-01T00:00:00.000Z', created_image_id: 2 });
	assert.equal(parseFeedBetaSession('not json', id), null);
	assert.notEqual(createFeedBetaSession('bad id').id, 'bad id');
});
