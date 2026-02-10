import express from "express";
import { Redis } from "@upstash/redis";
import { getThumbnailUrl } from "./utils/url.js";

const MAX_COMMENT_META_SEARCH_IMAGES = 300;
const SEARCH_IDS_REDIS_KEY_PREFIX = "explore:search:ids:v1:";
const SEARCH_IDS_REDIS_TTL_SECONDS = 0.5/*hr*/ * 60/*min*/ * 60/*sec*/; // 0.5 hour

let redis = null;
function getRedis() {
	if (!redis) {
		redis = Redis.fromEnv();
	}
	return redis;
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function mapExploreItemsToResponse(items) {
	const list = Array.isArray(items) ? items : [];
	return list.map((item) => {
		const imageUrl = item?.url || null;
		return {
			id: item?.id,
			title: escapeHtml(item?.title != null ? item.title : "Untitled"),
			summary: escapeHtml(item?.summary != null ? item.summary : ""),
			author: item?.author,
			author_user_name: item?.author_user_name ?? null,
			author_display_name: item?.author_display_name ?? null,
			author_avatar_url: item?.author_avatar_url ?? null,
			tags: item?.tags,
			created_at: item?.created_at,
			image_url: imageUrl,
			thumbnail_url: getThumbnailUrl(imageUrl),
			created_image_id: item?.created_image_id || null,
			user_id: item?.user_id || null,
			like_count: Number(item?.like_count ?? 0),
			comment_count: Number(item?.comment_count ?? 0),
			viewer_liked: Boolean(item?.viewer_liked)
		};
	});
}

function itemMatchesSearch(item, needleLower, extrasByCreationId) {
	if (!needleLower) return true;
	const parts = [];
	if (item?.title) parts.push(String(item.title));
	if (item?.summary) parts.push(String(item.summary));
	if (item?.tags) parts.push(String(item.tags));
	if (item?.author) parts.push(String(item.author));
	if (item?.author_user_name) parts.push(String(item.author_user_name));
	if (item?.author_display_name) parts.push(String(item.author_display_name));

	// Include any additional search blob for this creation (comments, metadata, etc.)
	const createdImageId = item?.created_image_id;
	if (createdImageId != null && createdImageId !== undefined && extrasByCreationId) {
		const extra = extrasByCreationId.get(String(createdImageId));
		if (extra) parts.push(extra);
	}

	const haystack = parts.join(" ").toLowerCase();
	return haystack.includes(needleLower);
}

export default function createExploreRoutes({ queries }) {
	const router = express.Router();

	// Explore: paginated published creations (newest first).
	// Excludes items from users that the current user follows.
	router.get("/api/explore", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth?.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const exploreQueries = queries.selectExploreFeedItems;
			const paginated = exploreQueries?.paginated;
			if (typeof paginated !== "function") {
				return res.status(500).json({ error: "Explore feed not available" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 24), 100);
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

			const items = await paginated.call(exploreQueries, user.id, { limit: limit + 1, offset });
			const list = Array.isArray(items) ? items : [];
			const hasMore = list.length > limit;
			const page = hasMore ? list.slice(0, limit) : list;

			const itemsWithImages = mapExploreItemsToResponse(page);

			return res.json({ items: itemsWithImages, hasMore });
		} catch (err) {
			console.error("[explore] Error:", err);
			if (!res.headersSent) {
				res.status(500).json({ error: "Unable to load explore." });
			}
		}
	});

	// Text search across all feed items (both people you follow and the broader explore feed).
	// For now this does an in-memory filter over the combined feed items:
	// title, summary, tags, author, author_display_name, author_user_name.
	// This keeps behavior consistent across adapters and can be upgraded to
	// full-text search (including metadata and comments) without changing the API.
	router.get("/api/explore/search", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth?.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const rawQuery = String(req.query.q || "").trim();
			if (!rawQuery) {
				return res.json({ items: [], hasMore: false });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

			const exploreQueries = queries.selectExploreFeedItems;
			const feedQueries = queries.selectFeedItems;

			// Load both explore items (people you don't follow) and feed items
			// (people you do follow), then union them so search covers all
			// creations visible in the product.
			const [exploreItems, feedItems] = await Promise.all([
				typeof exploreQueries?.all === "function" ? exploreQueries.all(user.id) : [],
				typeof feedQueries?.all === "function" ? feedQueries.all(user.id) : []
			]);

			const combined = [...(Array.isArray(exploreItems) ? exploreItems : []), ...(Array.isArray(feedItems) ? feedItems : [])];

			// De-duplicate by created_image_id when available, otherwise by feed item id.
			const uniqueByCreation = new Map();
			for (const item of combined) {
				if (!item) continue;
				const key =
					item.created_image_id != null && item.created_image_id !== undefined
						? `img:${String(item.created_image_id)}`
						: item.id != null
							? `feed:${String(item.id)}`
							: null;
				if (!key) continue;
				if (!uniqueByCreation.has(key)) {
					uniqueByCreation.set(key, item);
				}
			}

			const list = Array.from(uniqueByCreation.values());

			// Try to reuse cached search results (normalized query -> ordered list of created_image_ids).
			const normalizedQuery = rawQuery.toLowerCase();
			const idsCacheKey = SEARCH_IDS_REDIS_KEY_PREFIX + normalizedQuery;
			let cachedIds = null;
			try {
				const cachedVal = await getRedis().get(idsCacheKey);
				if (Array.isArray(cachedVal)) {
					cachedIds = cachedVal;
				} else if (typeof cachedVal === "string" && cachedVal.trim().length > 0) {
					try {
						const parsed = JSON.parse(cachedVal);
						if (Array.isArray(parsed)) cachedIds = parsed;
					} catch {
						// ignore parse failures
					}
				}
			} catch {
				// ignore Redis failures and fall back to DB search
			}

			let filtered = null;

			if (Array.isArray(cachedIds) && cachedIds.length > 0 && queries.selectFeedItemsByCreationIds?.all) {
				// Fast path: use cached ID list and fetch just those creations, preserving order.
				try {
					const items = await queries.selectFeedItemsByCreationIds.all(cachedIds);
					filtered = Array.isArray(items) ? items : [];
				} catch {
					// If this optimized path fails, fall back to full in-memory search.
					filtered = null;
				}
			}

			if (!Array.isArray(filtered)) {
				// Build supplemental search blobs (comments + metadata) for a capped set of creations.
				const createdImageIds = Array.from(
					new Set(
						list
							.map((item) => item?.created_image_id)
							.filter((id) => id !== null && id !== undefined)
							.map((id) => Number(id))
							.filter((id) => Number.isFinite(id) && id > 0)
					)
				).slice(0, MAX_COMMENT_META_SEARCH_IMAGES);

				const extrasByCreationId = new Map();
				if (createdImageIds.length > 0) {
					const tasks = createdImageIds.map(async (imageId) => {
						let descriptionText = "";
						let metaText = "";
						let commentsText = "";

						try {
							if (queries.selectCreatedImageByIdAnyUser?.get) {
								const image = await queries.selectCreatedImageByIdAnyUser.get(imageId);
								if (image) {
									if (image.description) descriptionText = String(image.description);
									if (image.meta != null) {
										if (typeof image.meta === "string") {
											metaText = image.meta;
										} else {
											try {
												metaText = JSON.stringify(image.meta);
											} catch {
												metaText = "";
											}
										}
									}
								}
							}
						} catch {
							// ignore per-image metadata failures
						}

						try {
							if (queries.selectCreatedImageComments?.all) {
								const comments =
									(await queries.selectCreatedImageComments.all(imageId, {
										order: "asc",
										limit: 100,
										offset: 0
									})) ?? [];
								commentsText = comments
									.map((c) => (c && typeof c.text === "string" ? c.text : ""))
									.filter(Boolean)
									.join(" ");
							}
						} catch {
							// ignore per-image comments failures
						}

						const blob = [descriptionText, metaText, commentsText]
							.filter((part) => typeof part === "string" && part.trim().length > 0)
							.join(" ");

						if (blob) {
							const lower = blob.toLowerCase();
							extrasByCreationId.set(String(imageId), lower);
						}
					});

					await Promise.all(tasks);
				}

				const needleLower = normalizedQuery;
				filtered = list.filter((item) => itemMatchesSearch(item, needleLower, extrasByCreationId));

				// Cache ordered list of created_image_ids for this query.
				// This cache is shared across users because search spans all published creations.
				try {
					const idsForCache = filtered
						.map((item) => (item && item.created_image_id != null ? Number(item.created_image_id) : null))
						.filter((id) => Number.isFinite(id) && id > 0);
					if (idsForCache.length > 0) {
						await getRedis().set(idsCacheKey, idsForCache, { ex: SEARCH_IDS_REDIS_TTL_SECONDS });
					}
				} catch {
					// ignore Redis cache failures
				}
			}

			// Always sort results by created_at (newest first) before pagination.
			if (Array.isArray(filtered) && filtered.length > 1) {
				filtered = filtered
					.slice()
					.sort((a, b) => {
						const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
						const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
						return bTime - aTime;
					});
			}

			const sliceStart = offset;
			const sliceEnd = offset + limit + 1;
			const windowItems = filtered.slice(sliceStart, sliceEnd);
			const hasMore = windowItems.length > limit;
			const page = hasMore ? windowItems.slice(0, limit) : windowItems;

			const itemsWithImages = mapExploreItemsToResponse(page);

			return res.json({ items: itemsWithImages, hasMore });
		} catch (err) {
			console.error("[explore search] Error:", err);
			if (!res.headersSent) {
				res.status(500).json({ error: "Unable to search explore." });
			}
		}
	});

	return router;
}
