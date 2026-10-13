import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCreationChangeToRecord } from '../client/shared/creationDetailEmbedShell.js';

test('a comment change updates the record the feed card was rendered from', () => {
	const record = { id: 7, comment_count: 1, like_count: 2, viewer_liked: false };
	applyCreationChangeToRecord(record, { reason: 'comment-changed', creationId: 7, comment_count: 2 });
	assert.equal(record.comment_count, 2);
	assert.equal(record.like_count, 2);
});

test('a like change updates the record the feed card was rendered from', () => {
	const record = { id: 7, comment_count: 1, like_count: 2, viewer_liked: false };
	applyCreationChangeToRecord(record, {
		reason: 'like-changed',
		creationId: 7,
		like_count: 3,
		viewer_liked: true,
	});
	assert.equal(record.viewer_liked, true);
	assert.equal(record.like_count, 3);
	assert.equal(record.comment_count, 1);
});
