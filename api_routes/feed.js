import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

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

    const items = await queries.selectFeedItems.all();
    
    // Transform items to include image_url when created_image_id exists
    const itemsWithImages = items.map((item) => {
      const imageUrl = item.url || null;
      return {
        id: item.id,
        title: item.title,
        summary: item.summary,
        author: item.author,
        tags: item.tags,
        created_at: item.created_at,
        image_url: imageUrl,
        thumbnail_url: getThumbnailUrl(imageUrl),
        created_image_id: item.created_image_id || null,
        user_id: item.user_id || null
      };
    });
    
    return res.json({ items: itemsWithImages });
  });

  return router;
}
