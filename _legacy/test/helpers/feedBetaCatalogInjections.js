import { FIXTURE_VIDEO_PLACEHOLDER_URL } from './feedBetaProdCatalog.js';

/** High IDs — do not collide with prod fixture creation ids. */
export const INJECT_ID = {
	HOT_VIRAL: 9_100_001,
	RECENT_QUIET: 9_100_002,
	FOLLOWED_NEW: 9_100_101,
	FOLLOWED_AUTHOR: 9_100_111,
	NEWCOMER_NEW: 9_100_201,
	NEWCOMER_AUTHOR: 9_100_211,
	BURST_AUTHOR: 9_100_301,
	BURST_FIRST: 9_100_310,
	NEW_PUBLISH_AUTHOR: 9_100_401,
	NEW_PUBLISH_ANCHOR: 9_100_409,
	NEW_PUBLISH_POST: 9_100_402,
	ENGAGE_QUIET: 9_100_501,
	ENGAGE_WARM: 9_100_502,
	ENGAGE_HOT: 9_100_503,
	BALANCE_FRESH: 9_100_601,
	BALANCE_ENGAGED: 9_100_602,
	BALANCE_FRESH_BASE: 9_100_610,
	BALANCE_SCROLL_FRESH: 9_100_701,
	BALANCE_SCROLL_ENGAGED: 9_100_702
};

/**
 * @param {object} opts
 * @param {number} opts.createdImageId
 * @param {number} opts.userId
 * @param {number} [opts.ageHours]
 * @param {number} [opts.likeCount]
 * @param {number} [opts.commentCount]
 * @param {'image'|'video'} [opts.mediaType]
 * @param {string|null} [opts.authorCreatedAt] — ISO account created_at for newcomer scoring
 * @param {number} [opts.nowMs]
 */
export function injectCatalogRow(opts) {
	const {
		createdImageId,
		userId,
		ageHours = 0,
		likeCount = 0,
		commentCount = 0,
		mediaType = 'image',
		authorCreatedAt = null,
		nowMs = Date.now()
	} = opts;
	const isVideo = mediaType === 'video';
	const videoUrl = isVideo ? FIXTURE_VIDEO_PLACEHOLDER_URL : null;
	const created_at = new Date(nowMs - ageHours * 60 * 60 * 1000).toISOString();
	const meta = isVideo
		? { media_type: 'video', video: { file_path: videoUrl }, nsfw: false }
		: { media_type: 'image', nsfw: false };
	return {
		created_image_id: createdImageId,
		id: createdImageId,
		user_id: userId,
		created_at,
		like_count: likeCount,
		comment_count: commentCount,
		nsfw: false,
		meta,
		media_type: isVideo ? 'video' : 'image',
		video_url: videoUrl,
		author_created_at: authorCreatedAt,
		viewer_liked: false
	};
}

/**
 * Prod rows older than 7 days — stable background without hundreds of real "new" publishes
 * competing with injected events.
 * @param {object[]} prodCatalog
 */
export function prodCatalogSteadyState(prodCatalog) {
	const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return (Array.isArray(prodCatalog) ? prodCatalog : []).filter(
		(row) => Date.parse(String(row.created_at)) < cutoff
	);
}

/**
 * Prepend injections so they land in the recent catalog batch; override duplicate ids.
 * @param {object[]} prodCatalog
 * @param {object[]} injections
 */
export function mergeProdCatalogWithInjections(prodCatalog, injections) {
	const injectIds = new Set(
		injections.map((row) => String(row.created_image_id ?? row.id))
	);
	const rest = (Array.isArray(prodCatalog) ? prodCatalog : []).filter(
		(row) => !injectIds.has(String(row.created_image_id ?? row.id))
	);
	return [...injections, ...rest];
}

/**
 * @param {Map<number, { created_at: string, user_name?: string }>} authorProfiles
 * @param {number} userId
 * @param {string} createdAtIso
 */
export function setAuthorProfile(authorProfiles, userId, createdAtIso) {
	authorProfiles.set(Number(userId), {
		created_at: createdAtIso,
		user_name: `inject_user_${userId}`
	});
}

/**
 * @param {object[]} rows
 * @param {number} userId
 */
export function countAuthorOnPage(rows, userId) {
	return (Array.isArray(rows) ? rows : []).filter(
		(row) => Number(row.user_id) === Number(userId)
	).length;
}

/**
 * @param {object[]} rows
 * @param {number} createdImageId
 */
export function findRowByCreationId(rows, createdImageId) {
	return (Array.isArray(rows) ? rows : []).find(
		(row) => Number(row.created_image_id) === Number(createdImageId)
	);
}

/**
 * @param {number} burstCount
 * @param {number} [startId]
 */
export function injectBurstFromAuthor(authorId, burstCount, startId = INJECT_ID.BURST_FIRST) {
	const rows = [];
	for (let i = 0; i < burstCount; i += 1) {
		rows.push(
			injectCatalogRow({
				createdImageId: startId + i,
				userId: authorId,
				ageHours: 0.05 + i * 0.001,
				likeCount: 1,
				commentCount: 0
			})
		);
	}
	return rows;
}
