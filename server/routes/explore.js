import express from 'express';
import { requireAuth } from './middleware/auth.js';
import { serializeCreation } from './creations.js';
export function createExploreRoutes({ explore, users }) {
 const router = express.Router();
 router.use('/api/explore', requireAuth, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
 for (const [path, mode] of [['/api/explore', 'browse'], ['/api/explore/search', 'keyword'], ['/api/explore/search/semantic', 'semantic']]) {
  router.get(path, async (req, res, next) => {
   try {
    const viewer = await users.byId(req.auth.userId); if (!viewer) return res.status(401).json({ error: 'Unauthorized' });
    const options = { limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50)), offset: Math.max(0, Number.parseInt(req.query.offset, 10) || 0), q: String(req.query.q || '').trim().slice(0, 500), semantic: mode === 'semantic' };
    const page = mode === 'browse' ? await explore.browse(viewer, options) : await explore.search(viewer, options);
    return res.json({ items: page.rows.map(row => ({ ...serializeCreation(row), created_image_id: row.id, summary: row.summary, tags: row.tags, author: row.author, author_user_name: row.author_user_name, author_display_name: row.author_display_name, author_avatar_url: row.author_avatar_url, author_plan: row.author_plan, image_url: serializeCreation(row).url, like_count: row.like_count, comment_count: row.comment_count, viewer_liked: row.viewer_liked, liked_by: row.liked_by, commented_by: row.commented_by })), hasMore: page.hasMore });
   } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  });
 }
 return router;
}
