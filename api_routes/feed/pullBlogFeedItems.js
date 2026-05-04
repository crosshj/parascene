/**
 * Published blog posts shaped like feed rows (first feed page merge only).
 * @param {object} queries
 * @param {number} limit — page limit for merged slice after sort
 * @returns {Promise<object[]>}
 */
export async function pullBlogFeedItems(queries, limit) {
	if (typeof queries.selectPublishedBlogPostsForFeed?.all !== "function") {
		return [];
	}
	try {
		const blogRows = await queries.selectPublishedBlogPostsForFeed.all(25);
		const authorIds = [
			...new Set(
				(blogRows ?? [])
					.map((b) => b.author_user_id)
					.filter((id) => id != null && Number.isFinite(Number(id)))
					.map((id) => Number(id))
			)
		];
		let profileMap = new Map();
		let userMap = new Map();
		if (authorIds.length > 0 && typeof queries.selectUserProfilesByUserIds === "function") {
			profileMap = await queries.selectUserProfilesByUserIds(authorIds);
		}
		if (authorIds.length > 0 && typeof queries.selectUsersByIds === "function") {
			userMap = await queries.selectUsersByIds(authorIds);
		} else if (authorIds.length > 0 && queries.selectUserById?.get) {
			await Promise.all(
				authorIds.map(async (uid) => {
					const u = await queries.selectUserById.get(uid);
					if (u) userMap.set(Number(uid), u);
				})
			);
		}

		return (blogRows ?? []).map((b) => {
			const aid =
				b.author_user_id != null && Number.isFinite(Number(b.author_user_id))
					? Number(b.author_user_id)
					: null;
			const prof = aid != null ? profileMap.get(aid) : null;
			const u = aid != null ? userMap.get(aid) : null;
			const userName =
				typeof prof?.user_name === "string" ? prof.user_name.trim() : "";
			const displayName =
				typeof prof?.display_name === "string" ? prof.display_name.trim() : "";
			const author = displayName || userName || "Someone";
			const author_plan = u?.meta?.plan === "founder" ? "founder" : "free";
			return {
				type: "blog_post",
				id: `blog-${b.id}`,
				blog_post_id: b.id,
				title: b.title,
				summary: b.description || "",
				slug: b.slug,
				created_at: b.published_at || b.created_at,
				author,
				author_user_name: userName || null,
				author_display_name: displayName || null,
				author_avatar_url:
					typeof prof?.avatar_url === "string" && prof.avatar_url.trim()
						? prof.avatar_url.trim()
						: null,
				author_plan,
				tags: null,
				image_url: null,
				thumbnail_url: null,
				created_image_id: null,
				user_id: aid,
				like_count: 0,
				comment_count: 0,
				viewer_liked: false,
				nsfw: false,
				media_type: "image",
				video_url: null
			};
		});
	} catch {
		return [];
	}
}
