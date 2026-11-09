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
	router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
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
	function jsonMeta(value) {
		if (value && typeof value === 'object' && !Array.isArray(value)) return value;
		if (typeof value !== 'string') return {};
		try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
	}
	function decodeGeo(value) {
		if (typeof value !== 'string' || !value.trim()) return null;
		try { return decodeURIComponent(value.trim()) || null; } catch { return value.trim(); }
	}
	function requestMetaFields(meta) {
		return {
			prsn_cid: meta.prsn_cid || meta.client_id || null,
			user_agent: meta.user_agent || null,
			ip: meta.ip || null,
			ip_source: meta.ip_source || null,
			country: decodeGeo(meta.country), region: decodeGeo(meta.region), city: decodeGeo(meta.city),
			cf_ray: meta.cf_ray || null
		};
	}
	async function tableRows(table, select, orderColumn) {
		const rows = [];
		const chunkSize = 1000;
		for (let offset = 0; ; offset += chunkSize) {
			const result = await client.from(`prsn_${table}`).select(select).order(orderColumn, { ascending: false }).range(offset, offset + chunkSize - 1);
			if (result.error) throw result.error;
			rows.push(...(result.data || []));
			if (!result.data || result.data.length < chunkSize) break;
		}
		return rows;
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
		['try-requests', 'try_requests', 'id,created_at,fulfilled_at,created_image_anon_id,prompt,meta,anon_cid', ['id', 'created_at', 'anon_cid']],
		['blog-views', 'blog_post_views', 'id,viewed_at,blog_post_id,post_slug,campaign_id,referer,anon_cid,meta', ['id', 'viewed_at', 'blog_post_id', 'post_slug', 'campaign_id', 'referer', 'anon_cid']]
	]) router.get(`/api/admin-tools/${route}`, guard(async (req, res) => {
		const result = await rows(table, select, req, sortCols, route === 'try-requests' ? 'created_at' : 'viewed_at');
		const pageItems = result.items || [];
		if (route === 'share-views') {
			const ids = [...new Set(pageItems.flatMap((item) => [item.sharer_user_id, item.created_by_user_id]).filter((id) => id != null).map(Number))];
			const [profileResult, userResult] = ids.length ? await Promise.all([
				client.from('prsn_user_profiles').select('user_id,user_name,display_name').in('user_id', ids),
				client.from('prsn_users').select('id,email').in('id', ids)
			]) : [{ data: [] }, { data: [] }];
			if (profileResult.error) throw profileResult.error;
			if (userResult.error) throw userResult.error;
			const profiles = new Map((profileResult.data || []).map((row) => [Number(row.user_id), row]));
			const emails = new Map((userResult.data || []).map((row) => [Number(row.id), row.email]));
			const label = (id) => { const profile = profiles.get(Number(id)); return profile?.display_name?.trim() || profile?.user_name?.trim() || (emails.get(Number(id)) || '').split('@')[0] || `#${id}`; };
			result.items = pageItems.map((item) => ({ ...item, ...requestMetaFields(jsonMeta(item.meta)), sharer_label: label(item.sharer_user_id), creator_label: label(item.created_by_user_id) }));
		} else if (route === 'blog-views') {
			const [postsResult, campaignResult] = await Promise.all([
				client.from('prsn_blog_posts').select('slug,title'),
				client.from('prsn_blog_campaigns').select('id,label')
			]);
			if (postsResult.error) throw postsResult.error;
			if (campaignResult.error) throw campaignResult.error;
			const posts = new Map((postsResult.data || []).map((row) => [row.slug, row.title]));
			const campaigns = new Map((campaignResult.data || []).map((row) => [row.id, row.label]));
			result.items = pageItems.map((item) => {
				const campaign = String(item.campaign_id || '').trim();
				const source = !campaign ? 'Organic' : campaign === 'n' ? 'Feed' : campaign === 'i' ? 'Blog Index' : campaigns.get(campaign) || campaign;
				return { ...item, ...requestMetaFields(jsonMeta(item.meta)), post_label: posts.get(item.post_slug) || item.post_slug || '—', source_label: source };
			});
		} else {
			const imageIds = [...new Set(pageItems.map((item) => item.created_image_anon_id).filter(Boolean))];
			const imageResult = imageIds.length ? await client.from('prsn_created_images_anon').select('id,filename,status,width,height').in('id', imageIds) : { data: [], error: null };
			if (imageResult.error) throw imageResult.error;
			const images = new Map((imageResult.data || []).map((image) => [Number(image.id), image]));
			result.items = pageItems.map((item) => {
				const image = images.get(Number(item.created_image_anon_id));
				return { ...item, ...requestMetaFields(jsonMeta(item.meta)), status: image?.status || (item.fulfilled_at ? 'fulfilled' : 'pending'), image: image ? { ...image, image_url: image.filename ? `/api/try/images/${encodeURIComponent(image.filename)}` : null } : null };
			});
		}
		res.json(result);
	}));

	router.get('/api/admin-tools/anonymous-users', guard(async (req, res) => {
		const sourceRows = await tableRows('try_requests', 'id,anon_cid,created_at,meta', 'created_at');
		const summaries = new Map();
		for (const row of sourceRows) {
			const cid = String(row.anon_cid || '').trim();
			if (!cid || cid === '__pool__') continue;
			const meta = jsonMeta(row.meta);
			let item = summaries.get(cid);
			if (!item) { item = { anon_cid: cid, request_count: 0, first_request_at: row.created_at, last_request_at: row.created_at, _latest: row.created_at, _meta: meta, transitioned_user_id: null }; summaries.set(cid, item); }
			item.request_count++;
			if (row.created_at && (!item.first_request_at || row.created_at < item.first_request_at)) item.first_request_at = row.created_at;
			if (row.created_at && row.created_at > item.last_request_at) item.last_request_at = row.created_at;
			if (row.created_at && row.created_at >= item._latest) { item._latest = row.created_at; item._meta = meta; }
			const userId = Number(meta?.transitioned?.user_id);
			if (!item.transitioned_user_id && userId && Number.isFinite(userId)) item.transitioned_user_id = userId;
		}
		const shareRows = await tableRows('share_page_views', 'anon_cid', 'id');
		const shareCids = new Set(shareRows.map((row) => row.anon_cid).filter(Boolean));
		const ids = [...new Set([...summaries.values()].map((row) => row.transitioned_user_id).filter(Boolean))];
		const profilesResult = ids.length ? await client.from('prsn_user_profiles').select('user_id,user_name').in('user_id', ids) : { data: [], error: null };
		if (profilesResult.error) throw profilesResult.error;
		const names = new Map((profilesResult.data || []).map((row) => [Number(row.user_id), row.user_name]));
		const all = [...summaries.values()].map((row) => {
			const { _meta, ...summary } = row;
			return { ...summary, ...requestMetaFields(_meta), source: _meta?.source || null, route: _meta?.route || null, from_share: shareCids.has(row.anon_cid), transitioned_user_name: names.get(row.transitioned_user_id) || null };
		});
		const allowed = new Set(['last_request_at', 'first_request_at', 'request_count', 'anon_cid', 'prsn_cid']);
		const sortBy = allowed.has(req.query.sort_by) ? req.query.sort_by : 'last_request_at';
		const direction = req.query.sort_dir === 'asc' ? 1 : -1;
		all.sort((a, b) => (a[sortBy] == null ? 1 : b[sortBy] == null ? -1 : typeof a[sortBy] === 'number' ? (a[sortBy] - b[sortBy]) * direction : String(a[sortBy]).localeCompare(String(b[sortBy]), undefined, { numeric: true }) * direction));
		const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
		const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
		res.json({ anonCids: all.slice(offset, offset + limit), total: all.length });
	}));
	router.get('/api/admin-tools/anonymous-users/:cid', guard(async (req, res) => {
		const cid = String(req.params.cid || '').trim();
		if (!cid) return res.status(400).json({ error: 'Invalid anonymous id' });
		const result = await client.from('prsn_try_requests').select('id,anon_cid,created_at,fulfilled_at,created_image_anon_id,prompt,meta').eq('anon_cid', cid).order('created_at', { ascending: false });
		if (result.error) throw result.error;
		const requests = result.data || [];
		const ids = [...new Set(requests.map((row) => row.created_image_anon_id).filter(Boolean))];
		const imagesResult = ids.length ? await client.from('prsn_created_images_anon').select('id,filename,file_path,width,height,status,created_at').in('id', ids) : { data: [], error: null };
		if (imagesResult.error) throw imagesResult.error;
		const images = new Map((imagesResult.data || []).map((image) => [Number(image.id), image]));
		res.json({ anon_cid: cid, requests: requests.map((row) => {
			const image = images.get(Number(row.created_image_anon_id));
			return { ...row, ...requestMetaFields(jsonMeta(row.meta)), status: image?.status || (row.fulfilled_at ? 'fulfilled' : 'pending'), image: image ? { ...image, image_url: image.filename ? `/api/try/images/${encodeURIComponent(image.filename)}` : null } : null };
		}) });
	}));

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
