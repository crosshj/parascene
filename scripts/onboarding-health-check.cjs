#!/usr/bin/env node
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const LOOKBACK_HOURS = Number(process.env.ONBOARDING_LOOKBACK_HOURS || 24);
const STUCK_MINUTES = Number(process.env.ONBOARDING_STUCK_MINUTES || 20);

function mustEnv(name) {
	const v = process.env[name];
	if (!v || !String(v).trim()) throw new Error(`Missing required env var ${name}`);
	return String(v).trim();
}

function toDate(value) {
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function minutesAgoIso(minutes) {
	return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function hoursAgoIso(hours) {
	return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function main() {
	const db = createClient(
		mustEnv('SUPABASE_URL'),
		(process.env.SUPABASE_SERVICE_ROLE_KEY || mustEnv('SUPABASE_ANON_KEY')).trim()
	);

	const createdSince = hoursAgoIso(LOOKBACK_HOURS);
	const stuckBefore = minutesAgoIso(STUCK_MINUTES);

	const usersRes = await db
		.from('prsn_users')
		.select('id, email, created_at')
		.gte('created_at', createdSince)
		.order('created_at', { ascending: false })
		.limit(1000);
	if (usersRes.error) throw usersRes.error;
	const users = Array.isArray(usersRes.data) ? usersRes.data : [];
	if (users.length === 0) {
		console.log(`[onboarding-health-check] No users in last ${LOOKBACK_HOURS}h.`);
		return;
	}

	const userIds = users.map((u) => Number(u.id)).filter((id) => Number.isFinite(id) && id > 0);
	const profilesRes = await db
		.from('prsn_user_profiles')
		.select('user_id, user_name, meta, updated_at')
		.in('user_id', userIds);
	if (profilesRes.error) throw profilesRes.error;
	const profilesByUser = new Map((profilesRes.data || []).map((p) => [Number(p.user_id), p]));

	const sessionsRes = await db
		.from('prsn_sessions')
		.select('user_id, expires_at')
		.in('user_id', userIds);
	if (sessionsRes.error) throw sessionsRes.error;
	const nowMs = Date.now();
	const activeSessionCount = new Map();
	for (const s of sessionsRes.data || []) {
		const uid = Number(s.user_id);
		const exp = toDate(s.expires_at);
		if (!Number.isFinite(uid) || !exp || exp.getTime() <= nowMs) continue;
		activeSessionCount.set(uid, (activeSessionCount.get(uid) || 0) + 1);
	}

	const stuck = [];
	for (const u of users) {
		const uid = Number(u.id);
		const profile = profilesByUser.get(uid) || null;
		const createdAt = toDate(u.created_at);
		if (!createdAt) continue;
		if (createdAt.toISOString() > stuckBefore) continue;
		const userName = typeof profile?.user_name === 'string' ? profile.user_name.trim() : '';
		const hasUsername = Boolean(userName);
		if (hasUsername) continue;
		const activeSessions = activeSessionCount.get(uid) || 0;
		if (activeSessions < 1) continue;
		const meta = profile?.meta && typeof profile.meta === 'object' ? profile.meta : {};
		const prsnCids = Array.isArray(meta.prsn_cids)
			? [...new Set(meta.prsn_cids.map((x) => String(x || '').trim()).filter(Boolean))]
			: [];
		stuck.push({
			user_id: uid,
			email: u.email || null,
			created_at: createdAt.toISOString(),
			active_sessions: activeSessions,
			profile_updated_at: profile?.updated_at || null,
			prsn_cids: prsnCids
		});
	}

	if (stuck.length === 0) {
		console.log(`[onboarding-health-check] OK: no stuck users (${LOOKBACK_HOURS}h lookback, ${STUCK_MINUTES}m threshold).`);
		return;
	}

	console.log(`[onboarding-health-check] ALERT: ${stuck.length} stuck onboarding user(s).`);
	for (const row of stuck) {
		console.log(`- user_id=${row.user_id} email=${row.email || '(none)'} created_at=${row.created_at} active_sessions=${row.active_sessions} prsn_cids=${row.prsn_cids.join(',') || '(none)'}`);
	}

	// Non-zero exit code so this can page/alert in cron or CI.
	process.exitCode = 2;
}

main().catch((err) => {
	console.error('[onboarding-health-check] Failed:', err?.message || err);
	process.exitCode = 1;
});

