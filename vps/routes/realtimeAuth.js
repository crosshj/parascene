import express from 'express';
import { requireAuth } from './middleware/auth.js';

export function createRealtimeAuthRoutes({ realtimeAuth }) {
	const router = express.Router();
	router.post('/api/auth/supabase-session', requireAuth, async (req, res, next) => {
		res.set('Cache-Control', 'no-store');
		try { res.json(await realtimeAuth.session(req.auth.userId)); }
		catch (error) { if (error.status) res.status(error.status).json({ message: error.message }); else next(error); }
	});
	return router;
}
