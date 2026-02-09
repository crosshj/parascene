import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

      const itemsWithImages = page.map((item) => {
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

      return res.json({ items: itemsWithImages, hasMore });
    } catch (err) {
      console.error("[explore] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Unable to load explore." });
      }
    }
  });

  return router;
}
