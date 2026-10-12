/**
 * Slot-pack API: page one is 4v+3nv × 3, then tail in feed order.
 */
import { describe, expect, test } from '@jest/globals';
import {
	interleaveSlotPackHead,
	latestCursorFromSlotPackHeadLists,
	pullMobileChatSlotPackFeedPageOne
} from '../api_routes/feed/pullMobileChatSlotPackFeed.js';
import { MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN } from '../src/shared/chatFeedMobilePartition.js';
import {
	SLOT_PACK_PAGE_LIMIT,
	composeBufferOneStructuredCycle,
	countSlotPackVideosInRawRows,
	createSlotPackMockQueries,
	expectSlotPackStructuredPrefix,
	slotPackImageRow,
	slotPackVideoRow,
	timelineImageHeavyHead,
	timelineVideoHeavyHead
} from './mocks/feedSlotPackScenarios.js';

const vids = countSlotPackVideosInRawRows;

describe('latestCursorFromSlotPackHeadLists', () => {
	test('cursor is the newest of last head video and last head non-video', () => {
		// 12 videos (ids 1-12) and 9 images (ids 10-18) from composeBufferOneStructuredCycle
		const cycle = composeBufferOneStructuredCycle();
		const rawVideos = cycle.filter((r) => r?.meta?.media_type === 'video');
		const rawImages = cycle.filter((r) => r?.meta?.media_type !== 'video');
		const cursor = latestCursorFromSlotPackHeadLists(rawVideos, rawImages);
		// rawVideos[0] = id 1 @ 2025-01-10 (newest), rawImages[0] = id 10 @ 2025-01-06
		// last video = id 12 @ 2024-12-24, last image = id 12 @ 2024-12-21 (wait, ids collide)
		// last video id 12 @ 2024-12-24, last image id 18 @ 2024-12-21
		// cursor should be last video (2024-12-24 > 2024-12-21)
		expect(cursor?.created_image_id).toBe(12);
	});
});

describe('interleaveSlotPackHead', () => {
	test('structured prefix is 4 video + 3 non-video, three times', () => {
		const cycle = composeBufferOneStructuredCycle();
		const rawVideos = cycle.filter((r) => r?.meta?.media_type === 'video');
		const rawImages = cycle.filter((r) => r?.meta?.media_type !== 'video');
		const rows = interleaveSlotPackHead(rawVideos, rawImages);
		expect(rows.length).toBe(MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN);
		expectSlotPackStructuredPrefix(rows);
	});
});

describe('pullMobileChatSlotPackFeedPageOne (mock queries)', () => {
	const pullOpts = () => ({
		userId: 1,
		limit: SLOT_PACK_PAGE_LIMIT,
		showOwnPosts: false,
		enableNsfw: true
	});

	test('video-heavy: naive window is all video; response still has 4v+3nv × 3 then more', async () => {
		const timeline = timelineVideoHeavyHead();
		// First SLOT_PACK_PAGE_LIMIT items in timeline are all videos
		expect(vids(timeline.slice(0, SLOT_PACK_PAGE_LIMIT))).toBe(SLOT_PACK_PAGE_LIMIT);

		const pull = await pullMobileChatSlotPackFeedPageOne({
			queries: createSlotPackMockQueries(timeline),
			...pullOpts()
		});

		expect(pull.rows.length).toBe(SLOT_PACK_PAGE_LIMIT);
		expectSlotPackStructuredPrefix(pull.rows);
		expect(pull.hasMore).toBe(true);
	});

	test('image-heavy: naive window has no video; response still has 4v+3nv × 3 then more', async () => {
		const timeline = timelineImageHeavyHead();
		expect(vids(timeline.slice(0, 200))).toBe(0);

		const pull = await pullMobileChatSlotPackFeedPageOne({
			queries: createSlotPackMockQueries(timeline),
			...pullOpts()
		});

		expect(pull.rows.length).toBe(SLOT_PACK_PAGE_LIMIT);
		expectSlotPackStructuredPrefix(pull.rows);
		expect(pull.hasMore).toBe(true);
	});

	test('returns slotPackFeedCursor pointing to latest of last head video/image', async () => {
		const timeline = timelineVideoHeavyHead();
		const pull = await pullMobileChatSlotPackFeedPageOne({
			queries: createSlotPackMockQueries(timeline),
			...pullOpts()
		});
		expect(pull.slotPackFeedCursor).not.toBeNull();
		expect(pull.slotPackFeedCursor?.created_image_id).toBeDefined();
		expect(typeof pull.slotPackFeedCursor?.created_at).toBe('string');
	});
});
