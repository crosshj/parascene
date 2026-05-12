import { appendCreationIdToMediaUrl, getThumbnailUrl } from "../utils/url.js";

/**
 * Map DB feed row → API feed item (creation / explore row).
 * @param {object} item
 */
export function transformFeedCreationRow(item) {
	const rawImageUrl = item.url || null;
	let meta = item.meta;
	if (typeof meta === "string" && meta) {
		try {
			meta = JSON.parse(meta);
		} catch {
			meta = null;
		}
	}
	const mediaType =
		typeof item.media_type === "string"
			? item.media_type
			: meta && typeof meta.media_type === "string"
				? meta.media_type
				: "image";
	const videoMeta = meta && typeof meta === "object" ? meta.video : null;
	const rawVideoUrl =
		typeof item.video_url === "string" && item.video_url
			? item.video_url
			: videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path
				? videoMeta.file_path
				: null;
	const creationId = Number(item.created_image_id || item.id);
	const imageUrl = appendCreationIdToMediaUrl(rawImageUrl, creationId);
	const videoUrl = appendCreationIdToMediaUrl(rawVideoUrl, creationId);

	return {
		id: item.id,
		title: item.title,
		summary: item.summary,
		author: item.author,
		author_user_name: item.author_user_name ?? null,
		author_display_name: item.author_display_name ?? null,
		author_avatar_url: item.author_avatar_url ?? null,
		author_plan: item.author_plan === "founder" ? "founder" : "free",
		tags: item.tags,
		created_at: item.created_at,
		image_url: imageUrl,
		thumbnail_url: getThumbnailUrl(imageUrl),
		created_image_id: item.created_image_id || null,
		user_id: item.user_id || null,
		like_count: Number(item.like_count ?? 0),
		comment_count: Number(item.comment_count ?? 0),
		viewer_liked: Boolean(item.viewer_liked),
		nsfw: !!(item.nsfw),
		meta: meta && typeof meta === "object" ? meta : null,
		media_type: mediaType,
		video_url: videoUrl,
		doom_scroll_full_height:
			meta && typeof meta === "object" && meta.doom_scroll_full_height === true
	};
}
