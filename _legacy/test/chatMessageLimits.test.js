import { describe, expect, test } from '@jest/globals';
import {
	MAX_CHAT_MESSAGE_CHARS,
	MAX_MACHINE_CHANNEL_MESSAGE_CHARS,
	maxChatMessageBodyChars
} from '../api_routes/utils/chatMessageLimits.js';

describe('chatMessageLimits', () => {
	test('keeps normal chat at 4000', () => {
		expect(maxChatMessageBodyChars({ type: 'dm' }, 'hello')).toBe(MAX_CHAT_MESSAGE_CHARS);
		expect(
			maxChatMessageBodyChars(
				{ type: 'channel', channel_slug: 'general' },
				JSON.stringify({ kind: 'challenge_config', challenge_id: 'x' })
			)
		).toBe(MAX_CHAT_MESSAGE_CHARS);
	});

	test('raises limit for #challenges machine configs only', () => {
		const challenges = { type: 'channel', channel_slug: 'challenges' };
		expect(
			maxChatMessageBodyChars(
				challenges,
				JSON.stringify({ kind: 'challenge_config', challenge_id: 'c1', title: 'Hi' })
			)
		).toBe(MAX_MACHINE_CHANNEL_MESSAGE_CHARS);
		expect(
			maxChatMessageBodyChars(
				challenges,
				JSON.stringify({ kind: 'challenges_global_config', organizer_user_names: [] })
			)
		).toBe(MAX_MACHINE_CHANNEL_MESSAGE_CHARS);
		expect(
			maxChatMessageBodyChars(
				challenges,
				JSON.stringify({ kind: 'challenge_submission', challenge_id: 'c1' })
			)
		).toBe(MAX_CHAT_MESSAGE_CHARS);
		expect(maxChatMessageBodyChars(challenges, 'plain text')).toBe(MAX_CHAT_MESSAGE_CHARS);
	});
});
