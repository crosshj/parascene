import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	applyAnnouncedEngagement,
	projectCreationEngagement,
	readCreationEngagement,
	resetCreationEngagement,
	subscribeCreationEngagement,
	toggleCreationLike
} from '../client/shared/creationEngagement.js';
import { HOME_ROW_HEIGHT, homeTileWidth } from '../client/shared/homeRow.js';

test('portrait home tiles stay wide enough for two stat pills', () => {
	const css = fs.readFileSync(new URL('../client/views/Home/HomeView.css', import.meta.url), 'utf8');
	assert.match(css, new RegExp(`--home-row-height:\\s*${HOME_ROW_HEIGHT}px`));
	assert.match(css, /\.home-tile__stat \{[^}]*height:\s*28px/s);
	const tile = homeTileWidth(9, 16);
	const room = tile - 8 * 2 - 6;
	const pill = 8 + 16 + 4 + (8 * 4) + 8;
	assert.equal(tile, 158);
	assert.ok(room >= pill * 2);
});

test('a like updates the shared counts before the request settles and keeps the comment count', async () => {
	resetCreationEngagement();
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	const previous = globalThis.fetch;
	globalThis.fetch = async (_url, options) => {
		assert.equal(options.method, 'POST');
		await gate;
		return { ok: true, json: async () => ({ like_count: 4, viewer_liked: true, liked_by: ['@ada'] }) };
	};
	const seen = [];
	const stop = subscribeCreationEngagement((state) => seen.push({ ...state }));
	try {
		const creation = { id: 9, like_count: 3, comment_count: 2, viewer_liked: false };
		const result = toggleCreationLike(creation);
		assert.equal(result.viewer_liked, true);
		assert.equal(result.like_count, 4);
		assert.equal(creation.like_count, 4);
		assert.equal(creation.comment_count, 2);
		assert.equal(seen.at(-1).like_count, 4);
		release();
		const settled = await result.done;
		assert.equal(settled.ok, true);
		assert.equal(settled.like_count, 4);
		assert.equal(settled.viewer_liked, true);
		assert.equal(readCreationEngagement(9).comment_count, 2);
		assert.deepEqual(settled.liked_by, ['@ada']);
	} finally {
		globalThis.fetch = previous;
		stop();
		resetCreationEngagement();
	}
});

test('a failed like restores the previous counts', async () => {
	resetCreationEngagement();
	const previous = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'nope' }) });
	try {
		const creation = { id: 4, like_count: 2, comment_count: 1, viewer_liked: true };
		const result = toggleCreationLike(creation);
		assert.equal(result.viewer_liked, false);
		assert.equal(result.like_count, 1);
		const settled = await result.done;
		assert.equal(settled.ok, false);
		assert.equal(settled.viewer_liked, true);
		assert.equal(settled.like_count, 2);
		assert.equal(creation.comment_count, 1);
	} finally {
		globalThis.fetch = previous;
		resetCreationEngagement();
	}
});

test('a like refresh keeps the comment count that already belongs to that image', () => {
	resetCreationEngagement();
	projectCreationEngagement({ id: 3, like_count: 1, comment_count: 4, viewer_liked: false, commented_by: ['@ada'] }, { incoming: true });
	const next = projectCreationEngagement({ id: 3, like_count: 2, viewer_liked: true }, { incoming: true });
	assert.equal(next.comment_count, 4);
	assert.equal(next.like_count, 2);
	assert.equal(next.viewer_liked, true);
	assert.deepEqual(next.commented_by, ['@ada']);
	resetCreationEngagement();
});

test('a comment change updates the shared count without touching likes', () => {
	resetCreationEngagement();
	projectCreationEngagement({ id: 7, like_count: 2, comment_count: 1, viewer_liked: false }, { incoming: true });
	applyAnnouncedEngagement({ reason: 'comment-changed', creationId: 7, comment_count: 5 });
	const row = readCreationEngagement(7);
	assert.equal(row.comment_count, 5);
	assert.equal(row.like_count, 2);
	assert.equal(row.viewer_liked, false);
	resetCreationEngagement();
});

test('a later read does not clobber a like that is still being saved', async () => {
	resetCreationEngagement();
	const previous = globalThis.fetch;
	let rejectFetch = () => {};
	globalThis.fetch = () => new Promise((_resolve, reject) => { rejectFetch = reject; });
	try {
		const creation = { id: 8, like_count: 1, comment_count: 0, viewer_liked: false };
		const result = toggleCreationLike(creation);
		const kept = projectCreationEngagement({ id: 8, like_count: 1, comment_count: 0, viewer_liked: false }, { incoming: true });
		assert.equal(kept.viewer_liked, true);
		assert.equal(kept.like_count, 2);
		applyAnnouncedEngagement({ reason: 'comment-changed', creationId: 8, comment_count: 6 });
		rejectFetch(new Error('stop'));
		const settled = await result.done;
		assert.equal(settled.viewer_liked, false);
		assert.equal(settled.like_count, 1);
		assert.equal(settled.comment_count, 6);
	} finally {
		globalThis.fetch = previous;
		resetCreationEngagement();
	}
});
