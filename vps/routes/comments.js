import express from 'express';
import { requireAuth } from './middleware/auth.js';
import { serializeCreation } from './creations.js';

function positive(value) { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 }); return id; }
function commentText(value) { const text = typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : ''; if (!text || text.length > 4000) throw Object.assign(new Error(text ? 'Comment too long (max 4000 chars)' : 'Comment text is required'), { status: 400 }); return text; }
export function createCommentsRoutes({ comments, users }) {
 const router = express.Router();
 router.use(['/api/comments', '/api/created-images/:id/comments'], requireAuth, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
 const handle = action => async (req, res, next) => {
  try { const viewer = await users.byId(req.auth.userId); if (!viewer) return res.status(401).json({ error: 'Unauthorized' }); res.json(await action(req, viewer)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
 };
 router.get('/api/comments/latest', handle(async (req, viewer) => {
  const before = req.query.before;
  if (before != null && !Number.isFinite(Date.parse(before))) throw Object.assign(new Error('Invalid comment cursor'), { status: 400 });
  const page = await comments.latest(viewer, { limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50)), before, before_id: req.query.before_id == null ? undefined : positive(req.query.before_id) });
  return { ...page, comments: page.comments.map(row => {
   const creation = serializeCreation({ id: row.created_image_id, user_id: row.created_image_user_id, file_path: row.created_image_url, meta: row.created_image_meta, title: row.created_image_title, published: row.created_image_published, created_at: row.created_image_created_at });
   return { ...row, creation, created_image_url: creation.url, created_image_thumbnail_url: creation.video_thumbnail_url || creation.thumbnail_url };
  }) };
 }));
 router.post('/api/comments/:id/reactions', handle((req, viewer) => comments.react(viewer, positive(req.params.id), String(req.body?.emoji_key || '').trim())));
 router.patch('/api/comments/:id', handle((req, viewer) => comments.update(viewer, positive(req.params.id), commentText(req.body?.text))));
 router.delete('/api/comments/:id', handle((req, viewer) => comments.remove(viewer, positive(req.params.id))));
 router.post('/api/created-images/:id/comments', handle((req, viewer) => comments.post(viewer, positive(req.params.id), commentText(req.body?.text), { ...req.body, ...(req.body?.referenced_comment_id != null ? { referenced_comment_id: positive(req.body.referenced_comment_id) } : {}), ...(req.body?.reply_to_comment_id != null ? { reply_to_comment_id: positive(req.body.reply_to_comment_id) } : {}) })));
 return router;
}
