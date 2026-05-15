/**
 * Synthetic timelines + mock queries for slot-pack API distribution tests.
 */
import { feedRowIsStrictlyOlderThanCursor } from '../../api_routes/feed/pullMobileChatSlotPackFeed.js';
import { transformFeedCreationRow } from '../../api_routes/feed/transformFeedCreationRow.js';
import {
	isFeedRowVideoCreation,
	MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS,
	MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN,
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from '../../src/shared/chatFeedMobilePartition.js';

export const SLOT_PACK_PAGE_LIMIT = 28;

function isoDay(dayIndex) {
	const d = new Date(Date.UTC(2025, 0, 31 - dayIndex, 12, 0, 0));
	return d.toISOString();
}

export function slotPackFeedRow(creationId, dayIndex, meta) {
	const id = Number(creationId);
	return {
		id,
		created_image_id: id,
		created_at: isoDay(dayIndex),
		title: `c${id}`,
		summary: '',
		author: '',
		tags: '',
		user_id: 1,
		filename: null,
		file_path: null,
		url: null,
		like_count: 0,
		comment_count: 0,
		viewer_liked: false,
		nsfw: false,
		meta: meta && typeof meta === 'object' ? meta : null
	};
}

export function slotPackImageRow(creationId, dayIndex) {
	return slotPackFeedRow(creationId, dayIndex, { media_type: 'image' });
}

export function slotPackVideoRow(creationId, dayIndex) {
	return slotPackFeedRow(creationId, dayIndex, {
		media_type: 'video',
		video: { file_path: `/media/${creationId}.mp4` }
	});
}

export function slotPackFeedRowAtIso(creationId, createdAtIso, meta) {
	const id = Number(creationId);
	return {
		id,
		created_image_id: id,
		created_at: createdAtIso,
		title: `t${id}`,
		summary: '',
		author: '',
		tags: '',
		user_id: 1,
		filename: null,
		file_path: null,
		url: null,
		like_count: 0,
		comment_count: 0,
		viewer_liked: false,
		nsfw: false,
		meta: meta && typeof meta === 'object' ? meta : null
	};
}

export function countSlotPackVideosInRawRows(rows) {
	let n = 0;
	for (const r of rows) {
		if (isFeedRowVideoCreation(transformFeedCreationRow(r))) n += 1;
	}
	return n;
}

/** First 21 rows are 4v+3nv × three (matches API + mobile layout). */
export function expectSlotPackStructuredPrefix(rows, countVids = countSlotPackVideosInRawRows) {
	const need = MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN;
	expect(rows.length).toBeGreaterThanOrEqual(need);
	let o = 0;
	for (let g = 0; g < MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT; g += 1) {
		expect(countVids(rows.slice(o, o + MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP))).toBe(
			MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
		);
		o += MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP;
		expect(countVids(rows.slice(o, o + MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS))).toBe(0);
		o += MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS;
	}
}

const isVideoRow = (row) => {
	const m = row?.meta;
	return m && typeof m === 'object' && m.media_type === 'video';
};

/**
 * Mock queries backed by a flat timeline (newest-first).
 * Provides `getLatestFeedSlotPackHead` and `getPageAfterImageCursor`.
 */
export function createSlotPackMockQueries(timelineNewestFirst) {
	return {
		selectFeedItems: {
			getLatestFeedSlotPackHead: async (_viewerId, { videoLimit = 12, imageLimit = 9 } = {}) => {
				const safeVid = Math.min(Math.max(1, Number(videoLimit) || 12), 50);
				const safeImg = Math.min(Math.max(1, Number(imageLimit) || 9), 50);
				const videos = timelineNewestFirst.filter(isVideoRow).slice(0, safeVid);
				const images = timelineNewestFirst.filter((r) => !isVideoRow(r)).slice(0, safeImg);
				return { videos, images };
			},
			getPageAfterImageCursor: async (_viewerId, { limit, afterCreatedAt, afterCreatedImageId }) => {
				const lim = Math.min(Math.max(1, Number(limit) || 20), 100);
				const older = timelineNewestFirst.filter((row) =>
					feedRowIsStrictlyOlderThanCursor(row, afterCreatedAt, afterCreatedImageId)
				);
				const hasMore = older.length > lim;
				return { rows: older.slice(0, lim), hasMore };
			}
		}
	};
}

export function timelineVideoHeavyHead() {
	const videoCount = 220;
	const imageCount = 80;
	const timeline = [];
	let day = 0;
	for (let i = 0; i < videoCount; i += 1) {
		timeline.push(slotPackVideoRow(3000 + i, day));
		day += 1;
	}
	for (let i = 0; i < imageCount; i += 1) {
		timeline.push(slotPackImageRow(100 + i, day));
		day += 1;
	}
	return timeline;
}

export function timelineImageHeavyHead() {
	const imageCount = 260;
	const videoCount = 40;
	const timeline = [];
	let day = 0;
	for (let i = 0; i < imageCount; i += 1) {
		timeline.push(slotPackImageRow(5000 + i, day));
		day += 1;
	}
	for (let i = 0; i < videoCount; i += 1) {
		timeline.push(slotPackVideoRow(8000 + i, day));
		day += 1;
	}
	return timeline;
}

/** Enough rows in feed order to fill one full structured prefix (4v+3nv × 3). */
export function composeBufferOneStructuredCycle() {
	const v = (id, at) =>
		slotPackFeedRowAtIso(id, at, {
			media_type: 'video',
			video: { file_path: `/v/${id}.mp4` }
		});
	const img = (id, at) => slotPackFeedRowAtIso(id, at, { media_type: 'image' });
	return [
		v(1, '2025-01-10T00:00:00.000Z'),
		v(2, '2025-01-09T00:00:00.000Z'),
		v(3, '2025-01-08T00:00:00.000Z'),
		v(4, '2025-01-07T00:00:00.000Z'),
		img(10, '2025-01-06T00:00:00.000Z'),
		img(11, '2025-01-05T00:00:00.000Z'),
		img(12, '2025-01-04T00:00:00.000Z'),
		v(5, '2025-01-03T00:00:00.000Z'),
		v(6, '2025-01-02T00:00:00.000Z'),
		v(7, '2025-01-01T00:00:00.000Z'),
		v(8, '2024-12-31T00:00:00.000Z'),
		img(13, '2024-12-30T00:00:00.000Z'),
		img(14, '2024-12-29T00:00:00.000Z'),
		img(15, '2024-12-28T00:00:00.000Z'),
		v(9, '2024-12-27T00:00:00.000Z'),
		v(10, '2024-12-26T00:00:00.000Z'),
		v(11, '2024-12-25T00:00:00.000Z'),
		v(12, '2024-12-24T00:00:00.000Z'),
		img(16, '2024-12-23T00:00:00.000Z'),
		img(17, '2024-12-22T00:00:00.000Z'),
		img(18, '2024-12-21T00:00:00.000Z')
	];
}
