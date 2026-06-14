import { parseCreationMeta } from "../utils/resolveCreatedImageStorageFilename.js";
import { resolveCreationDisplayMediaUrls } from "../utils/resolveCreationDisplayMedia.js";

/**
 * Map DB feed row → API feed item (creation / explore row).
 * @param {object} item
 */
export function transformFeedCreationRow(item) {
	let meta = item.meta;
	if (typeof meta === "string" && meta) {
		try {
			meta = JSON.parse(meta);
		} catch {
			meta = null;
		}
	}
	const creationId = Number(item.created_image_id || item.id);
	const rawImageUrl =
		(typeof item.url === "string" && item.url.trim()) ||
		(typeof item.image_url === "string" && item.image_url.trim()) ||
		null;
	const media = resolveCreationDisplayMediaUrls({
		row: {
			...item,
			file_path: item.file_path || rawImageUrl,
			url: rawImageUrl,
			video_url: item.video_url
		},
		meta: meta ?? parseCreationMeta(item?.meta),
		creationId
	});
	const imageUrl = media.url;
	const videoUrl = media.video_url;
	const mediaType = media.media_type;

	const feedBetaWhy =
		item.feed_beta_why && typeof item.feed_beta_why === 'object' ? item.feed_beta_why : null;

	return {
		id: item.id,
		title: item.title,
		published: item.published === false || item.published === 0 ? false : true,
		summary: item.summary,
		author: item.author,
		author_user_name: item.author_user_name ?? null,
		author_display_name: item.author_display_name ?? null,
		author_avatar_url: item.author_avatar_url ?? null,
		author_plan: item.author_plan === "founder" ? "founder" : "free",
		tags: item.tags,
		created_at: item.created_at,
		image_url: imageUrl,
		thumbnail_url: media.thumbnail_url,
		created_image_id: item.created_image_id || null,
		user_id: item.user_id || null,
		like_count: Number(item.like_count ?? 0),
		comment_count: Number(item.comment_count ?? 0),
		viewer_liked: Boolean(item.viewer_liked),
		nsfw: !!(item.nsfw),
		meta: meta && typeof meta === "object" ? meta : null,
		media_type: mediaType,
		video_url: videoUrl,
		width: item.width ?? null,
		height: item.height ?? null,
		doom_scroll_full_height:
			meta && typeof meta === "object" && meta.doom_scroll_full_height === true,
		feed_beta_why: feedBetaWhy
	};
}
