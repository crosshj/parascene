import express from 'express';

const USERS = 'prsn_users';
const PROFILES = 'prsn_user_profiles';
const CREDITS = 'prsn_user_credits';
const TIPS = 'prsn_tip_activity';
const POLICIES = 'prsn_policy_knobs';

export default function createAdminUsersRoutes({ client, users, storage }) {
	const router = express.Router();
	router.use('/api/admin', (req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		next();
	});

	async function requireAdmin(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: 'Unauthorized' });
			return null;
		}
		const user = await users.byId(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: 'User not found' });
			return null;
		}
		if (user.role !== 'admin') {
			res.status(403).json({ error: 'Admin role required' });
			return null;
		}
		return user;
	}

	router.get('/api/admin/users', async (req, res, next) => {
		try {
			if (!(await requireAdmin(req, res))) return;
			const { data: rows, error } = await client.from(USERS)
				.select('id,email,role,created_at,last_active_at,meta')
				.order('last_active_at', { ascending: false, nullsFirst: false });
			if (error) throw error;
			const segment = req.query.segment === 'other' ? 'other' : 'active';
			const listed = (rows || []).map((row) => {
				const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
				return { ...row, meta, suspended: meta.suspended === true };
			});
			const selected = listed.filter((row) => segment === 'active'
				? row.role === 'consumer' && !row.suspended
				: row.role !== 'consumer' || row.suspended);
			const sortColumns = new Set(['id', 'email', 'role', 'created_at', 'last_active_at']);
			const sortBy = sortColumns.has(req.query.sort_by) ? req.query.sort_by : 'last_active_at';
			const ascending = req.query.sort_dir === 'asc';
			selected.sort((a, b) => {
				const left = a[sortBy] == null ? '' : String(a[sortBy]);
				const right = b[sortBy] == null ? '' : String(b[sortBy]);
				return (left.localeCompare(right, undefined, { numeric: true }) * (ascending ? 1 : -1)) || Number(a.id) - Number(b.id);
			});
			const total = selected.length;
			const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
			const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
			const page = selected.slice(offset, offset + limit);
			const ids = page.map((row) => row.id);
			const [profileResult, creditsResult] = ids.length ? await Promise.all([
				client.from(PROFILES).select('user_id,user_name,display_name,avatar_url').in('user_id', ids),
				client.from(CREDITS).select('user_id,balance').in('user_id', ids)
			]) : [{ data: [] }, { data: [] }];
			if (profileResult.error) throw profileResult.error;
			if (creditsResult.error) throw creditsResult.error;
			const profiles = new Map((profileResult.data || []).map((row) => [Number(row.user_id), row]));
			const balances = new Map((creditsResult.data || []).map((row) => [Number(row.user_id), Number(row.balance) || 0]));
			const items = page.map((row) => ({ ...row, credits: balances.get(Number(row.id)) || 0, ...(profiles.get(Number(row.id)) || {}) }));
			return res.json({ items, total });
		} catch (error) { next(error); }
	});

	router.get('/api/admin/users/:id', async (req, res, next) => {
		try {
			if (!(await requireAdmin(req, res))) return;
			const id = Number(req.params.id);
			if (!Number.isInteger(id) || id <= 0) return next();
			const user = await users.byId(id);
			if (!user) return res.status(404).json({ error: 'User not found' });
			const [profileResult, creditsResult, notificationsResult] = await Promise.all([
				client.from(PROFILES).select('user_name,display_name,about,avatar_url,cover_image_url').eq('user_id', id).maybeSingle(),
				client.from(CREDITS).select('balance').eq('user_id', id).maybeSingle(),
				client.from('prsn_notifications').select('id', { count: 'exact', head: true }).eq('user_id', id).is('acknowledged_at', null)
			]);
			for (const result of [profileResult, creditsResult, notificationsResult]) if (result.error) throw result.error;
			return res.json({
				...user,
				profile: profileResult.data || null,
				credits: Number(creditsResult.data?.balance) || 0,
				unreadNotifications: Number(notificationsResult.count) || 0
			});
		} catch (error) { next(error); }
	});

	router.put('/api/admin/users/:id', async (req, res, next) => {
		try {
			const admin = await requireAdmin(req, res);
			if (!admin) return;
			const id = Number(req.params.id);
			if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
			if (id === Number(admin.id)) return res.status(400).json({ error: 'Cannot suspend the current admin' });
			if (typeof req.body?.suspended !== 'boolean') return res.status(400).json({ error: 'Provide suspended as a boolean' });
			const target = await users.byId(id);
			if (!target) return res.status(404).json({ error: 'User not found' });
			const meta = target.meta && typeof target.meta === 'object' ? target.meta : {};
			const { data, error } = await client.from(USERS).update({ meta: { ...meta, suspended: req.body.suspended } }).eq('id', id).select('id').maybeSingle();
			if (error) throw error;
			if (!data) return res.status(404).json({ error: 'User not found' });
			users.invalidateCache(id);
			return res.json({ ok: true, suspended: req.body.suspended });
		} catch (error) { next(error); }
	});

	async function setFounder(req, res, next, grant) {
		try {
			const admin = await requireAdmin(req, res);
			if (!admin) return;
			const id = Number(req.params.id);
			if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
			const target = await users.byId(id);
			if (!target) return res.status(404).json({ error: 'User not found' });
			const meta = target.meta && typeof target.meta === 'object' ? target.meta : {};
			const gifted = meta.plan === 'founder' && meta.stripeSubscriptionId === 'gifted_founder';
			const paid = meta.plan === 'founder' && meta.stripeSubscriptionId && meta.stripeSubscriptionId !== 'gifted_founder';
			if (grant && paid) return res.status(400).json({ error: 'User has a paid subscription', message: 'Cannot grant gifted founder status to a user with a paid subscription.' });
			if (!grant && !gifted) return res.status(400).json({ error: 'Not a gifted founder' });
			const nextMeta = grant
				? { ...meta, plan: 'founder', stripeSubscriptionId: 'gifted_founder' }
				: { ...meta, plan: 'free', stripeSubscriptionId: null };
			const { error } = await client.from(USERS).update({ meta: nextMeta }).eq('id', id);
			if (error) throw error;
			users.invalidateCache(id);
			return res.json({ ok: true, user: { ...target, meta: nextMeta } });
		} catch (error) { next(error); }
	}
	router.post('/api/admin/users/:id/grant-founder', (req, res, next) => setFounder(req, res, next, true));
	router.post('/api/admin/users/:id/revoke-founder', (req, res, next) => setFounder(req, res, next, false));

	router.delete('/api/admin/users/:id', async (req, res, next) => {
		try {
			const admin = await requireAdmin(req, res);
			if (!admin) return;
			const id = Number(req.params.id);
			if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
			if (id === Number(admin.id)) return res.status(400).json({ error: 'Refusing to delete current admin user' });
			const target = await users.byId(id);
			if (!target) return res.status(404).json({ error: 'User not found' });
			if (String(req.body?.confirmation_email || '').trim().toLowerCase() !== String(target.email || '').trim().toLowerCase()) {
				return res.status(400).json({ error: 'Email confirmation does not match' });
			}
			const remove = async (table, column, value) => {
				const { data, error } = await client.from(`prsn_${table}`).delete().eq(column, value).select('*');
				if (error) throw error;
				return data?.length || 0;
			};
			const removeIn = async (table, column, values) => {
				if (!values?.length) return 0;
				const { data, error } = await client.from(`prsn_${table}`).delete().in(column, values).select('id');
				if (error) throw error;
				return data?.length || 0;
			};
			const { data: images, error: imageError } = await client.from('prsn_created_images').select('id,filename').eq('user_id', id);
			if (imageError) throw imageError;
			const imageIds = (images || []).map((image) => image.id).filter(Boolean);
			const profileResult = await client.from(PROFILES).select('avatar_url,cover_image_url').eq('user_id', id).maybeSingle();
			if (profileResult.error) throw profileResult.error;
			const emailResult = await client.from('prsn_email_sends').select('id').eq('user_id', id);
			if (emailResult.error) throw emailResult.error;
			const emailSendIds = (emailResult.data || []).map((row) => row.id);
			const changes = {};
			for (const [table, column] of [['feed_items', 'created_image_id'], ['likes_created_image', 'created_image_id'], ['comments_created_image', 'created_image_id'], ['tip_activity', 'created_image_id']]) {
				changes[`${table}_for_user_images`] = await removeIn(table, column, imageIds);
			}
			for (const [table, column] of [['likes_created_image', 'user_id'], ['comments_created_image', 'user_id'], ['tip_activity', 'from_user_id'], ['tip_activity', 'to_user_id'], ['created_images', 'user_id'], ['creations', 'user_id'], ['server_members', 'user_id'], ['servers', 'user_id'], ['notifications', 'user_id'], ['sessions', 'user_id'], ['user_credits', 'user_id']]) {
				changes[`${table}_${column}`] = await remove(table, column, id);
			}
			changes.email_link_clicks = await removeIn('email_link_clicks', 'email_send_id', emailSendIds);
			changes.email_sends = await remove('email_sends', 'user_id', id);
			changes.email_user_campaign_state = await remove('email_user_campaign_state', 'user_id', id);
			changes.user_follows_as_follower = await remove('user_follows', 'follower_id', id);
			changes.user_follows_as_following = await remove('user_follows', 'following_id', id);
			changes.user_profile = await remove('user_profiles', 'user_id', id);
			changes.user = await remove('users', 'id', id);
			users.invalidateCache(id);
			for (const image of images || []) {
				if (!image.filename || !storage?.deleteImage) continue;
				try { await storage.deleteImage(image.filename); } catch { /* Best-effort storage cleanup. */ }
			}
			for (const url of [profileResult.data?.avatar_url, profileResult.data?.cover_image_url]) {
				const prefix = '/api/images/generic/';
				if (typeof url === 'string' && url.startsWith(prefix)) {
					let key;
					try { key = url.slice(prefix.length).split('/').map((part) => decodeURIComponent(part)).join('/'); } catch { continue; }
					if (storage?.deleteGenericImage) {
						try { await storage.deleteGenericImage(key); } catch { /* Best-effort storage cleanup. */ }
					}
				}
			}
			return res.json({ ok: true, deleted_user_id: id, changes });
		} catch (error) { next(error); }
	});

	router.get('/api/admin/tips', async (req, res, next) => {
		try {
			if (!(await requireAdmin(req, res))) return;
			const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
			const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
			const validSort = new Set(['id', 'created_at', 'from_user_id', 'to_user_id', 'amount', 'created_image_id']);
			const sortBy = validSort.has(req.query.sort_by) ? req.query.sort_by : 'created_at';
			const ascending = req.query.sort_dir === 'asc';
			const { data: tips, count, error } = await client.from(TIPS)
				.select('id,from_user_id,to_user_id,created_image_id,amount,message,source,meta,created_at', { count: 'exact' })
				.order(sortBy, { ascending, nullsFirst: false })
				.range(offset, offset + limit - 1);
			if (error) throw error;
			const ids = [...new Set((tips || []).flatMap((row) => [row.from_user_id, row.to_user_id]).filter(Boolean))];
			const [profileResult, userResult] = ids.length ? await Promise.all([
				client.from(PROFILES).select('user_id,user_name,display_name').in('user_id', ids),
				client.from(USERS).select('id,email').in('id', ids)
			]) : [{ data: [] }, { data: [] }];
			if (profileResult.error) throw profileResult.error;
			if (userResult.error) throw userResult.error;
			const profiles = new Map((profileResult.data || []).map((row) => [Number(row.user_id), row]));
			const userRows = new Map((userResult.data || []).map((row) => [Number(row.id), row]));
			const username = (id) => profiles.get(Number(id))?.user_name || null;
			const label = (id) => {
				const profile = profiles.get(Number(id));
				const user = userRows.get(Number(id));
				return profile?.user_name || user?.email?.split('@')[0] || `#${id}`;
			};
			return res.json({ items: (tips || []).map((row) => ({
				...row,
				tip_kind: row.source === 'challenge' || row.meta?.challenge_id != null ? 'challenge_prize' : 'user_tip',
				from_user_name: username(row.from_user_id),
				to_user_name: username(row.to_user_id),
				from_label: label(row.from_user_id),
				to_label: label(row.to_user_id)
			})), total: count || 0 });
		} catch (error) { next(error); }
	});

	router.get('/api/admin/users/settings', async (req, res, next) => {
		try {
			if (!(await requireAdmin(req, res))) return;
			const { data, error } = await client.from(POLICIES).select('value').eq('key', 'min_days_before_tip').limit(1).maybeSingle();
			if (error) throw error;
			const parsed = Number.parseInt(data?.value, 10);
			return res.json({ min_days_before_tip: Number.isFinite(parsed) && parsed >= 0 ? parsed : 60 });
		} catch (error) { next(error); }
	});

	router.patch('/api/admin/users/settings', async (req, res, next) => {
		try {
			if (!(await requireAdmin(req, res))) return;
			const value = Number(req.body?.min_days_before_tip);
			if (!Number.isInteger(value) || value < 0) return res.status(400).json({ error: 'Minimum days must be a non-negative whole number' });
			const payload = {
				value: String(value),
				description: 'Minimum days a free user must be present before they can tip.',
				updated_at: new Date().toISOString()
			};
			const existing = await client.from(POLICIES).select('id').eq('key', 'min_days_before_tip').limit(1).maybeSingle();
			if (existing.error) throw existing.error;
			const result = existing.data
				? await client.from(POLICIES).update(payload).eq('key', 'min_days_before_tip')
				: await client.from(POLICIES).insert({ ...payload, key: 'min_days_before_tip' });
			if (result.error) throw result.error;
			return res.json({ min_days_before_tip: value });
		} catch (error) { next(error); }
	});

	return router;
}
