import { describe, expect, test } from '@jest/globals';
import {
	challengeEngagementItemsEqual,
	CHAT_FEED_CHALLENGE_ENGAGEMENT_URL,
	readChallengeEngagementFromSwCache
} from '../src/chat/feed/feedChannelChallenge.js';

describe('challengeEngagementItemsEqual', () => {
	test('matches identical objects', () => {
		const item = { type: 'engagement', id: 'eng-1', variant: 'challenge_stats' };
		expect(challengeEngagementItemsEqual(item, { ...item })).toBe(true);
	});

	test('detects changes', () => {
		const a = { type: 'engagement', id: 'eng-1', payload: { title: 'A' } };
		const b = { type: 'engagement', id: 'eng-1', payload: { title: 'B' } };
		expect(challengeEngagementItemsEqual(a, b)).toBe(false);
	});
});

describe('readChallengeEngagementFromSwCache', () => {
	test('returns null when Cache API is unavailable', async () => {
		await expect(readChallengeEngagementFromSwCache()).resolves.toBeNull();
	});
});

describe('CHAT_FEED_CHALLENGE_ENGAGEMENT_URL', () => {
	test('uses dedicated challenge engagement endpoint', () => {
		expect(CHAT_FEED_CHALLENGE_ENGAGEMENT_URL).toBe('/api/feed/challenge-engagement');
	});
});
