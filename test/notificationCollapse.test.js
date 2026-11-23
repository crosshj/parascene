import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationsStore } from '../server/db/notifications.js';
import {
	collapseNotificationsByCreation,
	creationAckLink,
	notificationForCollapse,
} from '../server/db/notificationCollapse.js';

function hoursAgo(hours) {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function row(overrides) {
	return {
		id: 1,
		title: 'New comment',
		message: 'Someone commented',
		link: '/creations/9',
		type: 'comment',
		created_at: hoursAgo(1),
		acknowledged_at: null,
		creation_id: 9,
		creation_title: 'Sunset',
		...overrides,
	};
}

test('recent notifications about one creation collapse into a single activity row', () => {
	const [item] = collapseNotificationsByCreation([
		row({ id: 2, created_at: hoursAgo(1), acknowledged_at: null }),
		row({ id: 1, type: 'tip', created_at: hoursAgo(2), acknowledged_at: hoursAgo(2), message: 'Someone tipped you' }),
	]);
	assert.equal(item.type, 'creation_activity');
	assert.equal(item.id, 2);
	assert.equal(item.title, 'Activity on "Sunset"');
	assert.equal(item.message, '1 comment, 1 tip');
	assert.equal(item.count, 2);
	assert.equal(item.unread_count, 1);
	assert.equal(item.acknowledged_at, null);
	assert.equal(item.creation_id, 9);
	assert.equal(item.link, '/creations/9');
});

test('a single recent notification and older history stay individual', () => {
	const recent = hoursAgo(1);
	const items = collapseNotificationsByCreation([
		row({ id: 3, created_at: recent }),
		row({ id: 4, creation_id: 9, created_at: hoursAgo(48), title: 'Older comment' }),
		row({ id: 5, creation_id: 9, created_at: hoursAgo(50), title: 'Oldest comment' }),
		row({ id: 6, type: 'credits', creation_id: 9, link: '/pricing', title: 'Credits', created_at: recent }),
	]);
	assert.deepEqual(items.slice(0, 2).map((item) => item.id).sort(), [3, 6]);
	assert.equal(items.find((item) => item.id === 3).type, 'comment');
	assert.equal(items.find((item) => item.id === 3).title, 'New comment');
	assert.equal(items.find((item) => item.id === 6).type, 'credits');
	assert.deepEqual(items.slice(2).map((item) => item.id), [4, 5]);
	assert.equal(items[2].title, 'Older comment');
});

test('mentions on the same creation collapse even when the summary has no comment or tip count', () => {
	const [item] = collapseNotificationsByCreation([
		row({ id: 1, type: 'creation_mention', creation_title: null }),
		row({ id: 2, type: 'comment_mention', created_at: hoursAgo(2), creation_title: '' }),
	]);
	assert.equal(item.type, 'creation_activity');
	assert.equal(item.title, 'Activity on your creation');
	assert.equal(item.message, 'New activity');
	assert.equal(item.count, 2);
});

test('separate creations stay separate', () => {
	const items = collapseNotificationsByCreation([
		row({ id: 1, creation_id: 1, creation_title: 'One' }),
		row({ id: 2, creation_id: 1, creation_title: 'One', created_at: hoursAgo(2) }),
		row({ id: 3, creation_id: 2, creation_title: 'Two' }),
	]);
	assert.equal(items.length, 2);
	assert.equal(items.find((item) => item.creation_id === 1).type, 'creation_activity');
	assert.equal(items.find((item) => item.creation_id === 2).type, 'comment');
});

test('collapse input reads the creation id and title from stored target and meta', () => {
	const prepared = notificationForCollapse({
		id: 3,
		title: 'New comment',
		message: 'x',
		link: '/creations/12',
		type: 'comment',
		created_at: hoursAgo(1),
		acknowledged_at: null,
		target: '{"creation_id":"12"}',
		meta: '{"creation_title":"  Harbor  "}',
	});
	assert.equal(prepared.creation_id, 12);
	assert.equal(prepared.creation_title, 'Harbor');
	assert.equal(creationAckLink({ type: 'comment', target: { creation_id: 4 } }), '/creations/4');
	assert.equal(creationAckLink({ type: 'comment', link: '/creations/8' }), '/creations/8');
	assert.equal(creationAckLink({ type: 'credits', link: '/creations/4' }), null);
	assert.equal(creationAckLink({ type: 'chat_mention', target: { thread_id: 3, creation_id: 4 } }), null);
});

function memoryClient(rows) {
	return {
		from() {
			const state = { filters: [], or: null, patch: null, mode: 'select' };
			const api = {
				select() { return api; },
				update(patch) { state.mode = 'update'; state.patch = patch; return api; },
				eq(column, value) { state.filters.push({ column, value }); return api; },
				is(column, value) { state.filters.push({ column, value, is: true }); return api; },
				or(expression) { state.or = expression; return api; },
				maybeSingle() { return finish(true); },
				then(onFulfilled, onRejected) { return finish(false).then(onFulfilled, onRejected); },
			};
			function matches(row) {
				if (state.or) {
					const matched = state.or.split(',').some((clause) => {
						const parsed = clause.match(/^([^.]+)\.eq\.(.*)$/);
						return parsed ? String(row[parsed[1]]) === parsed[2] : false;
					});
					if (!matched) return false;
				}
				return state.filters.every((filter) => row[filter.column] === filter.value);
			}
			function finish(single) {
				const hits = rows.filter(matches);
				if (state.mode === 'update') {
					for (const hit of hits) Object.assign(hit, state.patch);
					return Promise.resolve({ data: hits.map((hit) => ({ id: hit.id })), error: null });
				}
				return Promise.resolve({ data: single ? hits[0] || null : hits, error: null });
			}
			return api;
		},
	};
}

test('acknowledging one creation notification marks the whole creation read', async () => {
	const rows = [
		{ id: 2, user_id: 42, role: null, type: 'comment', link: '/creations/9', target: { creation_id: 9 }, acknowledged_at: null },
		{ id: 1, user_id: 42, role: null, type: 'tip', link: '/creations/9', target: { creation_id: 9 }, acknowledged_at: null },
		{ id: 3, user_id: 42, role: null, type: 'comment', link: '/creations/4', target: { creation_id: 4 }, acknowledged_at: null },
		{ id: 4, user_id: 7, role: null, type: 'comment', link: '/creations/9', target: { creation_id: 9 }, acknowledged_at: null },
	];
	const store = createNotificationsStore(memoryClient(rows));
	const updated = await store.acknowledge(42, 'consumer', 2);
	assert.equal(updated, 2);
	assert.ok(rows[0].acknowledged_at);
	assert.ok(rows[1].acknowledged_at);
	assert.equal(rows[2].acknowledged_at, null);
	assert.equal(rows[3].acknowledged_at, null);
});

test('acknowledging a non-creation notification marks only that row', async () => {
	const rows = [
		{ id: 5, user_id: 42, role: null, type: 'credits', link: '/pricing', target: null, acknowledged_at: null },
		{ id: 6, user_id: 42, role: null, type: 'credits', link: '/pricing', target: null, acknowledged_at: null },
	];
	const store = createNotificationsStore(memoryClient(rows));
	const updated = await store.acknowledge(42, 'consumer', 5);
	assert.equal(updated, 1);
	assert.ok(rows[0].acknowledged_at);
	assert.equal(rows[1].acknowledged_at, null);
});
