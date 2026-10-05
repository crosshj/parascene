import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentsStore } from '../db/comments.js';

function fakeClient() {
	const reactions = [];
	return {
		reactions,
		from(table) {
			let scope = {};
			let countEmoji = null;
			const query = {
				select(_columns, options) { if (options?.count) query.counting = true; return query; },
				eq(key, value) { if (query.counting && key === 'emoji_key') countEmoji = value; return query; },
				match(value) { scope = value; return query; },
				maybeSingle() {
					return Promise.resolve({ data: table === 'prsn_comments_created_image' ? { id: 7, created_image_id: 9 } : reactions.find((row) => Object.entries(scope).every(([key, value]) => row[key] === value)) || null });
				},
				upsert(value) { query.write = () => { if (!reactions.some((row) => Object.entries(value).every(([key, item]) => row[key] === item))) reactions.push({ ...value, id: reactions.length + 1 }); }; return query; },
				delete() { query.write = () => { for (let index = reactions.length - 1; index >= 0; index--) if (Object.entries(scope).every(([key, value]) => reactions[index][key] === value)) reactions.splice(index, 1); }; return query; },
				then(resolve, reject) {
					if (query.write) query.write();
					return Promise.resolve({ data: null, count: countEmoji ? reactions.filter((row) => row.emoji_key === countEmoji).length : null, error: null }).then(resolve, reject);
				},
			};
			return query;
		},
	};
}

test('comment reaction add and remove operations are idempotent', async () => {
	const client = fakeClient();
	const store = createCommentsStore(client, { creations: { byIdForViewer: async () => ({ id: 9, user_id: 2 }) }, queries: {} });
	const viewer = { id: 1, role: 'user', meta: {} };

	assert.deepEqual(await store.react(viewer, 7, 'heart', 'add'), { added: true });
	assert.deepEqual(await store.react(viewer, 7, 'heart', 'add'), { added: true });
	assert.equal(client.reactions.length, 1);
	assert.deepEqual(await store.react(viewer, 7, 'heart', 'remove'), { added: false });
	assert.deepEqual(await store.react(viewer, 7, 'heart', 'remove'), { added: false });
	assert.equal(client.reactions.length, 0);
});
