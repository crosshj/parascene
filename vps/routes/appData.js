import express from 'express';
import { requireAuth } from './middleware/auth.js';
import { mockServers, mockThreads } from '../server/mocks/sidebar.js';

function utcDayStart(value = new Date()) {
	return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function noStore(_req, res, next) {
	res.set('Cache-Control', 'private, no-store');
	next();
}

export function createAppDataRoutes({ users, credits }) {
	const router = express.Router();

	// Mock-backed for beta, shaped like www's chat/servers APIs so view contracts
	// can move over without inventing a parallel client-side data model.
	router.get('/api/chat/threads', noStore, requireAuth, (req, res) => res.json({
		viewer_id: Number(req.auth.userId), viewer_is_admin: false,
		viewer_is_founder: false, viewer_can_pin_messages: false,
		threads: mockThreads(req.auth.userId)
	}));
	router.get('/api/chat/unread-summary', noStore, requireAuth, (req, res) => {
		const threads = mockThreads(req.auth.userId);
		const challengesUnread = 1;
		const total = threads.reduce((sum, thread) => sum + (Number(thread.unread_count) || 0), 0) + challengesUnread;
		return res.json({ total_unread: total, chat_unread: total - challengesUnread, challenges_unread: challengesUnread, viewer_id: Number(req.auth.userId) });
	});
	router.get('/api/servers', noStore, requireAuth, (req, res) => res.json({
		servers: mockServers(), viewer_is_admin: false
	}));

	router.get('/api/credits', noStore, requireAuth, async (req, res, next) => {
		try {
			const [record, user] = await Promise.all([credits.get(req.auth.userId), users.byId(req.auth.userId)]);
			const lastClaim = record.last_daily_claim_at ? new Date(record.last_daily_claim_at) : null;
			const canClaim = user?.role !== 'admin' && (!lastClaim || utcDayStart(lastClaim) < utcDayStart());
			return res.json({ viewer_id: Number(req.auth.userId), balance: Number(record.balance) || 0, canClaim, lastClaimDate: record.last_daily_claim_at || null, topupPacks: [] });
		} catch (error) { return next(error); }
	});
	router.post('/api/credits/claim', noStore, requireAuth, async (req, res, next) => {
		try {
			const user = await users.byId(req.auth.userId);
			if (user?.role === 'admin') return res.status(403).json({ error: 'Forbidden', message: 'Admins cannot claim daily credits' });
			const result = await credits.claimDaily(req.auth.userId, 10);
			return res.status(result.success ? 200 : 400).json({ ...result, viewer_id: Number(req.auth.userId) });
		} catch (error) { return next(error); }
	});
	return router;
}
