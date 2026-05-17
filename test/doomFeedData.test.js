import { describe, expect, test } from '@jest/globals';
import {
	createDoomFeedPager,
	normalizeDoomAnchorMountItems
} from '../src/chat/feed/doomFeedData.js';

describe('normalizeDoomAnchorMountItems', () => {
	test('anchor first preserves older tail order', () => {
		const items = [
			{ created_image_id: 3, created_at: '2025-01-03' },
			{ created_image_id: 2, created_at: '2025-01-02' },
			{ created_image_id: 1, created_at: '2025-01-01' }
		];
		expect(normalizeDoomAnchorMountItems(items, 2).map((x) => x.created_image_id)).toEqual([
			2, 1
		]);
	});
});

describe('createDoomFeedPager', () => {
	test('mount uses /api/feed/doom with start id', async () => {
		const urls = [];
		const pager = createDoomFeedPager({
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				return {
					ok: true,
					data: {
						items: [{ created_image_id: 55 }],
						hasMore: true,
						cursor: { after_created_image_id: '55' }
					}
				};
			}
		});
		await pager.fetchMountPage(55);
		expect(urls.length).toBe(1);
		const u = new URL(urls[0], 'http://localhost');
		expect(u.pathname).toBe('/api/feed/doom');
		expect(u.searchParams.get('start')).toBe('55');
	});

	test('older page uses cursor from prior response', async () => {
		const urls = [];
		const pager = createDoomFeedPager({
			fetchJsonWithStatusDeduped: async (url) => {
				urls.push(url);
				if (url.includes('start=')) {
					return {
						ok: true,
						data: {
							items: [{ created_image_id: 80 }, { created_image_id: 70 }],
							hasMore: true,
							cursor: { after_created_image_id: '70' }
						}
					};
				}
				return { ok: true, data: { items: [], hasMore: false } };
			}
		});
		await pager.fetchMountPage(80);
		await pager.fetchOlderPage();
		expect(urls.length).toBe(2);
		const u = new URL(urls[1], 'http://localhost');
		expect(u.searchParams.get('after_created_image_id')).toBe('70');
	});

	test('filters hidden ids from returned page items', async () => {
		const pager = createDoomFeedPager({
			getHiddenFeedItems: () => ['11'],
			fetchJsonWithStatusDeduped: async () => ({
				ok: true,
				data: {
					items: [{ created_image_id: 11 }, { created_image_id: 12 }],
					hasMore: false,
					cursor: { after_created_image_id: '12' }
				}
			})
		});
		const page = await pager.fetchMountPage(12);
		expect(page.pageItems.map((x) => x.created_image_id)).toEqual([12]);
	});
});
