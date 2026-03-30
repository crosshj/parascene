#!/usr/bin/env node
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_EMAIL = 'spacetime213y@gmail.com';
const args = process.argv.slice(2);
const EMAIL_ARG = args.find((a) => a.includes('@')) || '';
const SHOULD_REPAIR = args.includes('--repair');
const SHOULD_REPAIR_FULL = args.includes('--repair-full');
const CORRELATION_WINDOW_MIN = 45;

function getEnv(name) {
	const value = process.env[name];
	if (!value || !String(value).trim()) {
		throw new Error(`Missing required env var: ${name}`);
	}
	return String(value).trim();
}

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function toDate(value) {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function formatIso(value) {
	const d = toDate(value);
	return d ? d.toISOString() : null;
}

function safeMeta(value) {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value;
	return {};
}

function getProfileCharacterDescription(profile) {
	const meta = safeMeta(profile?.meta);
	const raw = meta.character_description;
	return typeof raw === 'string' ? raw.trim() : '';
}

function getWelcomeVersion(profile) {
	const meta = safeMeta(profile?.meta);
	const legacy = meta.onb_version;
	const raw = meta.welcome_version == null ? legacy : meta.welcome_version;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function stepResult({ key, title, completed, reason, evidence = {} }) {
	return { key, title, completed: Boolean(completed), reason, evidence };
}

function uniq(values) {
	return [...new Set((values || []).filter((v) => v != null && String(v).trim() !== '').map((v) => String(v).trim()))];
}

function parseJsonLike(value) {
	if (value && typeof value === 'object') return value;
	if (typeof value !== 'string') return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function lower(value) {
	return String(value || '').trim().toLowerCase();
}

function baseUsernameFromEmail(email) {
	const raw = String(email || '').trim().toLowerCase();
	const local = raw.includes('@') ? raw.split('@')[0] : raw;
	let candidate = local.replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^[^a-z0-9]+/g, '').slice(0, 24);
	if (candidate.length > 0 && candidate.length < 3) candidate = `${candidate}_user`.slice(0, 24);
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(candidate)) return null;
	return candidate;
}

function extractCharacterDescriptionFromWelcomePrompt(prompt) {
	const raw = String(prompt || '').trim();
	if (!raw) return '';
	const firstLine = raw.split('\n')[0] || '';
	const m = /^portrait of\s+(.+?)\.\s*avoid showing body/i.exec(firstLine.trim());
	if (m && m[1]) return m[1].trim();
	return '';
}

async function suggestAvailableUsername(db, email, currentUserId) {
	const base = baseUsernameFromEmail(email) || 'user';
	const tryNames = [base];
	for (let i = 1; i <= 200; i++) {
		const suffix = `_${i}`;
		const trimmed = base.slice(0, Math.max(1, 24 - suffix.length)).replace(/_+$/g, '') || 'user';
		tryNames.push(`${trimmed}${suffix}`);
	}
	for (const candidate of tryNames) {
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(candidate)) continue;
		const { data, error } = await db
			.from('prsn_user_profiles')
			.select('user_id, user_name')
			.eq('user_name', candidate)
			.maybeSingle();
		if (error) throw error;
		if (!data || Number(data.user_id) === Number(currentUserId)) return candidate;
	}
	return null;
}

async function safeSelect(db, table, selectCols, apply) {
	try {
		let q = db.from(table).select(selectCols);
		if (typeof apply === 'function') {
			q = apply(q);
		}
		const { data, error } = await q;
		if (error) return { ok: false, error: error.message || String(error), data: [] };
		return { ok: true, data: Array.isArray(data) ? data : [] };
	} catch (err) {
		return { ok: false, error: err?.message || String(err), data: [] };
	}
}

function printStep(step, idx) {
	const status = step.completed ? 'COMPLETED' : 'MISSING';
	console.log(`${idx + 1}. [${status}] ${step.title}`);
	console.log(`   Why: ${step.reason}`);
}

async function maybeLookupSupabaseAuthUserByEmail(serviceClient, email) {
	if (!serviceClient) {
		return { available: false, found: false, reason: 'SUPABASE_SERVICE_ROLE_KEY not set; skipped auth.users check' };
	}
	try {
		for (let page = 1; page <= 10; page++) {
			const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 200 });
			if (error) throw error;
			const users = data?.users;
			if (!Array.isArray(users) || users.length === 0) {
				break;
			}
			const found = users.find((u) => normalizeEmail(u?.email) === email);
			if (found) {
				return {
					available: true,
					found: true,
					authUserId: found.id || null,
					emailConfirmedAt: found.email_confirmed_at || null,
					createdAt: found.created_at || null
				};
			}
			if (users.length < 200) break;
		}
		return { available: true, found: false };
	} catch (err) {
		return {
			available: true,
			found: false,
			error: err?.message || String(err)
		};
	}
}

async function main() {
	const email = normalizeEmail(EMAIL_ARG || DEFAULT_EMAIL);
	if (!email) {
		throw new Error('Email is required');
	}

	const supabaseUrl = getEnv('SUPABASE_URL');
	const anonKey = getEnv('SUPABASE_ANON_KEY');
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
		? String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim()
		: '';

	const client = createClient(supabaseUrl, anonKey);
	const serviceClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;
	const db = serviceClient || client;

	const userRes = await db
		.from('prsn_users')
		.select('id, email, role, created_at, last_active_at, meta')
		.eq('email', email)
		.maybeSingle();
	if (userRes.error) throw userRes.error;

	const user = userRes.data || null;
	const steps = [];

	steps.push(stepResult({
		key: 'account_created',
		title: 'Account row created in prsn_users (/signup insertUser)',
		completed: Boolean(user),
		reason: user
			? `Found user id ${user.id} with created_at ${formatIso(user.created_at)}`
			: `No row in prsn_users for ${email}`,
		evidence: { userId: user?.id || null, createdAt: user?.created_at || null }
	}));

	if (!user) {
		console.log(`# Signup/Onboarding Diagnostic`);
		console.log(`Email: ${email}`);
		console.log('');
		steps.forEach(printStep);
		console.log('');
		console.log('Conclusion: signup did not persist a user record, so no onboarding steps could start.');
		return;
	}

	const profileRes = await db
		.from('prsn_user_profiles')
		.select('user_id, user_name, display_name, avatar_url, meta, created_at, updated_at')
		.eq('user_id', user.id)
		.maybeSingle();
	if (profileRes.error) throw profileRes.error;
	const profile = profileRes.data || null;

	const sessionsRes = await db
		.from('prsn_sessions')
		.select('id, user_id, expires_at')
		.eq('user_id', user.id);
	if (sessionsRes.error) throw sessionsRes.error;
	const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
	const nowMs = Date.now();
	const activeSessions = sessions.filter((s) => {
		const exp = toDate(s?.expires_at);
		return exp && exp.getTime() > nowMs;
	});

	const createdImagesRes = await db
		.from('prsn_created_images')
		.select('id, filename, file_path, status, published, created_at, meta')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.limit(50);
	if (createdImagesRes.error) throw createdImagesRes.error;
	const createdImages = Array.isArray(createdImagesRes.data) ? createdImagesRes.data : [];

	const tryTransitionRes = await db
		.from('prsn_try_requests')
		.select('id, anon_cid, created_at, fulfilled_at, created_image_anon_id, meta')
		.contains('meta', { transitioned: { user_id: Number(user.id) } })
		.order('created_at', { ascending: false })
		.limit(50);
	const tryTransitions = tryTransitionRes.error ? [] : (Array.isArray(tryTransitionRes.data) ? tryTransitionRes.data : []);

	const userName = isNonEmptyString(profile?.user_name) ? profile.user_name.trim() : '';
	const displayName = isNonEmptyString(profile?.display_name) ? profile.display_name.trim() : '';
	const avatarUrl = isNonEmptyString(profile?.avatar_url) ? profile.avatar_url.trim() : '';
	const characterDescription = getProfileCharacterDescription(profile);
	const welcomeVersion = getWelcomeVersion(profile);

	const hasWelcomeAvatarCreation = createdImages.some((img) => {
		const fn = String(img?.filename || '');
		return fn.startsWith(`welcome_${user.id}_`);
	});
	const hasAnyCompletedCreation = createdImages.some((img) => img?.status === 'completed');

	steps.push(stepResult({
		key: 'session_created',
		title: 'Auth session established after signup/login (cookie + prsn_sessions)',
		completed: sessions.length > 0,
		reason: sessions.length > 0
			? `${sessions.length} session row(s) found, ${activeSessions.length} still active`
			: 'No prsn_sessions rows found for this user',
		evidence: { sessionCount: sessions.length, activeSessionCount: activeSessions.length }
	}));

	steps.push(stepResult({
		key: 'welcome_profile_exists',
		title: 'User reached welcome flow profile state (prsn_user_profiles exists)',
		completed: Boolean(profile),
		reason: profile
			? `Profile row exists (updated_at ${formatIso(profile.updated_at) || 'unknown'})`
			: 'No profile row found',
		evidence: { profileExists: Boolean(profile) }
	}));

	steps.push(stepResult({
		key: 'choose_username',
		title: 'Welcome step: choose username',
		completed: Boolean(userName),
		reason: userName
			? `Username set to @${userName}`
			: 'No username set in prsn_user_profiles.user_name (welcome gate would still block)',
		evidence: { userName: userName || null, welcomeVersion }
	}));

	steps.push(stepResult({
		key: 'character_description',
		title: 'Welcome step: character description provided',
		completed: characterDescription.length >= 12,
		reason: characterDescription.length >= 12
			? `Description length ${characterDescription.length} characters`
			: `Description missing or too short (${characterDescription.length} characters)`,
		evidence: { characterDescriptionLength: characterDescription.length }
	}));

	steps.push(stepResult({
		key: 'avatar_generated',
		title: 'Welcome step: portrait/avatar generated and stored',
		completed: Boolean(avatarUrl) || hasWelcomeAvatarCreation || hasAnyCompletedCreation || tryTransitions.length > 0,
		reason: avatarUrl
			? `Profile avatar_url is set (${avatarUrl})`
			: hasWelcomeAvatarCreation
				? 'Found welcome_* creation image indicating welcome avatar promotion'
				: tryTransitions.length > 0
					? `Found ${tryTransitions.length} transitioned try_request record(s)`
					: hasAnyCompletedCreation
						? 'Found completed creation(s), but no avatar_url on profile'
						: 'No avatar evidence found (no avatar_url, no welcome image, no transitioned try requests)',
		evidence: {
			avatarUrl: avatarUrl || null,
			hasWelcomeAvatarCreation,
			tryTransitionCount: tryTransitions.length,
			completedCreationCount: createdImages.filter((x) => x?.status === 'completed').length
		}
	}));

	const onboardingComplete = Boolean(userName) && welcomeVersion >= 1;
	steps.push(stepResult({
		key: 'welcome_gate_clear',
		title: 'Welcome gate cleared (computeWelcome.required === false)',
		completed: onboardingComplete,
		reason: onboardingComplete
			? `Username present and welcome_version=${welcomeVersion} (gate should allow app access)`
			: `Gate likely still required (user_name=${userName || 'null'}, welcome_version=${welcomeVersion})`,
		evidence: { userName: userName || null, welcomeVersion }
	}));

	const authLookup = await maybeLookupSupabaseAuthUserByEmail(serviceClient, email);

	// Cross-table linkage tracing by known identifiers.
	const profileMeta = safeMeta(profile?.meta);
	const profilePrsnCids = Array.isArray(profileMeta.prsn_cids) ? uniq(profileMeta.prsn_cids) : [];
	const userMeta = safeMeta(user?.meta);
	const transitionedAnonCids = uniq(
		tryTransitions
			.map((r) => r?.anon_cid)
			.filter(Boolean)
	);
	const allAnonCids = uniq([
		...transitionedAnonCids
	]);

	const shareViewsBySharer = await safeSelect(
		db,
		'prsn_share_page_views',
		'id, viewed_at, sharer_user_id, created_image_id, created_by_user_id, anon_cid, meta',
		(q) => q.eq('sharer_user_id', user.id).order('viewed_at', { ascending: false }).limit(100)
	);
	const shareViewsByAnon = allAnonCids.length > 0
		? await safeSelect(
			db,
			'prsn_share_page_views',
			'id, viewed_at, sharer_user_id, created_image_id, created_by_user_id, anon_cid, meta',
			(q) => q.in('anon_cid', allAnonCids).order('viewed_at', { ascending: false }).limit(200)
		)
		: { ok: true, data: [] };

	const tryByAnon = allAnonCids.length > 0
		? await safeSelect(
			db,
			'prsn_try_requests',
			'id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta',
			(q) => q.in('anon_cid', allAnonCids).order('created_at', { ascending: false }).limit(300)
		)
		: { ok: true, data: [] };

	const tryByPrsnCidRows = [];
	for (const cid of profilePrsnCids) {
		const r = await safeSelect(
			db,
			'prsn_try_requests',
			'id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta',
			(q) => q.contains('meta', { prsn_cid: cid }).order('created_at', { ascending: false }).limit(300)
		);
		if (r.ok) tryByPrsnCidRows.push(...r.data);
	}
	const shareByPrsnCidRows = [];
	for (const cid of profilePrsnCids) {
		const r = await safeSelect(
			db,
			'prsn_share_page_views',
			'id, viewed_at, sharer_user_id, created_image_id, created_by_user_id, anon_cid, meta',
			(q) => q.contains('meta', { prsn_cid: cid }).order('viewed_at', { ascending: false }).limit(300)
		);
		if (r.ok) shareByPrsnCidRows.push(...r.data);
	}
	const blogByPrsnCidRows = [];
	for (const cid of profilePrsnCids) {
		const r = await safeSelect(
			db,
			'prsn_blog_post_views',
			'id, viewed_at, blog_post_id, post_slug, campaign_id, anon_cid, meta',
			(q) => q.contains('meta', { prsn_cid: cid }).order('viewed_at', { ascending: false }).limit(300)
		);
		if (r.ok) blogByPrsnCidRows.push(...r.data);
	}

	const createdAt = toDate(user.created_at);
	const minMs = createdAt ? createdAt.getTime() - CORRELATION_WINDOW_MIN * 60 * 1000 : null;
	const maxMs = createdAt ? createdAt.getTime() + CORRELATION_WINDOW_MIN * 60 * 1000 : null;
	function inWindow(ts) {
		const d = toDate(ts);
		if (!d || minMs == null || maxMs == null) return false;
		const t = d.getTime();
		return t >= minMs && t <= maxMs;
	}

	const anonCandidates = uniq([
		...allAnonCids,
		...tryByPrsnCidRows.map((r) => r?.anon_cid),
		...shareByPrsnCidRows.map((r) => r?.anon_cid),
		...blogByPrsnCidRows.map((r) => r?.anon_cid)
	].filter(Boolean));

	const nearSignupTryByAnon = anonCandidates.length > 0
		? await safeSelect(
			db,
			'prsn_try_requests',
			'id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta',
			(q) => q.in('anon_cid', anonCandidates).order('created_at', { ascending: false }).limit(500)
		)
		: { ok: true, data: [] };
	const nearSignupTryRows = (nearSignupTryByAnon.data || []).filter((r) => inWindow(r.created_at));
	const nearSignupShareRows = [...shareByPrsnCidRows].filter((r) => inWindow(r.viewed_at));
	const nearSignupBlogRows = [...blogByPrsnCidRows].filter((r) => inWindow(r.viewed_at));

	const commentsByUser = await safeSelect(
		db,
		'prsn_comments_created_image',
		'id, created_image_id, user_id, text, created_at',
		(q) => q.eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const likesByUser = await safeSelect(
		db,
		'prsn_likes_created_image',
		'id, created_image_id, user_id, created_at',
		(q) => q.eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const notificationsForUser = await safeSelect(
		db,
		'prsn_notifications',
		'id, user_id, role, type, actor_user_id, target, created_at',
		(q) => q.eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const followsFromUser = await safeSelect(
		db,
		'prsn_user_follows',
		'id, follower_id, following_id, created_at',
		(q) => q.eq('follower_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const followsToUser = await safeSelect(
		db,
		'prsn_user_follows',
		'id, follower_id, following_id, created_at',
		(q) => q.eq('following_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const creditsRow = await safeSelect(
		db,
		'prsn_user_credits',
		'user_id, balance, last_daily_claim_at',
		(q) => q.eq('user_id', user.id).limit(1)
	);
	const tipsFromUser = await safeSelect(
		db,
		'prsn_tip_activity',
		'id, from_user_id, to_user_id, created_image_id, amount, source, created_at',
		(q) => q.eq('from_user_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const tipsToUser = await safeSelect(
		db,
		'prsn_tip_activity',
		'id, from_user_id, to_user_id, created_image_id, amount, source, created_at',
		(q) => q.eq('to_user_id', user.id).order('created_at', { ascending: false }).limit(100)
	);
	const serverMembers = await safeSelect(
		db,
		'prsn_server_members',
		'server_id, user_id, created_at',
		(q) => q.eq('user_id', user.id).limit(100)
	);
	const blogViewsByAnon = allAnonCids.length > 0
		? await safeSelect(
			db,
			'prsn_blog_post_views',
			'id, viewed_at, blog_post_id, post_slug, campaign_id, anon_cid',
			(q) => q.in('anon_cid', allAnonCids).order('viewed_at', { ascending: false }).limit(200)
		)
		: { ok: true, data: [] };

	console.log('# Signup/Onboarding Diagnostic');
	console.log(`Email: ${email}`);
	console.log(`User ID: ${user.id}`);
	console.log('');

	console.log('Ordered onboarding path and this user status:');
	steps.forEach(printStep);

	const missing = steps.filter((s) => !s.completed);
	console.log('');
	if (missing.length === 0) {
		console.log('Conclusion: all major signup/onboarding steps appear completed for this user.');
	} else {
		console.log('Conclusion: this user appears blocked/missing these steps:');
		for (const step of missing) {
			console.log(`- ${step.title}`);
		}
	}

	console.log('');
	console.log('Additional context:');
	console.log(`- display_name: ${displayName || '(empty)'}`);
	console.log(`- role: ${user.role || '(unknown)'}`);
	console.log(`- user.created_at: ${formatIso(user.created_at) || '(none)'}`);
	console.log(`- user.last_active_at: ${formatIso(user.last_active_at) || '(none)'}`);
	console.log(`- profile.updated_at: ${formatIso(profile?.updated_at) || '(none)'}`);
	console.log(`- active sessions: ${activeSessions.length}/${sessions.length}`);
	console.log(`- created images (recent sample): ${createdImages.length}`);

	console.log('');
	console.log('Supabase Auth bridge check (optional):');
	if (!authLookup.available) {
		console.log(`- ${authLookup.reason}`);
	} else if (authLookup.error) {
		console.log(`- Could not verify auth.users: ${authLookup.error}`);
	} else if (authLookup.found) {
		console.log(`- auth.users row found: ${authLookup.authUserId}`);
		console.log(`- email_confirmed_at: ${formatIso(authLookup.emailConfirmedAt) || '(none)'}`);
		console.log(`- auth.created_at: ${formatIso(authLookup.createdAt) || '(none)'}`);
	} else {
		console.log('- No auth.users row found for this email.');
	}

	console.log('');
	console.log('ID linkage trace (user_id / anon_cid / client ids):');
	console.log(`- user_id: ${user.id}`);
	console.log(`- prsn_cids in profile.meta: ${profilePrsnCids.length ? profilePrsnCids.join(', ') : '(none)'}`);
	console.log(`- anon_cid values linked via transitioned try_requests: ${allAnonCids.length ? allAnonCids.join(', ') : '(none)'}`);
	console.log(`- user.meta keys: ${Object.keys(userMeta).length ? Object.keys(userMeta).sort().join(', ') : '(none)'}`);
	console.log(`- correlation window around signup: +/- ${CORRELATION_WINDOW_MIN} minutes`);

	const linkageRows = [
		['prsn_sessions', sessions.length],
		['prsn_user_profiles', profile ? 1 : 0],
		['prsn_created_images', createdImages.length],
		['prsn_try_requests (transitioned -> user)', tryTransitions.length],
		['prsn_try_requests (by linked anon_cid)', tryByAnon.data.length],
		['prsn_try_requests (by profile prsn_cid)', tryByPrsnCidRows.length],
		['prsn_share_page_views (as sharer_user_id)', shareViewsBySharer.data.length],
		['prsn_share_page_views (by linked anon_cid)', shareViewsByAnon.data.length],
		['prsn_share_page_views (by profile prsn_cid)', shareByPrsnCidRows.length],
		['prsn_blog_page_views (by linked anon_cid)', blogViewsByAnon.data.length],
		['prsn_blog_page_views (by profile prsn_cid)', blogByPrsnCidRows.length],
		['prsn_comments_created_image (by user_id)', commentsByUser.data.length],
		['prsn_likes_created_image (by user_id)', likesByUser.data.length],
		['prsn_notifications (by user_id)', notificationsForUser.data.length],
		['prsn_user_follows (follower_id=user)', followsFromUser.data.length],
		['prsn_user_follows (following_id=user)', followsToUser.data.length],
		['prsn_tip_activity (from_user_id=user)', tipsFromUser.data.length],
		['prsn_tip_activity (to_user_id=user)', tipsToUser.data.length],
		['prsn_user_credits (user_id)', creditsRow.data.length],
		['prsn_server_members (user_id)', serverMembers.data.length]
	];
	for (const [name, count] of linkageRows) {
		console.log(`- ${name}: ${count}`);
	}

	console.log('');
	console.log('Possible orphan correlations:');
	console.log(`- candidate anon_cid count from prsn_cid linkage: ${anonCandidates.length}`);
	console.log(`- try rows near signup window: ${nearSignupTryRows.length}`);
	console.log(`- share rows near signup window: ${nearSignupShareRows.length}`);
	console.log(`- blog rows near signup window: ${nearSignupBlogRows.length}`);
	if (nearSignupTryRows.length > 0) {
		const transitionedRows = nearSignupTryRows.filter((r) => {
			const m = parseJsonLike(r.meta);
			return m?.transitioned && Number(m.transitioned.user_id) === Number(user.id);
		});
		console.log(`- near-signup try rows already transitioned to this user: ${transitionedRows.length}`);
	}

	if (SHOULD_REPAIR) {
		console.log('');
		console.log('Repair mode enabled (--repair).');
		if (userName) {
			console.log(`- Skipped: username already set (@${userName}).`);
		} else {
			const suggested = await suggestAvailableUsername(db, email, user.id);
			if (!suggested) {
				console.log('- Could not repair automatically: no available username found.');
			} else {
				const currentMeta = safeMeta(profile?.meta);
				const prevVersionRaw = currentMeta.welcome_version == null ? currentMeta.onb_version : currentMeta.welcome_version;
				const prevVersion = Number.isFinite(Number(prevVersionRaw)) ? Number(prevVersionRaw) : 0;
				const nextMeta = { ...currentMeta, welcome_version: Math.max(1, Math.floor(prevVersion || 0)) };
				delete nextMeta.onb_version;
				const payload = {
					user_id: user.id,
					user_name: suggested,
					display_name: profile?.display_name ?? null,
					about: profile?.about ?? null,
					socials: profile?.socials ?? null,
					avatar_url: profile?.avatar_url ?? null,
					cover_image_url: profile?.cover_image_url ?? null,
					badges: profile?.badges ?? null,
					meta: nextMeta,
					updated_at: new Date().toISOString()
				};
				const upsert = await db.from('prsn_user_profiles').upsert(payload, { onConflict: 'user_id' }).select('user_id, user_name, meta').maybeSingle();
				if (upsert.error) {
					console.log(`- Repair failed: ${upsert.error.message || upsert.error}`);
				} else {
					console.log(`- Repaired: assigned username @${suggested} and ensured welcome_version>=1.`);
					console.log('- User should now pass welcome gate and be able to use app.');
				}
			}
		}
	}

	if (SHOULD_REPAIR_FULL) {
		console.log('');
		console.log('Full repair mode enabled (--repair-full).');
		if (!serviceClient) {
			console.log('- Full repair requires SUPABASE_SERVICE_ROLE_KEY.');
		} else {
			try {
				const { openDb: openSupabaseDb } = await import('../db/adapters/supabase.js');
				const dbInstance = openSupabaseDb();
				const storage = dbInstance?.storage;
				if (!storage?.getImageBufferAnon || !storage?.uploadImage || !storage?.deleteImageAnon) {
					throw new Error('Supabase storage helpers unavailable');
				}

				const tryRowsByClient = [...tryByPrsnCidRows]
					.filter((r) => Number(r.created_image_anon_id) > 0)
					.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
				const orphanAnonIds = uniq(tryRowsByClient.map((r) => Number(r.created_image_anon_id)).filter((n) => Number.isFinite(Number(n)) && Number(n) > 0))
					.map((n) => Number(n));
				if (orphanAnonIds.length === 0) {
					console.log('- No orphan anon image ids to transition.');
				} else {
					const { data: anonRows, error: anonErr } = await serviceClient
						.from('prsn_created_images_anon')
						.select('id, prompt, filename, file_path, width, height, status, created_at, meta')
						.in('id', orphanAnonIds);
					if (anonErr) throw anonErr;
					const anonById = new Map((anonRows || []).map((r) => [Number(r.id), r]));
					let transitioned = 0;
					let avatarSet = false;
					let feedInserted = false;
					let newestTransition = null;

					for (const anonId of orphanAnonIds) {
						const row = anonById.get(Number(anonId));
						if (!row || row.status !== 'completed' || !isNonEmptyString(row.filename)) continue;

						// Idempotency: if already moved earlier, reuse.
						const existing = await serviceClient
							.from('prsn_created_images')
							.select('id, file_path, filename, meta, created_at')
							.eq('user_id', user.id)
							.contains('meta', { source_anon_id: Number(anonId) })
							.order('created_at', { ascending: false })
							.limit(1)
							.maybeSingle();
						if (existing.error) throw existing.error;

						let createdImageId = existing.data?.id || null;
						let newUrl = existing.data?.file_path || null;
						let newFilename = existing.data?.filename || null;

						if (!createdImageId) {
							const buffer = await storage.getImageBufferAnon(row.filename);
							newFilename = `transition_${user.id}_${anonId}_${Date.now()}.png`;
							newUrl = await storage.uploadImage(buffer, newFilename);
							const meta = {
								...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
								source_anon_id: Number(anonId)
							};
							const insertRes = await serviceClient
								.from('prsn_created_images')
								.insert({
									user_id: Number(user.id),
									filename: newFilename,
									file_path: newUrl,
									width: Number(row.width) || 1024,
									height: Number(row.height) || 1024,
									color: null,
									status: 'completed',
									meta
								})
								.select('id')
								.single();
							if (insertRes.error) throw insertRes.error;
							createdImageId = insertRes.data.id;
						}

						// Mark all try_requests for this anon image as transitioned and unlink anon id.
						const trRowsRes = await serviceClient
							.from('prsn_try_requests')
							.select('id, meta')
							.eq('created_image_anon_id', Number(anonId));
						if (trRowsRes.error) throw trRowsRes.error;
						const at = new Date().toISOString();
						for (const tr of trRowsRes.data || []) {
							const trMeta = tr.meta && typeof tr.meta === 'object' ? { ...tr.meta } : {};
							trMeta.transitioned = { at, user_id: Number(user.id), created_image_id: Number(createdImageId) };
							const upd = await serviceClient
								.from('prsn_try_requests')
								.update({ created_image_anon_id: null, meta: trMeta })
								.eq('id', tr.id);
							if (upd.error) throw upd.error;
						}

						// Cleanup anon db row + file
						await serviceClient.from('prsn_created_images_anon').delete().eq('id', Number(anonId));
						await storage.deleteImageAnon(row.filename);

						transitioned += 1;
						newestTransition = { createdImageId, newUrl, prompt: row.prompt || null, anonId: Number(anonId) };
					}

					if (newestTransition) {
						const currentProfileRes = await serviceClient
							.from('prsn_user_profiles')
							.select('user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta')
							.eq('user_id', Number(user.id))
							.maybeSingle();
						if (currentProfileRes.error) throw currentProfileRes.error;
						const p = currentProfileRes.data || {};
						const mergedMeta = p.meta && typeof p.meta === 'object' ? { ...p.meta } : {};
						const prevVer = Number(mergedMeta.welcome_version == null ? mergedMeta.onb_version : mergedMeta.welcome_version);
						mergedMeta.welcome_version = Number.isFinite(prevVer) ? Math.max(1, Math.floor(prevVer)) : 1;
						delete mergedMeta.onb_version;
						const up = await serviceClient
							.from('prsn_user_profiles')
							.upsert({
								user_id: Number(user.id),
								user_name: p.user_name || null,
								display_name: p.display_name || null,
								about: p.about || null,
								socials: p.socials || null,
								avatar_url: newestTransition.newUrl,
								cover_image_url: p.cover_image_url || null,
								badges: p.badges || null,
								meta: mergedMeta,
								updated_at: new Date().toISOString()
							}, { onConflict: 'user_id' });
						if (up.error) throw up.error;
						avatarSet = true;

						const usernameNow = isNonEmptyString(p.user_name) ? p.user_name.trim() : (userName || `user${user.id}`);
						const title = `Welcome @${usernameNow}`;
						const description = isNonEmptyString(newestTransition.prompt) ? newestTransition.prompt.trim() : '';
						const pub = await serviceClient
							.from('prsn_created_images')
							.update({
								published: true,
								published_at: new Date().toISOString(),
								title,
								description: description || null
							})
							.eq('id', Number(newestTransition.createdImageId))
							.eq('user_id', Number(user.id));
						if (pub.error) throw pub.error;
						const author = isNonEmptyString(p.display_name) ? p.display_name.trim() : email;
						const feed = await serviceClient
							.from('prsn_feed_items')
							.insert({
								title,
								summary: description || 'Profile portrait',
								author,
								tags: null,
								created_image_id: Number(newestTransition.createdImageId)
							});
						if (!feed.error) feedInserted = true;
					}

					// Also backfill character_description from latest welcome prompt when missing.
					const latestPrompt = isNonEmptyString(newestTransition?.prompt)
						? newestTransition.prompt.trim()
						: (isNonEmptyString(tryByPrsnCidRows?.[0]?.prompt) ? tryByPrsnCidRows[0].prompt.trim() : '');
					const parsedCharacter = extractCharacterDescriptionFromWelcomePrompt(latestPrompt);
					if (parsedCharacter) {
						const prof = await serviceClient
							.from('prsn_user_profiles')
							.select('user_id, meta')
							.eq('user_id', Number(user.id))
							.maybeSingle();
						if (!prof.error && prof.data) {
							const m = prof.data.meta && typeof prof.data.meta === 'object' ? { ...prof.data.meta } : {};
							const cur = typeof m.character_description === 'string' ? m.character_description.trim() : '';
							if (!cur) {
								m.character_description = parsedCharacter;
								await serviceClient
									.from('prsn_user_profiles')
									.update({ meta: m, updated_at: new Date().toISOString() })
									.eq('user_id', Number(user.id));
								console.log(`- Backfilled character_description from prompt: "${parsedCharacter}"`);
							}
						}
					}

					console.log(`- Transitioned anon images: ${transitioned}`);
					console.log(`- Avatar set from transitioned image: ${avatarSet ? 'yes' : 'no'}`);
					console.log(`- Welcome feed item created: ${feedInserted ? 'yes' : 'no'}`);
				}

				// Backfill character_description from latest welcome prompt when missing.
				const latestPromptAny = isNonEmptyString(tryByPrsnCidRows?.[0]?.prompt)
					? tryByPrsnCidRows[0].prompt.trim()
					: '';
				const parsedCharacterAny = extractCharacterDescriptionFromWelcomePrompt(latestPromptAny);
				if (parsedCharacterAny) {
					const prof = await serviceClient
						.from('prsn_user_profiles')
						.select('user_id, meta')
						.eq('user_id', Number(user.id))
						.maybeSingle();
					if (!prof.error && prof.data) {
						const m = prof.data.meta && typeof prof.data.meta === 'object' ? { ...prof.data.meta } : {};
						const cur = typeof m.character_description === 'string' ? m.character_description.trim() : '';
						if (!cur) {
							m.character_description = parsedCharacterAny;
							await serviceClient
								.from('prsn_user_profiles')
								.update({ meta: m, updated_at: new Date().toISOString() })
								.eq('user_id', Number(user.id));
							console.log(`- Backfilled character_description from prompt: "${parsedCharacterAny}"`);
						}
					}
				}
			} catch (err) {
				console.log(`- Full repair failed: ${err?.message || err}`);
			}
		}
	}

	const failedLookups = [
		['prsn_try_requests (anon)', tryByAnon],
		['prsn_share_page_views (sharer)', shareViewsBySharer],
		['prsn_share_page_views (anon)', shareViewsByAnon],
		['prsn_blog_page_views (anon)', blogViewsByAnon],
		['prsn_comments_created_image', commentsByUser],
		['prsn_likes_created_image', likesByUser],
		['prsn_notifications', notificationsForUser],
		['prsn_user_follows ->', followsFromUser],
		['prsn_user_follows <-', followsToUser],
		['prsn_tip_activity ->', tipsFromUser],
		['prsn_tip_activity <-', tipsToUser],
		['prsn_user_credits', creditsRow],
		['prsn_server_members', serverMembers]
	].filter(([, r]) => !r.ok);
	if (failedLookups.length > 0) {
		console.log('');
		console.log('Lookup warnings:');
		for (const [name, r] of failedLookups) {
			console.log(`- ${name}: ${r.error}`);
		}
	}
}

main().catch((err) => {
	console.error('[debug-signup-onboarding] Failed:', err?.message || err);
	process.exitCode = 1;
});
