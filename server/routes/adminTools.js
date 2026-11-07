import express from 'express';

const RELATED_KEYS = [
	'related.recsys_weight', 'related.semantic_weight', 'related.semantic_weight_no_click_next',
	'related.semantic_distance_max', 'related.lineage_weight', 'related.lineage_min_slots',
	'related.same_server_method_weight', 'related.same_creator_weight', 'related.fallback_weight',
	'related.transition_cap_k', 'related.transition_decay_half_life_days', 'related.transition_window_days',
	'related.random_slots_per_batch', 'related.batch_size', 'related.candidate_cap_per_signal'
];
const EMAIL_KEYS = ['email_use_test_recipient', 'email_dry_run', 'digest_utc_windows', 'max_digests_per_user_per_day', 'digest_activity_hours_lookback', 'welcome_email_delay_hours', 'reengagement_inactive_days', 'reengagement_cooldown_days', 'creation_highlight_lookback_hours', 'creation_highlight_cooldown_days', 'creation_highlight_min_comments'];

export default function createAdminToolsRoutes({ client, users, servers }) {
	const router = express.Router();
	async function admin(req, res) {
		if (!req.auth?.userId) { res.sendStatus(401); return false; }
		const user = await users.byId(req.auth.userId);
		if (user?.role !== 'admin') { res.sendStatus(403); return false; }
		return true;
	}
	function page(req) {
		const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
		const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
		return { limit, offset };
	}
	async function rows(table, select, req, allowedSort, defaultSort = 'created_at') {
		const { limit, offset } = page(req);
		const sort = allowedSort.includes(req.query.sort_by) ? req.query.sort_by : defaultSort;
		const ascending = req.query.sort_dir === 'asc';
		const [result, count] = await Promise.all([
			client.from(`prsn_${table}`).select(select).order(sort, { ascending }).range(offset, offset + limit - 1),
			client.from(`prsn_${table}`).select('id', { count: 'exact', head: true })
		]);
		if (result.error) throw result.error;
		if (count.error) throw count.error;
		return { items: result.data || [], total: count.count || 0 };
	}
	const guard = (handler) => async (req, res, next) => {
		try { if (!(await admin(req, res))) return; await handler(req, res); }
		catch (error) { next(error); }
	};

	router.get('/api/admin-tools/jobs', guard(async (req, res) => {
		const { limit, offset } = page(req);
		let query = client.from('prsn_jobs').select('id,job_type,status,args,meta,created_at,updated_at', { count: 'exact' });
		if (req.query.job_type) query = query.eq('job_type', String(req.query.job_type));
		if (req.query.status) query = query.eq('status', String(req.query.status));
		const sort = ['id', 'job_type', 'status', 'created_at', 'updated_at'].includes(req.query.sort_by) ? req.query.sort_by : 'created_at';
		const result = await query.order(sort, { ascending: req.query.sort_dir === 'asc' }).range(offset, offset + limit - 1);
		if (result.error) throw result.error;
		res.json({ jobs: result.data || [], total: result.count || 0 });
	}));
	router.get('/api/admin-tools/try-failures', guard(async (_req, res) => {
		const result = await client.from('prsn_created_images_anon').select('id,prompt,status,meta,created_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(50);
		if (result.error) throw result.error;
		res.json({ items: result.data || [], total: result.data?.length || 0 });
	}));
	for (const [route, table, select, sortCols] of [
		['share-views', 'share_page_views', 'id,viewed_at,sharer_user_id,created_image_id,created_by_user_id,referer,anon_cid,meta', ['id', 'viewed_at', 'sharer_user_id', 'created_image_id', 'created_by_user_id', 'referer', 'anon_cid']],
		['try-requests', 'try_requests', 'id,created_at,prompt,status,meta,anon_cid', ['id', 'created_at', 'status', 'anon_cid']],
		['blog-views', 'blog_post_views', 'id,viewed_at,blog_post_id,post_slug,campaign_id,referer,anon_cid,meta', ['id', 'viewed_at', 'blog_post_id', 'post_slug', 'campaign_id', 'referer', 'anon_cid']]
	]) router.get(`/api/admin-tools/${route}`, guard(async (req, res) => res.json(await rows(table, select, req, sortCols, route === 'try-requests' ? 'created_at' : 'viewed_at'))));

	router.get('/api/admin-tools/transitions', guard(async (req, res) => {
		const { limit, offset } = page(req);
		const sort = ['from_created_image_id', 'to_created_image_id', 'count', 'last_updated'].includes(req.query.sort_by) ? req.query.sort_by : 'count';
		const [result, count] = await Promise.all([
			client.from('prsn_related_transitions').select('from_created_image_id,to_created_image_id,count,last_updated', { count: 'exact' }).order(sort, { ascending: req.query.sort_dir === 'asc' }).range(offset, offset + limit - 1),
			client.from('prsn_related_transitions').select('from_created_image_id', { count: 'exact', head: true })
		]);
		if (result.error) throw result.error;
		if (count.error) throw count.error;
		res.json({ items: result.data || [], total: count.count || 0 });
	}));
	router.get('/api/admin-tools/related-settings', guard(async (_req, res) => {
		const result = await client.from('prsn_policy_knobs').select('key,value').like('key', 'related.%');
		if (result.error) throw result.error;
		res.json(Object.fromEntries((result.data || []).map(({ key, value }) => [key, value])));
	}));
	router.patch('/api/admin-tools/related-settings', guard(async (req, res) => {
		const values = Object.entries(req.body || {}).filter(([key, value]) => RELATED_KEYS.includes(key) && (typeof value === 'string' || typeof value === 'number'));
		for (const [key, value] of values) {
			const existing = await client.from('prsn_policy_knobs').select('key').eq('key', key).limit(1);
			if (existing.error) throw existing.error;
			const result = existing.data?.length
				? await client.from('prsn_policy_knobs').update({ value: String(value) }).eq('key', key)
				: await client.from('prsn_policy_knobs').insert({ key, value: String(value) });
			if (result.error) throw result.error;
		}
		const result = await client.from('prsn_policy_knobs').select('key,value').like('key', 'related.%');
		if (result.error) throw result.error;
		res.json(Object.fromEntries((result.data || []).map(({ key, value }) => [key, value])));
	}));
	router.get('/api/admin-tools/servers', guard(async (req, res) => {
		const result = await servers.list(req.auth.userId);
		res.json({ items: result.servers, total: result.servers.length });
	}));
	router.get('/api/admin-tools/email-sends', guard(async (req, res) => {
		const { limit, offset } = page(req);
		const result = await client.from('prsn_email_sends').select('id,user_id,campaign,created_at,meta', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
		if (result.error) throw result.error;
		res.json({ items: result.data || [], total: result.count || 0 });
	}));
	router.get('/api/admin-tools/email-settings', guard(async (_req, res) => {
		const result = await client.from('prsn_policy_knobs').select('key,value').in('key', EMAIL_KEYS);
		if (result.error) throw result.error;
		res.json(Object.fromEntries((result.data || []).map(({ key, value }) => [key, value])));
	}));
	router.patch('/api/admin-tools/email-settings', guard(async (req, res) => {
		for (const [key, raw] of Object.entries(req.body || {})) {
			if (!EMAIL_KEYS.includes(key) || !['string', 'number', 'boolean'].includes(typeof raw)) continue;
			const existing = await client.from('prsn_policy_knobs').select('key').eq('key', key).limit(1);
			if (existing.error) throw existing.error;
			const result = existing.data?.length
				? await client.from('prsn_policy_knobs').update({ value: String(raw) }).eq('key', key)
				: await client.from('prsn_policy_knobs').insert({ key, value: String(raw) });
			if (result.error) throw result.error;
		}
		const result = await client.from('prsn_policy_knobs').select('key,value').in('key', EMAIL_KEYS);
		if (result.error) throw result.error;
		res.json(Object.fromEntries((result.data || []).map(({ key, value }) => [key, value])));
	}));
	return router;
}
