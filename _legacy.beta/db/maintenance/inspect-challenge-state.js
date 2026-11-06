#!/usr/bin/env node
/**
 * Read-only inspection: dump merged challenge_config state per challenge_id
 * from the #challenges thread, plus editorial pin policy. No writes.
 *
 * Usage: node db/maintenance/inspect-challenge-state.js [challenge_id]
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const MESSAGES_TABLE = 'prsn_chat_messages';
const THREADS_TABLE = 'prsn_chat_threads';
const PAGE_SIZE = 500;

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function tryParseJsonObject(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || !s.startsWith('{')) return null;
	try {
		const o = JSON.parse(s);
		return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

async function fetchAllThreadMessages(sb, threadId) {
	const out = [];
	let beforeId = null;
	for (;;) {
		let q = sb
			.from(MESSAGES_TABLE)
			.select('id, sender_id, created_at, body, reactions')
			.eq('thread_id', threadId)
			.order('id', { ascending: false })
			.limit(PAGE_SIZE);
		if (beforeId != null) q = q.lt('id', beforeId);
		const { data, error } = await q;
		if (error) throw error;
		const rows = Array.isArray(data) ? data : [];
		out.push(...rows);
		if (rows.length < PAGE_SIZE) break;
		beforeId = rows[rows.length - 1].id;
	}
	out.sort((a, b) => a.id - b.id);
	return out;
}

async function main() {
	const filterId = process.argv[2] || null;
	const sb = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
		auth: { persistSession: false }
	});

	const { data: threadRow, error: threadErr } = await sb
		.from(THREADS_TABLE)
		.select('id')
		.eq('type', 'channel')
		.eq('channel_slug', 'challenges')
		.maybeSingle();
	if (threadErr) throw threadErr;
	const threadId = Number(threadRow?.id);
	console.log(`#challenges thread id: ${threadId}`);

	const messages = await fetchAllThreadMessages(sb, threadId);
	console.log(`total messages: ${messages.length}`);

	const byChallenge = new Map();
	const submissions = new Map();
	const announces = [];
	for (const row of messages) {
		const payload = tryParseJsonObject(row.body);
		if (!payload) continue;
		const kind = String(payload.kind || '').trim();
		const cid = String(payload.challenge_id || '').trim();
		if (kind === 'challenge_config' && cid) {
			if (!byChallenge.has(cid)) byChallenge.set(cid, {});
			const merged = byChallenge.get(cid);
			Object.assign(merged, payload, { _last_msg_id: row.id, _last_at: row.created_at });
		} else if (kind === 'challenge_submission') {
			if (!submissions.has(cid)) submissions.set(cid, []);
			submissions.get(cid).push({
				message_id: row.id,
				sender_id: row.sender_id,
				created_at: row.created_at,
				created_image_id: payload.created_image_id ?? payload.creation_id ?? null,
				reactions: row.reactions || null
			});
		} else if (kind === 'challenge_announce') {
			announces.push({ message_id: row.id, sender_id: row.sender_id, created_at: row.created_at, challenge_id: cid, body: payload });
		}
	}

	for (const [cid, cfg] of byChallenge) {
		if (filterId && cid !== filterId) continue;
		const subs = submissions.get(cid) || [];
		console.log('\n================================================================');
		console.log(`challenge_id: ${cid}`);
		console.log(JSON.stringify(cfg, null, 2));
		console.log(`submissions: ${subs.length}`);
		if (filterId) {
			for (const s of subs) console.log(JSON.stringify(s));
		}
	}

	console.log('\n---- announces ----');
	for (const a of announces) {
		if (filterId && a.challenge_id !== filterId) continue;
		console.log(JSON.stringify(a));
	}

	// Editorial pins policy
	const { data: pinRow, error: pinErr } = await sb
		.from('prsn_policy_knobs')
		.select('key, value, updated_at')
		.eq('key', 'feed.editorial_pins')
		.maybeSingle();
	console.log('\n---- feed.editorial_pins policy ----');
	if (pinErr) {
		console.log(`(lookup error: ${pinErr.message})`);
	} else if (!pinRow) {
		console.log('(no policy row)');
	} else {
		console.log(`updated_at: ${pinRow.updated_at}`);
		try {
			console.log(JSON.stringify(JSON.parse(pinRow.value), null, 2));
		} catch {
			console.log(pinRow.value);
		}
	}
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exitCode = 1;
});
