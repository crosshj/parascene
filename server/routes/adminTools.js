import express from 'express';
import { renderEmailTemplate, sendTemplatedEmail } from '../email/index.js';
import { getEmailTemplateSampleData } from '../email/sampleData.js';
import { loadEditorialPinPolicyDocument, parseEditorialPinPolicyDocument, serializeEditorialPinPolicyDocument, validateEditorialPinPolicyDocument, FEED_EDITORIAL_PINS_POLICY_KEY } from '../services/feed/editorialPinPolicy.js';
import { bumpFeedVersionCounter } from '../services/feed/feedVersion.js';
import { filterRecommendableCreationIds } from '../services/create/recommendableCreations.js';
import { broadcastChatThreadDeleted } from '../services/challenges/realtimeBroadcast.js';
import { resolveProviderAuthToken } from '../services/create/providerAuth.js';

const RELATED_KEYS = [
	'related.recsys_weight', 'related.semantic_weight', 'related.semantic_weight_no_click_next',
	'related.semantic_distance_max', 'related.lineage_weight', 'related.lineage_min_slots',
	'related.same_server_method_weight', 'related.same_creator_weight', 'related.fallback_weight',
	'related.transition_cap_k', 'related.transition_decay_half_life_days', 'related.transition_window_days',
	'related.random_slots_per_batch', 'related.batch_size', 'related.candidate_cap_per_signal'
];
const EMAIL_DEFAULTS = {
	email_use_test_recipient: 'false', email_dry_run: 'true', digest_utc_windows: '09:00,18:00',
	max_digests_per_user_per_day: '2', digest_activity_hours_lookback: '24', welcome_email_delay_hours: '1',
	reengagement_inactive_days: '14', reengagement_cooldown_days: '30', creation_highlight_lookback_hours: '48',
	creation_highlight_cooldown_days: '7', creation_highlight_min_comments: '1'
};
const EMAIL_KEYS = Object.keys(EMAIL_DEFAULTS);
const TEST_EMAIL_TEMPLATES = [
	'helloFromParascene', 'commentReceived', 'commentReceivedDelegated', 'featureRequest', 'featureRequestFeedback',
	'passwordReset', 'digestActivity', 'welcome', 'firstCreationNudge', 'reengagement', 'creationHighlight', 'supportReport'
];
const EMAIL_TEMPLATE_LABELS = [
	['helloFromParascene', 'Hello from parascene'], ['commentReceived', 'Comment received'],
	['commentReceivedDelegated', 'Comment received (delegated)'], ['featureRequest', 'Feature request'],
	['featureRequestFeedback', 'Feature request feedback'], ['passwordReset', 'Password reset'],
	['digestActivity', 'Digest activity'], ['welcome', 'Welcome'], ['firstCreationNudge', 'First creation nudge'],
	['reengagement', 'Re-engagement'], ['creationHighlight', 'Creation highlight'], ['supportReport', 'Support report'],
	['adminBroadcast', 'Admin broadcast']
];

function parseBroadcastBody(body) {
	const emailSubject = typeof body?.emailSubject === 'string' ? body.emailSubject.trim() : '';
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	const ctaText = typeof body?.ctaText === 'string' ? body.ctaText.trim() : '';
	const ctaUrl = typeof body?.ctaUrl === 'string' ? body.ctaUrl.trim() : '';
	const headline = typeof body?.headline === 'string' && body.headline.trim() ? body.headline.trim() : emailSubject;
	if (!emailSubject) return { ok: false, error: 'Email subject is required for Admin broadcast.' };
	if (!message) return { ok: false, error: 'Message is required for Admin broadcast.' };
	if (!ctaText) return { ok: false, error: 'Button label is required for Admin broadcast.' };
	if (!/^https?:\/\//i.test(ctaUrl)) return { ok: false, error: 'Button URL must start with http:// or https://.' };
	return { ok: true, data: { emailSubject, headline, message, ctaText, ctaUrl } };
}

const settingIsTrue = (value) => ['true', '1'].includes(String(value || '').trim().toLowerCase());

function serverChannelSlug(name) {
	let raw = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
	if (!raw) raw = 'server';
	raw = raw.slice(0, 32).replace(/-+$/g, '');
	if (raw.length < 2) raw = 'server';
	return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(raw) ? raw : 'server';
}

export default function createAdminToolsRoutes({ client, users, servers, queries = {} }) {
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
	router.get('/api/admin-tools/feed-editorial-pins', guard(async (req, res) => {
		const document = await loadEditorialPinPolicyDocument(queries);
		const { limit, offset } = page(req);
		const allowedSort = new Set(['created_image_id', 'enabled', 'until', 'surfaces']);
		const sortBy = allowedSort.has(req.query.sort_by) ? req.query.sort_by : 'created_image_id';
		const direction = req.query.sort_dir === 'asc' ? 1 : -1;
		const items = [...document.pins].sort((a, b) => {
			const left = a[sortBy] ?? '';
			const right = b[sortBy] ?? '';
			return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * direction;
		});
		res.json({ ...document, items: items.slice(offset, offset + limit), total: items.length });
	}));
	async function loadEditorialPinPolicyStrict() {
		if (!queries.selectPolicyByKey?.get) throw new Error('Policy storage unavailable.');
		const row = await queries.selectPolicyByKey.get(FEED_EDITORIAL_PINS_POLICY_KEY);
		if (typeof row?.value !== 'string' || !row.value.trim()) return parseEditorialPinPolicyDocument({});
		try { return parseEditorialPinPolicyDocument(JSON.parse(row.value)); }
		catch { return parseEditorialPinPolicyDocument({}); }
	}
	async function persistEditorialPinPolicy(document) {
		if (!queries.upsertPolicyKey?.run) throw new Error('Policy storage unavailable.');
		const serialized = serializeEditorialPinPolicyDocument(document);
		await queries.upsertPolicyKey.run(FEED_EDITORIAL_PINS_POLICY_KEY, serialized, 'Sitewide editorial feed pins: inject creations on page 1 with placement and display knobs.');
		await bumpFeedVersionCounter(queries);
	}
	router.post('/api/admin-tools/feed-editorial-pins/clear-expired', guard(async (_req, res) => {
		const current = await loadEditorialPinPolicyStrict();
		const now = Date.now();
		const pins = current.pins.filter((pin) => !pin.until || !Number.isFinite(Date.parse(pin.until)) || Date.parse(pin.until) >= now);
		const removed = current.pins.length - pins.length;
		if (removed) await persistEditorialPinPolicy({ defaults: current.defaults, pins });
		res.json({ ...current, pins, removed });
	}));
	router.patch('/api/admin-tools/feed-editorial-pins', guard(async (req, res) => {
		const parsed = parseEditorialPinPolicyDocument(req.body);
		const validated = validateEditorialPinPolicyDocument(parsed);
		if (!validated.ok) return res.status(400).json({ error: validated.error });
		const current = await loadEditorialPinPolicyStrict();
		const previousById = new Map(current.pins.map((pin) => [pin.id, pin]));
		const ids = validated.document.pins
			.filter((pin) => {
				const previous = previousById.get(pin.id);
				return !previous || Number(previous.created_image_id) !== Number(pin.created_image_id);
			})
			.map((pin) => Number(pin.created_image_id));
		if (ids.length) {
			const found = new Set(await filterRecommendableCreationIds(client, ids));
			const missing = ids.filter((id) => !found.has(id));
			if (missing.length) return res.status(400).json({ error: `Creation not found or unavailable: ${missing.join(', ')}` });
		}
		await persistEditorialPinPolicy(validated.document);
		res.json(validated.document);
	}));
	router.get('/api/admin-tools/servers', guard(async (req, res) => {
		const result = await servers.list(req.auth.userId);
		const allowedSort = new Set(['id', 'name', 'status', 'members_count', 'created_at']);
		const sortBy = allowedSort.has(req.query.sort_by) ? req.query.sort_by : 'id';
		const direction = req.query.sort_dir === 'asc' ? 1 : -1;
		const items = [...result.servers].sort((a, b) => String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, { numeric: true }) * direction);
		const { limit, offset } = page(req);
		res.json({ items: items.slice(offset, offset + limit), total: items.length });
	}));
	router.get('/api/admin-tools/servers/:id', guard(async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid server ID' });
		const result = await client.from('prsn_servers').select('id,user_id,name,description,status,status_date,members_count,created_at,updated_at,server_url,auth_token,server_config').eq('id', id).maybeSingle();
		if (result.error) throw result.error;
		if (!result.data) return res.status(404).json({ error: 'Server not found' });
		res.json({ server: result.data });
	}));
	router.put('/api/admin-tools/servers/:id', guard(async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid server ID' });
		const existing = await client.from('prsn_servers').select('id').eq('id', id).maybeSingle();
		if (existing.error) throw existing.error;
		if (!existing.data) return res.status(404).json({ error: 'Server not found' });
		const body = req.body || {};
		const patch = { updated_at: new Date().toISOString() };
		if (body.user_id !== undefined) {
			const userId = Number(body.user_id);
			if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'user_id must be a positive number when provided' });
			patch.user_id = userId;
		}
		if (body.name !== undefined) {
			const name = String(body.name || '').trim();
			if (!name) return res.status(400).json({ error: 'name must be a non-empty string when provided' });
			patch.name = name;
		}
		if (body.status !== undefined) {
			const status = String(body.status || '').trim();
			if (!status) return res.status(400).json({ error: 'status must be a non-empty string when provided' });
			patch.status = status;
		}
		if (body.server_url !== undefined) {
			if (typeof body.server_url !== 'string' || !body.server_url.trim()) return res.status(400).json({ error: 'server_url must be a non-empty string when provided' });
			let url;
			try { url = new URL(body.server_url.trim()); } catch { return res.status(400).json({ error: 'server_url must be a valid URL' }); }
			if (!['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'server_url must be an HTTP or HTTPS URL' });
			patch.server_url = url.toString().replace(/\/$/, '');
		}
		if (body.auth_token !== undefined) {
			if (body.auth_token !== null && typeof body.auth_token !== 'string') return res.status(400).json({ error: 'auth_token must be a string when provided' });
			patch.auth_token = resolveProviderAuthToken(body.auth_token);
		}
		if (body.status_date !== undefined) patch.status_date = body.status_date || null;
		if (body.description !== undefined) patch.description = body.description || null;
		if (body.members_count !== undefined) {
			const count = Number(body.members_count);
			if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: 'members_count must be a non-negative number when provided' });
			patch.members_count = Math.floor(count);
		}
		if (body.server_config !== undefined) {
			let config = body.server_config;
			if (typeof config === 'string') {
				try { config = config.trim() ? JSON.parse(config) : null; } catch { return res.status(400).json({ error: 'server_config must be valid JSON when provided' }); }
			}
			if (config != null && (typeof config !== 'object' || Array.isArray(config))) return res.status(400).json({ error: 'server_config must be a JSON object when provided' });
			patch.server_config = config;
		}
		const result = await client.from('prsn_servers').update(patch).eq('id', id).select('id,user_id,name,description,status,status_date,members_count,created_at,updated_at,server_url,auth_token,server_config').maybeSingle();
		if (result.error) throw result.error;
		if (!result.data) return res.status(500).json({ error: 'Failed to update server' });
		res.json({ success: true, server: result.data });
	}));
	router.get('/api/admin-tools/connect-threads', guard(async (req, res) => {
		const [threadsResult, serversResult] = await Promise.all([
			client.from('prsn_chat_threads').select('id,type,channel_slug,dm_pair_key,created_at').order('id', { ascending: false }),
			client.from('prsn_servers').select('name')
		]);
		if (threadsResult.error) throw threadsResult.error;
		if (serversResult.error) throw serversResult.error;
		const serverSlugs = new Set((serversResult.data || []).map((row) => serverChannelSlug(row.name)));
		const items = (threadsResult.data || []).filter((thread) => {
			if (thread.type === 'dm') return false;
			if (thread.type === 'channel' && thread.channel_slug && serverSlugs.has(String(thread.channel_slug).trim().toLowerCase())) return false;
			return true;
		});
		const allowedSort = new Set(['id', 'type', 'channel_slug', 'created_at']);
		const sortBy = allowedSort.has(req.query.sort_by) ? req.query.sort_by : 'id';
		const direction = req.query.sort_dir === 'asc' ? 1 : -1;
		items.sort((a, b) => String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, { numeric: true }) * direction);
		const { limit, offset } = page(req);
		res.json({ items: items.slice(offset, offset + limit), total: items.length });
	}));
	router.delete('/api/admin-tools/connect-threads/:id', guard(async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid thread id' });
		const [threadResult, membersResult, countResult] = await Promise.all([
			client.from('prsn_chat_threads').select('id,type,channel_slug').eq('id', id).maybeSingle(),
			client.from('prsn_chat_members').select('user_id').eq('thread_id', id),
			client.from('prsn_chat_messages').select('id', { count: 'exact', head: true }).eq('thread_id', id)
		]);
		if (threadResult.error) throw threadResult.error;
		if (membersResult.error) throw membersResult.error;
		if (countResult.error) throw countResult.error;
		if (!threadResult.data) return res.status(404).json({ error: 'Thread not found' });
		if (threadResult.data.type === 'dm') return res.status(400).json({ error: 'Direct messages cannot be removed here' });
		const serverRows = await client.from('prsn_servers').select('name');
		if (serverRows.error) throw serverRows.error;
		const serverSlugs = new Set((serverRows.data || []).map((row) => serverChannelSlug(row.name)));
		if (threadResult.data.type === 'channel' && serverSlugs.has(String(threadResult.data.channel_slug || '').trim().toLowerCase())) {
			return res.status(400).json({ error: 'Server-linked channels cannot be removed here' });
		}
		const { error } = await client.from('prsn_chat_threads').delete().eq('id', id);
		if (error) throw error;
		const memberIds = (membersResult.data || []).map((row) => Number(row.user_id)).filter((value) => Number.isSafeInteger(value) && value > 0);
		void broadcastChatThreadDeleted(id, memberIds);
		res.json({ ok: true, deleted_thread_id: id, removed_messages: countResult.count ?? null, member_count: memberIds.length });
	}));
	async function emailSettings() {
		const result = await client.from('prsn_policy_knobs').select('key,value').in('key', EMAIL_KEYS);
		if (result.error) throw result.error;
		return { ...EMAIL_DEFAULTS, ...Object.fromEntries((result.data || []).map(({ key, value }) => [key, String(value)])) };
	}
	async function emailRecipients() {
		const [allUsers, allProfiles] = await Promise.all([
			tableRows('users', 'id,email,role,meta', 'id'),
			tableRows('user_profiles', 'user_id,user_name,display_name', 'user_id')
		]);
		const eligible = allUsers.filter((user) => {
			const meta = jsonMeta(user.meta);
			return user.role === 'consumer' && meta.suspended !== true && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email || '').trim());
		});
		const profiles = new Map(allProfiles.map((profile) => [Number(profile.user_id), profile]));
		return eligible.map((user) => ({ ...user, ...(profiles.get(Number(user.id)) || {}) }));
	}
	async function broadcastAlreadySent(subject) {
		if (!subject) return new Set();
		const sentIds = new Set();
		for (let offset = 0; ; offset += 1000) {
			const result = await client.from('prsn_email_sends').select('user_id,meta').eq('campaign', 'admin_broadcast').order('id', { ascending: true }).range(offset, offset + 999);
			if (result.error) throw result.error;
			for (const row of result.data || []) {
				if (String(jsonMeta(row.meta).subject || '').trim() === subject && row.user_id != null) sentIds.add(Number(row.user_id));
			}
			if (!result.data || result.data.length < 1000) break;
		}
		return sentIds;
	}
	const campaignUserLabel = (user) => user.user_name?.trim() ? `@${user.user_name.trim()}` : user.display_name?.trim() || String(user.email || '').split('@')[0] || `#${user.id}`;

	router.get('/api/admin-tools/email-sends', guard(async (req, res) => {
		const { limit, offset } = page(req);
		const sort = ['id', 'user_id', 'campaign', 'created_at'].includes(req.query.sort_by) ? req.query.sort_by : 'created_at';
		const result = await client.from('prsn_email_sends').select('id,user_id,campaign,created_at,meta', { count: 'exact' }).order(sort, { ascending: req.query.sort_dir === 'asc' }).range(offset, offset + limit - 1);
		if (result.error) throw result.error;
		const userIds = [...new Set((result.data || []).map((row) => row.user_id).filter((id) => id != null).map(Number))];
		const [usersResult, profileRows] = userIds.length ? await Promise.all([
			client.from('prsn_users').select('id,email').in('id', userIds),
			client.from('prsn_user_profiles').select('user_id,user_name,display_name').in('user_id', userIds)
		]) : [{ data: [], error: null }, { data: [], error: null }];
		if (usersResult.error) throw usersResult.error;
		if (profileRows.error) throw profileRows.error;
		const usersById = new Map((usersResult.data || []).map((user) => [Number(user.id), user]));
		const profilesById = new Map((profileRows.data || []).map((profile) => [Number(profile.user_id), profile]));
		const items = (result.data || []).map((row) => {
			const user = { ...usersById.get(Number(row.user_id)), ...profilesById.get(Number(row.user_id)) };
			return { ...row, user_email: user.email || null, user_label: campaignUserLabel({ ...user, id: row.user_id }) };
		});
		res.json({ items, total: result.count || 0 });
	}));
	router.get('/api/admin-tools/email-settings', guard(async (_req, res) => res.json(await emailSettings())));
	router.patch('/api/admin-tools/email-settings', guard(async (req, res) => {
		for (const [key, raw] of Object.entries(req.body || {})) {
			if (!EMAIL_KEYS.includes(key)) continue;
			let value;
			if (key === 'email_use_test_recipient' || key === 'email_dry_run') {
				if (typeof raw !== 'boolean') continue;
				value = String(raw);
			} else if (key === 'digest_utc_windows') {
				if (typeof raw !== 'string' || !raw.trim() || !raw.split(',').every((part) => /^\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*$/.test(part))) return res.status(400).json({ error: 'Enter comma-separated UTC times such as 09:00,18:00.' });
				value = raw.trim();
			} else {
				const number = Number(raw);
				if (!Number.isInteger(number) || number < (key === 'max_digests_per_user_per_day' || key === 'creation_highlight_min_comments' ? 0 : 1)) return res.status(400).json({ error: `${key.replaceAll('_', ' ')} must be a valid non-negative whole number.` });
				value = String(number);
			}
			const existing = await client.from('prsn_policy_knobs').select('key').eq('key', key).limit(1);
			if (existing.error) throw existing.error;
			const result = existing.data?.length ? await client.from('prsn_policy_knobs').update({ value }).eq('key', key) : await client.from('prsn_policy_knobs').insert({ key, value });
			if (result.error) throw result.error;
		}
		res.json(await emailSettings());
	}));
	router.get('/api/admin-tools/email-recipients', guard(async (_req, res) => {
		const users = await emailRecipients();
		res.json({ items: users.map(({ id, email, user_name, display_name }) => ({ id, email, user_name, display_name, label: campaignUserLabel({ id, email, user_name, display_name }) })), total: users.length });
	}));
	router.get('/api/admin-tools/email-templates', guard(async (_req, res) => res.json({ items: EMAIL_TEMPLATE_LABELS.map(([name, label]) => ({ name, label })) })));
	router.get('/api/admin-tools/email-templates/:templateName', guard(async (req, res) => {
		const templateName = req.params.templateName;
		const sampleData = getEmailTemplateSampleData();
		if (!sampleData[templateName]) return res.status(404).json({ error: 'Unknown email template.' });
		try {
			const actualName = templateName === 'commentReceivedDelegated' ? 'commentReceived' : templateName;
			const rendered = renderEmailTemplate(actualName, sampleData[templateName]);
			res.type('html').send(rendered.html);
		} catch (error) { res.status(500).json({ error: error.message || 'Failed to render template.' }); }
	}));
	router.post('/api/admin-tools/email-templates/adminBroadcast/preview', guard(async (req, res) => {
		const parsed = parseBroadcastBody(req.body);
		if (!parsed.ok) return res.status(400).json({ error: parsed.error });
		try {
			const rendered = renderEmailTemplate('adminBroadcast', { recipientName: 'Alex', ...parsed.data });
			res.type('html').send(rendered.html);
		} catch (error) { res.status(500).json({ error: error.message || 'Failed to render preview.' }); }
	}));
	router.get('/api/admin-tools/broadcast-audience', guard(async (req, res) => {
		const eligible = await emailRecipients();
		const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
		const alreadySent = await broadcastAlreadySent(subject);
		const settings = await emailSettings();
		const alreadySentCount = eligible.filter((user) => alreadySent.has(Number(user.id))).length;
		res.json({ eligibleCount: eligible.length, alreadySentCount, remainingCount: eligible.length - alreadySentCount, dryRun: settingIsTrue(settings.email_dry_run), emailUseTestRecipient: settingIsTrue(settings.email_use_test_recipient) });
	}));
	router.post('/api/admin-tools/send-test-email', guard(async (req, res) => {
		const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
		const templateName = typeof req.body?.template === 'string' ? req.body.template.trim() : '';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid recipient email.' });
		if (!TEST_EMAIL_TEMPLATES.includes(templateName)) return res.status(400).json({ error: 'Choose a supported test template.' });
		const sampleData = getEmailTemplateSampleData();
		const data = sampleData[templateName];
		if (!data) return res.status(400).json({ error: 'Template has no sample data.' });
		if (templateName === 'featureRequestFeedback') {
			if (typeof req.body.recipientName === 'string' && req.body.recipientName.trim()) data.recipientName = req.body.recipientName.trim();
			data.originalRequest = typeof req.body.originalRequest === 'string' ? req.body.originalRequest.trim() : '';
			data.message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
			if (!data.message) return res.status(400).json({ error: 'Enter a reply message for the feature request.' });
		}
		try {
			const result = await sendTemplatedEmail({ to, template: templateName === 'commentReceivedDelegated' ? 'commentReceived' : templateName, data });
			res.json({ ok: true, id: result?.id || null });
		} catch (error) { res.status(502).json({ error: error.message || 'Failed to send email.' }); }
	}));
	router.post('/api/admin-tools/send-broadcast', guard(async (req, res) => {
		const parsed = parseBroadcastBody(req.body);
		if (!parsed.ok) return res.status(400).json({ error: parsed.error });
		const shared = parsed.data;
		const settings = await emailSettings();
		const eligible = await emailRecipients();
		const alreadySent = await broadcastAlreadySent(shared.emailSubject);
		const recipients = eligible.filter((user) => !alreadySent.has(Number(user.id)));
		if (!eligible.length) return res.status(400).json({ error: 'No eligible recipients (active consumers with email).' });
		if (settingIsTrue(settings.email_dry_run)) return res.json({ ok: true, dryRun: true, emailUseTestRecipient: settingIsTrue(settings.email_use_test_recipient), eligible: eligible.length, alreadySent: eligible.length - recipients.length, sent: 0, failed: 0 });
		if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) return res.status(503).json({ error: 'Email delivery is not configured (missing Resend environment variables).' });
		let sent = 0; const errors = [];
		for (let index = 0; index < recipients.length; index++) {
			const user = recipients[index];
			const intendedEmail = String(user.email).trim();
			const to = settingIsTrue(settings.email_use_test_recipient) ? 'delivered@resend.dev' : intendedEmail;
			let delivered = false; let lastError;
			for (let attempt = 0; attempt < 6 && !delivered; attempt++) {
				try {
					if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
					await sendTemplatedEmail({ to, template: 'adminBroadcast', data: { recipientName: user.user_name?.trim() ? `@${user.user_name.trim()}` : user.display_name?.trim() || intendedEmail.split('@')[0], ...shared } });
					delivered = true;
				} catch (error) {
					lastError = error;
					if (!/too many requests|\b429\b/i.test(error.message || '')) break;
				}
			}
			if (delivered) {
				const insert = await client.from('prsn_email_sends').insert({ user_id: user.id, campaign: 'admin_broadcast', meta: { subject: shared.emailSubject } });
				if (insert.error) throw insert.error;
				sent++;
			} else errors.push({ userId: user.id, userName: campaignUserLabel(user), email: intendedEmail, message: lastError?.message || 'Send failed' });
			if (index < recipients.length - 1) await new Promise((resolve) => setTimeout(resolve, 200));
		}
		res.json({ ok: true, dryRun: false, emailUseTestRecipient: settingIsTrue(settings.email_use_test_recipient), eligible: eligible.length, alreadySent: eligible.length - recipients.length, sent, failed: errors.length, errors: errors.length ? errors : undefined });
	}));
	return router;
}
