/**
 * Mobile chat `#feed` spotlight partitioning (pure data, no DOM / icons).
 * Kept separate from `feedCardBuild.js` so Node scripts can import without `/icons/svg-strings.js`.
 */

/**
 * Feed row is a creation with playable video (chat #feed mobile spotlight strip).
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
export function isFeedRowVideoCreation(item) {
	if (!item || typeof item !== 'object') return false;
	const type = item.type;
	if (type === 'tip' || type === 'blog_post' || type === 'engagement') return false;
	const mediaType = typeof item.media_type === 'string' ? item.media_type.trim().toLowerCase() : 'image';
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';
	return mediaType === 'video' && Boolean(videoUrl);
}

/**
 * Creation rows that belong in the between-spotlight card strips: non-video feed creations with an id.
 * (Skips tips/blog/engagement like {@link isFeedRowVideoCreation}.)
 *
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
function isFeedRowImageCreationBetweenSpotlightStrips(item) {
	if (!item || typeof item !== 'object') return false;
	const type = item.type;
	if (type === 'tip' || type === 'blog_post' || type === 'engagement') return false;
	if (isFeedRowVideoCreation(item)) return false;
	const rawId = item.created_image_id ?? item.id;
	if (rawId == null || rawId === '') return false;
	return true;
}

/**
 * Challenge promo card from `/api/feed` (`type: "engagement"`, `variant: "challenge_stats"`).
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
function isChallengeEngagementFeedRow(item) {
	if (!item || typeof item !== 'object') return false;
	if (item.type !== 'engagement') return false;
	const v = typeof item.variant === 'string' ? item.variant.trim().toLowerCase() : '';
	return v === 'challenge_stats' || v === 'contest_stats';
}

/**
 * @param {object[]} items — mutable pool in feed order
 * @param {(it: object) => boolean} predicate
 * @returns {object | null}
 */
function spliceFirstFeedPoolMatch(items, predicate) {
	if (!Array.isArray(items)) return null;
	for (let i = 0; i < items.length; i += 1) {
		if (predicate(items[i])) {
			return items.splice(i, 1)[0];
		}
	}
	return null;
}

/**
 * First `max` video creations in feed order, plus remaining rows with those creations removed (no duplicate cards below).
 * @param {object[]} ordered
 * @param {number} [max]
 * @returns {{ spotlightVideos: object[], remainingItems: object[] }}
 */
export function partitionFeedVideosForChatSpotlight(ordered, max = 4) {
	const lim = Math.max(0, Math.min(10, Number(max) || 4));
	const spotlightVideos = [];
	const takenIds = new Set();
	if (Array.isArray(ordered)) {
		for (const item of ordered) {
			if (spotlightVideos.length >= lim) break;
			if (!isFeedRowVideoCreation(item)) continue;
			const rawId = item.created_image_id ?? item.id;
			if (rawId == null || rawId === '') continue;
			spotlightVideos.push(item);
			takenIds.add(String(rawId));
		}
	}
	const remainingItems = Array.isArray(ordered)
		? ordered.filter((item) => {
				const rawId = item?.created_image_id ?? item?.id;
				if (rawId == null) return true;
				return !takenIds.has(String(rawId));
			})
		: [];
	return { spotlightVideos, remainingItems };
}

const CHAT_FEED_SPOTLIGHT_GROUP_MAX = 3;
const CHAT_FEED_SPOTLIGHT_VIDEOS = 4;
const CHAT_FEED_BETWEEN_SPOTLIGHT_CREATION_SLOTS = 3;

/** Matches {@link partitionChatFeedMobileAlternating} cycle count (three 2×2 strips). */
export const MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT = CHAT_FEED_SPOTLIGHT_GROUP_MAX;
/** Videos taken into each spotlight strip (feed order). */
export const MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP = CHAT_FEED_SPOTLIGHT_VIDEOS;
/** Non-video creation slots after each spotlight strip (feed order). */
export const MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS = CHAT_FEED_BETWEEN_SPOTLIGHT_CREATION_SLOTS;

/** Structured prefix length for chat slot-pack page one: 3×(4 video + 3 non-video). */
export const MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN =
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT *
	(MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP + MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS);

/** Total 2×2 spotlight cells across three strips (API slot-pack page-one video budget). */
export const MOBILE_CHAT_SPOTLIGHT_VIDEO_CAP =
	CHAT_FEED_SPOTLIGHT_GROUP_MAX * CHAT_FEED_SPOTLIGHT_VIDEOS;

/**
 * @param {object[]} items — mutable pool in feed order
 * @param {number} max
 * @returns {object[]}
 */
function takeNextVideoCreationsForChatSpotlightFromPool(items, max) {
	const out = [];
	let i = 0;
	while (out.length < max && i < items.length) {
		const it = items[i];
		if (isFeedRowVideoCreation(it) && (it.created_image_id != null || it.id != null)) {
			out.push(items.splice(i, 1)[0]);
		} else {
			i += 1;
		}
	}
	return out;
}

/**
 * One between-spotlight row: first and third slots are non-video creations; middle is the challenge
 * engagement card when present, otherwise another image creation. Tips/blog stay in the pool for the tail.
 *
 * @param {object[]} items — mutable pool in feed order
 * @returns {object[]}
 */
function takeNextBetweenSpotlightThreeSlotStripFromPool(items) {
	const chunk = [];
	const first = spliceFirstFeedPoolMatch(items, isFeedRowImageCreationBetweenSpotlightStrips);
	if (first) chunk.push(first);

	let middle =
		spliceFirstFeedPoolMatch(items, isChallengeEngagementFeedRow) ||
		spliceFirstFeedPoolMatch(items, isFeedRowImageCreationBetweenSpotlightStrips);
	if (middle) chunk.push(middle);

	const third = spliceFirstFeedPoolMatch(items, isFeedRowImageCreationBetweenSpotlightStrips);
	if (third) chunk.push(third);

	return chunk;
}

/**
 * Mobile chat #feed: three 2×2 video spotlights; after each strip, three card slots (image, challenge
 * engagement when available, image); then one tail with everything left in feed order.
 *
 * @param {object[]} ordered
 * @returns {{ segments: Array<{ type: 'spotlight', videos: object[] } | { type: 'cards', items: object[] }> }}
 */
export function partitionChatFeedMobileAlternating(ordered) {
	const pool = Array.isArray(ordered) ? ordered.slice() : [];
	/** @type {Array<{ type: 'spotlight', videos: object[] } | { type: 'cards', items: object[] }>} */
	const segments = [];

	for (let g = 0; g < CHAT_FEED_SPOTLIGHT_GROUP_MAX; g += 1) {
		const videos = takeNextVideoCreationsForChatSpotlightFromPool(pool, CHAT_FEED_SPOTLIGHT_VIDEOS);
		segments.push({ type: 'spotlight', videos });
		const chunk = takeNextBetweenSpotlightThreeSlotStripFromPool(pool);
		if (chunk.length > 0) {
			segments.push({ type: 'cards', items: chunk });
		}
	}

	if (pool.length > 0) {
		segments.push({ type: 'cards', items: pool.slice() });
	}

	return { segments };
}
