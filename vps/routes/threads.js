import express from 'express';
import { requireAuth } from './middleware/auth.js';

export function createThreadsRoutes({ threads }) {
	const router = express.Router();
	router.use('/api/chat', requireAuth, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
	function handle(action) {
		return async (req, res, next) => {
			try { res.json(await action(req)); }
			catch (error) { if (error.status) res.status(error.status).json({ message: error.message }); else next(error); }
		};
	}
	function id(req) {
		const value = Number(req.params.threadId);
		if (!Number.isSafeInteger(value) || value <= 0) throw Object.assign(new Error('Invalid thread id'), { status: 400 });
		return value;
	}
	router.get('/api/chat/threads', handle((req) => threads.inbox(req.auth.userId)));
	router.post('/api/chat/channels', handle((req) => {
		if (req.body?.visibility === 'private') throw Object.assign(new Error('Private channel creation is not available here yet'), { status: 400 });
		return threads.openPublicChannel(req.auth.userId, req.body?.tag ?? req.body?.channel);
	}));
	router.get('/api/chat/unread-summary', handle((req) => threads.unread(req.auth.userId)));
	router.get('/api/chat/threads/:threadId', handle(async (req) => ({ thread: await threads.threadForMember(req.auth.userId, id(req)) })));
	router.get('/api/chat/threads/:threadId/canvases', handle(req => threads.canvases.list(req.auth.userId, id(req))));
	router.post('/api/chat/threads/:threadId/canvases', handle(req => threads.canvases.create(req.auth.userId, id(req), req.body)));
	router.post('/api/chat/threads/:threadId/pinned-canvas', handle(req => threads.canvases.pin(req.auth.userId, id(req), req.body?.message_id)));
	router.get('/api/chat/threads/:threadId/member-status', handle(req => threads.canvases.members(req.auth.userId, id(req))));
	router.get('/api/chat/threads/:threadId/messages', handle((req) => threads.messages(req.auth.userId, id(req), {
		limit: Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 40))), before: req.query.before,
	})));
	router.post('/api/chat/threads/:threadId/messages', handle((req) => threads.send(req.auth.userId, id(req), req.body)));
	router.patch('/api/chat/messages/:messageId', handle((req) => threads.edit(req.auth.userId, Number(req.params.messageId), req.body)));
	router.post('/api/chat/messages/:messageId/reactions', handle((req) => threads.react(req.auth.userId, Number(req.params.messageId), req.body)));
	router.delete('/api/chat/messages/:messageId', handle((req) => threads.remove(req.auth.userId, Number(req.params.messageId))));
	router.post('/api/chat/threads/:threadId/read', handle((req) => threads.markRead(req.auth.userId, id(req), req.body?.last_read_message_id)));
	router.get('/api/chat/threads/:threadId/private-key', handle((req) => threads.getPrivateKey(req.auth.userId, id(req))));
	return router;
}
