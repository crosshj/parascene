#!/usr/bin/env node
/**
 * Correlate incident identifiers against Parascene DB rows (try flow, profiles, views).
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended; anon may hit RLS).
 *
 * Usage (placeholders only — pass your own values):
 *   node scripts/investigate-suspicious-activity.cjs \
 *     --ip 203.0.113.10 \
 *     --client-id 00000000-0000-4000-8000-000000000001 \
 *     --cf-ray 0000000000000000-AAA
 *
 * Optional:
 *   --anon-cid <ps_cid cookie value>
 *   --email-like <substring>   (ILIKE %substring% on prsn_users.email)
 *   --user-id <id>
 *   --try-limit 300            (max rows per try_requests sub-query)
 *   --json                     (machine-readable output)
 *
 * Example (fabricated identifiers):
 *   node scripts/investigate-suspicious-activity.cjs \
 *     --ip 198.51.100.2 \
 *     --client-id 11111111-1111-4111-8111-111111111111 \
 *     --cf-ray ffffffffffffffff-ORD \
 *     --email-like suspicious_prefix
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function mustEnv(name) {
	const v = process.env[name];
	if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`);
	return String(v).trim();
}

function getArg(name, short) {
	const argv = process.argv.slice(2);
	const long = `--${name}`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long || (short && argv[i] === short)) {
			return argv[i + 1] != null && !argv[i + 1].startsWith('--') ? String(argv[i + 1]).trim() : '';
		}
		const eq = argv[i].startsWith(`${long}=`) ? argv[i].slice(long.length + 1) : null;
		if (eq != null) return String(eq).trim();
	}
	return '';
}

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

function printTitle(title) {
	console.log('\n--- ' + title + ' ---\n');
}

async function queryTryRequests(db, { clientId, ip, cfRay, anonCid, limit }) {
	const cap = Math.min(500, Math.max(1, Number(limit) || 200));
	const select =
		'id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta';
	const out = [];
	const seen = new Set();

	async function push(label, q) {
		const { data, error } = await q.limit(cap);
		if (error) throw new Error(`${label}: ${error.message}`);
		for (const row of data || []) {
			const k = String(row.id);
			if (seen.has(k)) continue;
			seen.add(k);
			out.push({ ...row, _matched_via: label });
		}
	}

	if (clientId) {
		await push('try_requests.meta.client_id', db.from('prsn_try_requests').select(select).eq('meta->>client_id', clientId));
		await push('try_requests.meta.prsn_cid', db.from('prsn_try_requests').select(select).eq('meta->>prsn_cid', clientId));
	}
	if (ip) await push('try_requests.meta.ip', db.from('prsn_try_requests').select(select).eq('meta->>ip', ip));
	if (cfRay) await push('try_requests.meta.cf_ray', db.from('prsn_try_requests').select(select).eq('meta->>cf_ray', cfRay));
	if (anonCid) await push('try_requests.anon_cid', db.from('prsn_try_requests').select(select).eq('anon_cid', anonCid));

	out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
	return out;
}

async function loadAnonImages(db, ids) {
	const clean = [...new Set((ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
	if (clean.length === 0) return [];
	const { data, error } = await db
		.from('prsn_created_images_anon')
		.select('id, prompt, status, created_at, filename, meta')
		.in('id', clean.slice(0, 100));
	if (error) throw new Error(`created_images_anon: ${error.message}`);
	return data || [];
}

async function loadUsers(db, userIds) {
	const clean = [...new Set((userIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
	if (clean.length === 0) return [];
	const { data, error } = await db
		.from('prsn_users')
		.select('id, email, role, created_at, last_active_at, meta')
		.in('id', clean);
	if (error) throw new Error(`prsn_users: ${error.message}`);
	return data || [];
}

async function loadProfilesForUsers(db, userIds) {
	const clean = [...new Set((userIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
	if (clean.length === 0) return [];
	const { data, error } = await db
		.from('prsn_user_profiles')
		.select('user_id, user_name, display_name, meta, updated_at')
		.in('user_id', clean);
	if (error) throw new Error(`prsn_user_profiles: ${error.message}`);
	return data || [];
}

async function searchUsersByEmailLike(db, pattern, limit) {
	const cap = Math.min(200, Math.max(1, Number(limit) || 50));
	if (!pattern) return [];
	const { data, error } = await db
		.from('prsn_users')
		.select('id, email, role, created_at, last_active_at, meta')
		.ilike('email', `%${pattern}%`)
		.order('id', { ascending: false })
		.limit(cap);
	if (error) throw new Error(`users ilike: ${error.message}`);
	return data || [];
}

async function searchProfilesByPrsnCid(db, clientId, limit) {
	const cap = Math.min(200, Math.max(1, Number(limit) || 50));
	if (!clientId) return [];
	// meta.prsn_cids is a JSON array; @> semantics: row array contains this element set.
	const { data, error } = await db
		.from('prsn_user_profiles')
		.select('user_id, user_name, display_name, meta, updated_at')
		.contains('meta', { prsn_cids: [clientId] })
		.limit(cap);
	if (error) throw new Error(`profiles prsn_cids contains: ${error.message}`);
	return data || [];
}

async function searchViewTables(db, { clientId, ip, cfRay, limit }) {
	const cap = Math.min(150, Math.max(1, Number(limit) || 80));
	const results = { share_page_views: [], blog_post_views: [] };
	if (!clientId && !ip && !cfRay) return results;

	const run = async (table, label) => {
		const parts = [];
		const seen = new Set();
		const pushRows = (rows) => {
			for (const row of rows || []) {
				const k = String(row.id);
				if (seen.has(k)) continue;
				seen.add(k);
				parts.push(row);
			}
		};
		const base = () =>
			db.from(table).select('id, viewed_at, referer, anon_cid, meta').order('viewed_at', { ascending: false });
		if (clientId) {
			const r1 = await base().eq('meta->>client_id', clientId).limit(cap);
			if (r1.error) throw new Error(`${label} client_id: ${r1.error.message}`);
			pushRows(r1.data);
			const r2 = await base().eq('meta->>prsn_cid', clientId).limit(cap);
			if (r2.error) throw new Error(`${label} prsn_cid: ${r2.error.message}`);
			pushRows(r2.data);
		}
		if (ip) {
			const r = await base().eq('meta->>ip', ip).limit(cap);
			if (r.error) throw new Error(`${label} ip: ${r.error.message}`);
			pushRows(r.data);
		}
		if (cfRay) {
			const r = await base().eq('meta->>cf_ray', cfRay).limit(cap);
			if (r.error) throw new Error(`${label} cf_ray: ${r.error.message}`);
			pushRows(r.data);
		}
		return parts;
	};

	results.share_page_views = await run('prsn_share_page_views', 'share_page_views');
	results.blog_post_views = await run('prsn_blog_post_views', 'blog_post_views');
	return results;
}

function extractTransitionedUserIds(tryRows) {
	const ids = [];
	for (const r of tryRows || []) {
		const t = r?.meta && typeof r.meta === 'object' ? r.meta.transitioned : null;
		const uid = t && t.user_id != null ? Number(t.user_id) : NaN;
		if (Number.isFinite(uid) && uid > 0) ids.push(uid);
	}
	return ids;
}

async function main() {
	const clientId = getArg('client-id', '');
	const ip = getArg('ip', '');
	const cfRay = getArg('cf-ray', '');
	const anonCid = getArg('anon-cid', '');
	const emailLike = getArg('email-like', '');
	const userIdArg = getArg('user-id', '');
	const tryLimit = getArg('try-limit', '') || '200';
	const asJson = hasFlag('json');

	if (!clientId && !ip && !cfRay && !anonCid && !emailLike && !userIdArg) {
		console.log(`Usage: node scripts/investigate-suspicious-activity.cjs --client-id <uuid> [--ip ...] [--cf-ray ...] [--anon-cid ...] [--email-like <substring>] [--user-id N]`);
		console.log(`Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (strongly recommended)`);
		process.exit(1);
	}

	const url = mustEnv('SUPABASE_URL');
	const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || mustEnv('SUPABASE_ANON_KEY');
	if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.warn('[warn] SUPABASE_SERVICE_ROLE_KEY not set; using anon key — queries may return empty due to RLS.\n');
	}

	const db = createClient(url, key);

	const tryRows = await queryTryRequests(db, {
		clientId,
		ip,
		cfRay,
		anonCid,
		limit: tryLimit
	});

	const anonIds = tryRows.map((r) => r.created_image_anon_id).filter((x) => x != null);
	const anonImages = await loadAnonImages(db, anonIds);

	const transitionedIds = extractTransitionedUserIds(tryRows);
	const explicitUserId = userIdArg ? Number(userIdArg) : NaN;
	const userIdsToLoad = [...new Set([...transitionedIds, ...(Number.isFinite(explicitUserId) && explicitUserId > 0 ? [explicitUserId] : [])])];

	let usersFromEmail = [];
	if (emailLike) usersFromEmail = await searchUsersByEmailLike(db, emailLike, 80);

	const usersFromTransition = userIdsToLoad.length ? await loadUsers(db, userIdsToLoad) : [];
	const profilesTransition = userIdsToLoad.length ? await loadProfilesForUsers(db, userIdsToLoad) : [];

	let profilesPrsnCidHit = [];
	if (clientId) profilesPrsnCidHit = await searchProfilesByPrsnCid(db, clientId, 80);

	const views = await searchViewTables(db, { clientId, ip, cfRay, limit: 80 });

	const payload = {
		identifiers: { clientId: clientId || null, ip: ip || null, cfRay: cfRay || null, anonCid: anonCid || null, emailLike: emailLike || null, userId: userIdArg || null },
		try_requests: tryRows,
		created_images_anon: anonImages,
		users_from_transitioned_try: usersFromTransition,
		profiles_from_transitioned_try: profilesTransition,
		users_email_ilike: usersFromEmail,
		profiles_meta_prsn_cids_contains_client_id: profilesPrsnCidHit,
		share_page_views: views.share_page_views,
		blog_post_views: views.blog_post_views
	};

	if (asJson) {
		console.log(JSON.stringify(payload, null, '\t'));
		return;
	}

	printTitle('Summary');
	console.log(`try_requests matches: ${tryRows.length}`);
	console.log(`created_images_anon (from those rows): ${anonImages.length}`);
	console.log(`users (transitioned + explicit): ${usersFromTransition.length}`);
	console.log(`users (email ILIKE): ${usersFromEmail.length}`);
	console.log(`profiles (meta.prsn_cids @> [client_id]): ${profilesPrsnCidHit.length}`);
	console.log(`share_page_views hits: ${views.share_page_views.length}`);
	console.log(`blog_post_views hits: ${views.blog_post_views.length}`);

	printTitle('try_requests (request meta: ip, client_id, cf_ray live here)');
	console.log(JSON.stringify(tryRows, null, '\t'));

	if (anonImages.length) {
		printTitle('prsn_created_images_anon (linked from try_requests.created_image_anon_id)');
		console.log(JSON.stringify(anonImages, null, '\t'));
	}

	if (usersFromTransition.length || profilesTransition.length) {
		printTitle('Accounts linked via try_requests.meta.transitioned');
		console.log(JSON.stringify({ users: usersFromTransition, profiles: profilesTransition }, null, '\t'));
	}

	if (usersFromEmail.length) {
		printTitle(`prsn_users where email ILIKE %${emailLike}%`);
		console.log(JSON.stringify(usersFromEmail, null, '\t'));
	}

	if (profilesPrsnCidHit.length) {
		printTitle('prsn_user_profiles where meta.prsn_cids contains client id');
		console.log(JSON.stringify(profilesPrsnCidHit, null, '\t'));
	}

	if (views.share_page_views.length || views.blog_post_views.length) {
		printTitle('View tables (share / blog) with same meta keys');
		console.log(JSON.stringify(views, null, '\t'));
	}

	printTitle('Hints');
	console.log('- Correlate cf_ray with Cloudflare / Vercel logs.');
	console.log('- Same client_id in try_requests.meta often matches prsn_user_profiles.meta.prsn_cids after signup.');
	console.log('- anon_cid is the ps_cid (try session) cookie, distinct from prsn_cid (stable client id).');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
