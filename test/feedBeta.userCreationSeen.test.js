import { describe, expect, test } from '@jest/globals';
import { loadFeedBetaSeenSetForUser, getFeedBetaSeenSet } from '../api_routes/feedBeta/seen.js';
import {
	parseFeedImpressionBody,
	sanitizeFeedImpressionMeta
} from '../api_routes/feedBeta/userCreationSeen.js';

describe('feedBeta userCreationSeen', () => {
	test('parseFeedImpressionBody accepts creation_id and attribution', () => {
		const parsed = parseFeedImpressionBody({
			creation_id: 42,
			surface: 'chat_feed',
			attribution: { pool: 'hot_24h', page_index: 1, position_in_page: 3 }
		});
		expect(parsed?.creationId).toBe(42);
		expect(parsed?.meta.pool).toBe('hot_24h');
		expect(parsed?.meta.page_index).toBe(1);
		expect(parsed?.meta.position_in_page).toBe(3);
		expect(parsed?.meta.surface).toBe('chat_feed');
	});

	test('sanitizeFeedImpressionMeta strips unknown keys', () => {
		expect(sanitizeFeedImpressionMeta({ pool: 'new', extra: 'nope' })).toEqual({ pool: 'new' });
	});

	test('loadFeedBetaSeenSetForUser merges meta and db ids', async () => {
		const user = { id: 7, meta: { feedBetaSeen: ['1', '2'] } };
		const queries = {
			selectUserCreationSeen: {
				getRecentCreationIds: {
					run: async () => [3, 4]
				}
			}
		};
		const set = await loadFeedBetaSeenSetForUser(queries, user);
		expect(set.has('1')).toBe(true);
		expect(set.has('4')).toBe(true);
		expect(getFeedBetaSeenSet(user).size).toBe(2);
	});
});
