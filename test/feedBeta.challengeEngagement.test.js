import { describe, expect, test } from '@jest/globals';
import { assembleFeedItems } from '../api_routes/feed/assembleFeedItems.js';
import { resolveFeedAssembleOptions } from '../api_routes/feed/resolveFeedAssemble.js';

function minimalCreationRow(id) {
	return {
		created_image_id: id,
		id,
		created_at: '2025-02-01T12:00:00.000Z',
		user_id: id + 10,
		title: `Post ${id}`,
		meta: { media_type: 'image' },
		nsfw: false,
		like_count: 0,
		comment_count: 0,
		viewer_liked: false
	};
}

const activeChallengeSnapshot = {
	ok: true,
	active: true,
	challengeId: 'test-challenge',
	title: 'Test Challenge',
	phase: 'voting',
	highlightDeadlineMs: Date.now() + 86400000,
	submissionCount: 5,
	uniqueSubmitters: 3,
	hasUnvotedEntries: true,
	viewerHasEntered: false,
	heroImageUrl: ''
};

describe('resolveFeedAssembleOptions', () => {
	test('beta desktop page 1 fetches challenge and merges blog on app Home', () => {
		const opts = resolveFeedAssembleOptions({
			useFeedBeta: true,
			offset: 0,
			hasImageCursor: false,
			feedBetaAck: null,
			afterAt: undefined,
			afterIdNum: NaN,
			creationPull: {
				rows: [],
				hasMore: true,
				mobileChatSlotPackPageOne: false,
				mobileChatSlotPackContinuation: false,
				feedBetaContinuation: { completed_page: 1 }
			}
		});
		expect(opts.includeBlogMerge).toBe(true);
		expect(opts.fetchChallengeSnapshot).toBe(true);
		expect(opts.includeChallengeEngagement).toBe(true);
	});

	test('beta desktop page 2 skips challenge', () => {
		const opts = resolveFeedAssembleOptions({
			useFeedBeta: true,
			offset: 28,
			hasImageCursor: true,
			feedBetaAck: null,
			afterAt: '1970-01-01T00:00:00.000Z',
			afterIdNum: 1,
			creationPull: {
				rows: [],
				hasMore: true,
				mobileChatSlotPackPageOne: false,
				mobileChatSlotPackContinuation: true,
				feedBetaContinuation: { completed_page: 2 }
			}
		});
		expect(opts.includeChallengeEngagement).toBe(false);
		expect(opts.fetchChallengeSnapshot).toBe(false);
	});
});

describe('assembleFeedItems beta desktop challenge', () => {
	test('injects engagement on feed [beta] page 1 with feed_surface=chat', async () => {
		const rows = [minimalCreationRow(1), minimalCreationRow(2)];
		const { items } = await assembleFeedItems({
			queries: {},
			user: { id: 1, meta: {} },
			limit: 28,
			offset: 0,
			creationPull: {
				rows,
				hasMore: true,
				mobileChatSlotPackPageOne: false,
				mobileChatSlotPackContinuation: false
			},
			challengeSnapshot: activeChallengeSnapshot,
			feedSurface: 'chat',
			includeBlogMerge: false,
			includeChallengeEngagement: true
		});
		const engagement = items.filter((it) => it.type === 'engagement');
		expect(engagement.length).toBe(1);
		expect(engagement[0].variant).toMatch(/challenge/);
	});
});
