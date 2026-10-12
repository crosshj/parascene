import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadsProvider } from '../client/providers/threads/index.js';
import { createQueryRegistry } from '../client/core/queryRegistry.js';

function message(id, senderId, body) {
	return {
		id,
		sender_id: senderId,
		created_at: `2026-10-0${id}T00:00:00Z`,
		body: JSON.stringify(body),
		viewer_reactions: [],
		reactions: {},
	};
}

test('outstanding challenge votes reach the sidebar before Challenges is opened', async () => {
	const messages = [
		message(1, 1, {
			kind: 'challenge_config',
			challenge_id: 'c1',
			submission_start_at: '2020-01-01T00:00:00.000Z',
			submission_end_at: '2020-01-02T00:00:00.000Z',
			voting_start_at: '2020-01-02T00:00:00.000Z',
			voting_end_at: '2099-01-01T00:00:00.000Z',
		}),
		message(2, 2, { kind: 'challenge_submission', challenge_id: 'c1', created_image_id: 9 }),
	];
	let messageLoads = 0;
	const api = {
		async loadInbox() {
			return {
				viewerId: 1,
				threads: [{ id: 9, channel_slug: 'challenges', unread_count: 0, last_message: { id: 2 } }],
				servers: [],
				unreadSummary: { challenges_unread: 0, total_unread: 0, viewer_id: 1 },
			};
		},
		async loadMessages(threadId, options) {
			messageLoads += 1;
			assert.equal(threadId, 9);
			assert.equal(options.limit, 100);
			return { messages, hasMore: false, nextBefore: null };
		},
	};
	let channel = null;
	const provider = createThreadsProvider({
		viewerId: 1,
		registry: createQueryRegistry(),
		apiFactory: () => api,
		realtimeFactory: () => ({ subscribe() { return () => {}; }, destroy() {}, retry() {} }),
		onChallengeChannel(detail) { channel = detail; },
	});
	try {
		assert.equal(provider.challengeAttention, null);
		provider.preload();
		await provider.query.loadIfNeeded();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(messageLoads, 1);
		assert.equal(provider.challengeAttention, 1);
		assert.equal(provider.challengeUnread({ challenges_unread: 0 }), 1);
		assert.equal(channel.threadId, 9);
		assert.equal(channel.messages.some((row) => row.id === 2), true);
	} finally {
		provider.destroy();
	}
});
