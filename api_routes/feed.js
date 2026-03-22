import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

/** Tip items shown in the newbie feed to explain following and other features */
const NEWBIE_FEED_TIPS = [
	{
		id: "tip-create",
		title: "Create new images",
		message: "Use the create flow to generate new images. Pick a method, add your ideas, and publish to your profile.",
		cta: "Create",
		ctaRoute: "/create"
	},
	{
		id: "tip-share",
		title: "Share your creations",
		message: "Your published work lives in Creations. Open any creation to get a shareable link, copy it, or share to social.",
		cta: "My creations",
		ctaRoute: "/creations"
	},
	{
		id: "tip-explore",
		title: "Explore other creators",
		message: "Discover what others are making. Follow creators you like and their new posts will show up in your feed.",
		cta: "Explore",
		ctaRoute: "/explore"
	},
	{
		id: "tip-connect-chat",
		title: "Chat on Connect",
		message: "Open hashtag channels and DMs in the app under Connect. It’s the home for text chat here.",
		cta: "Connect",
		ctaRoute: "/connect#chat"
	},
	{
		id: "tip-discord",
		title: "Join our Discord",
		message: "For voice, events, and the wider community outside the app, join our Discord server.",
		cta: "Join Discord",
		ctaRoute: "https://discord.gg/pqzWstTb8f",
		ctaTarget: "_blank"
	},
	{
		id: "tip-help",
		title: "Help & docs",
		message: "Learn how everything works—creating, sharing, following, and more. Check the help section when you need it.",
		cta: "Help",
		ctaRoute: "/help"
	}
];

/** Insert tip items every N creation items in the newbie feed */
const NEWBIE_FEED_TIP_INTERVAL = 10;

export default function createFeedRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/feed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const limit = Math.min(Math.max(1, Number(req.query?.limit) || 20), 100);
		const offset = Math.max(0, Number(req.query?.offset) || 0);

		let rows;
		let hasMore = false;
		let isNewbieFeed = false;

		if (typeof queries.selectFeedItems?.getPage === "function") {
			const page = await queries.selectFeedItems.getPage(user.id, { limit, offset });
			rows = page?.rows ?? [];
			hasMore = Boolean(page?.hasMore);
		} else {
			const all = await queries.selectFeedItems.all(user.id) ?? [];
			rows = all.slice(offset, offset + limit);
			hasMore = all.length > offset + limit;
		}

		// When the user follows nobody, the main feed is empty. Fall back to explore (discovery) feed for this page.
		// Use explore for any offset so infinite scroll works (same limit/offset as the request).
		if (rows.length === 0 && queries.selectExploreFeedItems) {
			const explorePaginated = queries.selectExploreFeedItems.paginated ?? queries.selectExploreFeedItems.getPage;
			if (typeof explorePaginated === "function") {
				const exploreLimit = limit + 1;
				const exploreResult = await explorePaginated(user.id, { limit: exploreLimit, offset });
				const exploreRows = Array.isArray(exploreResult) ? exploreResult : (exploreResult?.rows ?? []);
				if (exploreRows.length > 0) {
					rows = exploreRows.slice(0, limit);
					hasMore = exploreRows.length > limit;
				}
			}
		}

		if (rows.length === 0 && offset === 0 && queries.selectNewbieFeedItems) {
			const newbieRows = await queries.selectNewbieFeedItems.all(user.id) ?? [];
			isNewbieFeed = true;
			rows = newbieRows.slice(0, limit);
			hasMore = newbieRows.length > limit;
		}

		// Only include NSFW items when the user has explicitly enabled NSFW in profile. Default is off.
		const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);

		const transformItem = (item) => {
			const imageUrl = item.url || null;
			// meta may be a JSON string from SQLite; parse once for media_type and video
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
					: (meta && typeof meta.media_type === "string" ? meta.media_type : "image");
			const videoMeta = meta && typeof meta === "object" ? meta.video : null;
			const videoUrl =
				typeof item.video_url === "string" && item.video_url
					? item.video_url
					: (videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path ? videoMeta.file_path : null);

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
				media_type: mediaType,
				video_url: videoUrl
			};
		};

		let itemsWithImages = rows.map(transformItem);
		// When NSFW is not enabled, exclude NSFW items from the feed entirely.
		if (!enableNsfw) {
			itemsWithImages = itemsWithImages.filter((item) => !item.nsfw);
		}

		if (
			offset === 0 &&
			typeof queries.selectPublishedBlogPostsForFeed?.all === "function"
		) {
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

				const blogItems = (blogRows ?? []).map((b) => {
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
				itemsWithImages = [...itemsWithImages, ...blogItems]
					.sort((a, b) =>
						String(b.created_at || "").localeCompare(String(a.created_at || ""))
					)
					.slice(0, limit);
			} catch {
				// ignore blog merge errors
			}
		}

		let items = itemsWithImages;
		if (isNewbieFeed && itemsWithImages.length > 0) {
			items = [];
			let tipIndex = 0;
			for (let i = 0; i < itemsWithImages.length; i++) {
				if (i > 0 && i % NEWBIE_FEED_TIP_INTERVAL === 0 && tipIndex < NEWBIE_FEED_TIPS.length) {
					const tip = NEWBIE_FEED_TIPS[tipIndex];
					items.push({
						type: "tip",
						id: tip.id,
						title: tip.title,
						message: tip.message,
						cta: tip.cta,
						ctaRoute: tip.ctaRoute
					});
					tipIndex += 1;
				}
				items.push(itemsWithImages[i]);
			}
		}

		return res.json({ items, hasMore });
	});

	return router;
}
