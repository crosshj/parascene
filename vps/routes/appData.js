import express from 'express';
import { requireAuth } from './middleware/auth.js';
import { mockThreads } from '../server/mocks/sidebar.js';
import { isDmChatMentionNotification } from '../db/notifications.js';

function utcDayStart(value = new Date()) {
	return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function noStore(_req, res, next) {
	res.set('Cache-Control', 'private, no-store');
	next();
}

function integer(value, fallback, min, max) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function publicNotification(row) {
	let target = row?.target;
	if (typeof target === 'string') {
		try { target = JSON.parse(target); } catch { target = null; }
	}
	return {
		id: row.id,
		title: row.title,
		message: row.message,
		link: row.link,
		type: row.type ?? null,
		created_at: row.created_at,
		acknowledged_at: row.acknowledged_at,
		...(target?.creation_id != null ? { creation_id: Number(target.creation_id) } : {})
	};
}

function serverError(res, next, error) {
	if (error.status) return res.status(error.status).json({ error: error.message });
	return next(error);
}

function publicUserMeta(meta) {
	if (!meta || typeof meta !== 'object') return {};
	const { apiKeyHash, vynlyBearerToken, presence_last_seen_at, appear_offline, chat_private_keys, forceLegacyFeed, ...safe } = meta;
	return safe;
}

export function createAppDataRoutes({ users, credits, notifications, servers }) {
	const router = express.Router();

	router.get('/api/profile', noStore, requireAuth, async (req, res, next) => {
		try {
			const [user, profile, creditRecord] = await Promise.all([
				users.byId(req.auth.userId),
				users.profileByUserId(req.auth.userId),
				credits.get(req.auth.userId)
			]);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const privateMeta = user.meta && typeof user.meta === 'object' ? user.meta : {};
			const meta = publicUserMeta(privateMeta);
			return res.json({
				...user,
				meta,
				credits: Number(creditRecord?.balance) || 0,
				plan: meta.plan || 'free',
				pendingPlanActivation: Boolean(privateMeta.pendingCheckoutSessionId),
				profile: profile || {},
				enableNsfw: meta.enableNsfw === true,
				showOwnPostsInFeed: meta.showOwnPostsInFeed === true,
				audibleNotifications: meta.audibleNotifications !== false,
				hasApiKey: Boolean(privateMeta.apiKeyHash),
				apiKeyPrefix: typeof privateMeta.apiKeyPrefix === 'string' ? privateMeta.apiKeyPrefix : null,
				hasVynlyToken: Boolean(typeof privateMeta.vynlyBearerToken === 'string' && privateMeta.vynlyBearerToken.trim()),
				vynlyTokenPrefix: typeof privateMeta.vynlyTokenPrefix === 'string' ? privateMeta.vynlyTokenPrefix : null
			});
		} catch (error) { return next(error); }
	});

	router.get('/api/users/:id/profile', noStore, requireAuth, async (req, res, next) => {
		try {
			const targetId = Number(req.params.id);
			if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user id' });
			const [viewer, target, profile] = await Promise.all([
				users.byId(req.auth.userId),
				users.byId(targetId),
				users.profileByUserId(targetId)
			]);
			if (!viewer || !target) return res.status(404).json({ error: 'User not found' });
			const isSelf = Number(viewer.id) === targetId;
			const email = String(target.email || '');
			const summary = users.profileStats
				? await users.profileStats(viewer.id, targetId)
				: { creations_total: 0, creations_published: 0, likes_received: 0, followers_count: 0, viewer_follows: false };
			return res.json({
				user: isSelf
					? { id: target.id, email: target.email, role: target.role, created_at: target.created_at }
					: { id: target.id, role: target.role, created_at: target.created_at, email_prefix: email.split('@')[0] || null },
				profile: profile || {},
				plan: target.meta?.plan === 'founder' ? 'founder' : 'free',
				stats: {
					creations_total: summary.creations_total,
					creations_published: summary.creations_published,
					likes_received: summary.likes_received,
					followers_count: summary.followers_count,
					member_since: target.created_at || null
				},
				is_self: isSelf,
				viewer_follows: summary.viewer_follows === true
			});
		} catch (error) { return next(error); }
	});

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
	router.get('/api/servers', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.list(req.auth.userId)); } catch (error) { next(error); }
	});
	router.get('/api/servers/:id', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.getById(req.auth.userId, req.params.id)); }
		catch (error) { return serverError(res, next, error); }
	});
	router.put('/api/servers/:id', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.update(req.auth.userId, req.params.id, req.body || {})); }
		catch (error) { return serverError(res, next, error); }
	});
	router.post('/api/servers/:id/join', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.join(req.auth.userId, req.params.id)); }
		catch (error) { return serverError(res, next, error); }
	});
	router.post('/api/servers/:id/leave', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.leave(req.auth.userId, req.params.id)); }
		catch (error) { return serverError(res, next, error); }
	});
	router.post('/api/servers/:id/test', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.test(req.auth.userId, req.params.id)); }
		catch (error) { return serverError(res, next, error); }
	});
	router.post('/api/servers/:id/refresh', noStore, requireAuth, async (req, res, next) => {
		try { res.json(await servers.refresh(req.auth.userId, req.params.id, req.body || {})); }
		catch (error) { return serverError(res, next, error); }
	});

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

	router.get('/api/notifications/unread-count', noStore, requireAuth, async (req, res, next) => {
		try {
			const user = await users.byId(req.auth.userId);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const summary = notifications ? await notifications.unreadCount(user.id, user.role) : { count: 0, attention: 0, items: [], skipped: [] };
			return res.json({ count: summary.count, attention: summary.attention, items: summary.items, skipped: summary.skipped, viewer_id: Number(req.auth.userId) });
		} catch (error) { return next(error); }
	});
	router.get('/api/notifications', noStore, requireAuth, async (req, res, next) => {
		try {
			const user = await users.byId(req.auth.userId);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const limit = integer(req.query.limit, 25, 1, 200);
			const rows = notifications ? await notifications.list(user.id, user.role, { limit }) : [];
			const visible = rows.filter((row) => !isDmChatMentionNotification(row));
			return res.json({ notifications: visible.map(publicNotification), viewer_id: Number(req.auth.userId) });
		} catch (error) { return next(error); }
	});
	router.post('/api/notifications/acknowledge', noStore, requireAuth, async (req, res, next) => {
		try {
			const user = await users.byId(req.auth.userId);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const updated = notifications ? await notifications.acknowledge(user.id, user.role, req.body?.id) : 0;
			return res.json({ ok: true, updated });
		} catch (error) { return next(error); }
	});
	router.post('/api/notifications/acknowledge-all', noStore, requireAuth, async (req, res, next) => {
		try {
			const user = await users.byId(req.auth.userId);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const updated = notifications ? await notifications.acknowledgeAll(user.id, user.role) : 0;
			return res.json({ ok: true, updated });
		} catch (error) { return next(error); }
	});
	return router;
}
