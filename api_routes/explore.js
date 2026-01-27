import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

export default function createExploreRoutes({ queries }) {
  const router = express.Router();

  // Explore: show all published creations (newest first).
  // Excludes items from users that the current user follows.
  router.get("/api/explore", async (req, res) => {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await queries.selectUserById.get(req.auth?.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!queries.selectExploreFeedItems?.all) {
      return res.status(500).json({ error: "Explore feed not available" });
    }

    const items = await queries.selectExploreFeedItems.all(user.id);

    const itemsWithImages = (Array.isArray(items) ? items : []).map((item) => {
      const imageUrl = item?.url || null;
      return {
        id: item?.id,
        title: item?.title,
        summary: item?.summary,
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

    return res.json({ items: itemsWithImages });
  });

  return router;
}
