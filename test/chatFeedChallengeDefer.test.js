import { describe, expect, test } from '@jest/globals';
import { buildChallengeEngagementVirtualRows } from '../api_routes/feed/engagementAndNewbie.js';
import {
	CHAT_FEED_CHALLENGE_PLACEHOLDER,
	isChatFeedChallengePlaceholder,
	partitionChatFeedMobileAlternating
} from '../src/shared/chatFeedMobilePartition.js';

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

describe('partitionChatFeedMobileAlternating reserveChallengeSlot', () => {
	test('first between-spotlight strip reserves placeholder instead of engagement row', () => {
		const engagement = {
			type: 'engagement',
			variant: 'challenge_stats',
			id: 'eng-1'
		};
		const rows = [
			{ id: 1, created_image_id: 1, meta: { media_type: 'image' } },
			engagement,
			{ id: 2, created_image_id: 2, meta: { media_type: 'image' } },
			{ id: 3, created_image_id: 3, meta: { media_type: 'image' } },
			{ id: 4, created_image_id: 4, meta: { media_type: 'video' }, media_type: 'video', video_url: 'https://x/v.mp4' },
			{ id: 5, created_image_id: 5, meta: { media_type: 'video' }, media_type: 'video', video_url: 'https://x/v2.mp4' },
			{ id: 6, created_image_id: 6, meta: { media_type: 'video' }, media_type: 'video', video_url: 'https://x/v3.mp4' },
			{ id: 7, created_image_id: 7, meta: { media_type: 'video' }, media_type: 'video', video_url: 'https://x/v4.mp4' }
		];
		const { segments } = partitionChatFeedMobileAlternating(rows, { reserveChallengeSlot: true });
		const cardSegments = segments.filter((s) => s.type === 'cards');
		expect(cardSegments.length).toBeGreaterThan(0);
		const firstCards = cardSegments[0];
		expect(firstCards.items.some(isChatFeedChallengePlaceholder)).toBe(true);
		expect(firstCards.items.some((it) => it.type === 'engagement')).toBe(false);
	});

	test('placeholder constant is stable', () => {
		expect(CHAT_FEED_CHALLENGE_PLACEHOLDER.type).toBe('challenge_placeholder');
	});
});

describe('challenge engagement deferred endpoint shape', () => {
	test('virtual rows produce single feed item for active challenge', () => {
		const rows = buildChallengeEngagementVirtualRows(activeChallengeSnapshot);
		expect(rows.length).toBe(1);
		expect(rows[0].type).toBe('engagement');
	});
});
