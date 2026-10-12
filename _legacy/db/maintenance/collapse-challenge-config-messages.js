#!/usr/bin/env node
/**
 * Collapse duplicate challenge_config messages down to one per challenge_id.
 * Keeps the newest message, writes the full merged body onto it, deletes the rest.
 *
 * Usage:
 *   node db/maintenance/collapse-challenge-config-messages.js           # dry-run
 *   node db/maintenance/collapse-challenge-config-messages.js --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
	buildFullChallengeConfigBody,
	pickCanonicalChallengeConfigMessageId
} from '../../api_routes/utils/challengeConfigMessage.js';

const MESSAGES_TABLE = 'prsn_chat_messages';
const THREADS_TABLE = 'prsn_chat_threads';
const PAGE_SIZE = 500;
const apply = process.argv.includes('--apply');

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
			.select('id, sender_id, created_at, body')
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
	if (!Number.isFinite(threadId) || threadId <= 0) {
		throw new Error('Challenges channel not found');
	}

	const messages = await fetchAllThreadMessages(sb, threadId);
	/** @type {Map<string, { ids: number[], merged: object }>} */
	const byChallenge = new Map();
	for (const row of messages) {
		const payload = tryParseJsonObject(row.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_config') continue;
		const cid = String(payload.challenge_id || '').trim();
		if (!cid) continue;
		const mid = Number(row.id);
		if (!Number.isFinite(mid) || mid <= 0) continue;
		const cur = byChallenge.get(cid) || { ids: [], merged: {} };
		cur.ids.push(mid);
		cur.merged = { ...cur.merged, ...payload };
		byChallenge.set(cid, cur);
	}

	const multi = [...byChallenge.entries()].filter(([, v]) => v.ids.length > 1);
	console.log(
		`#challenges thread ${threadId}: ${byChallenge.size} challenge_config ids, ${multi.length} with duplicates`
	);
	if (!multi.length) {
		console.log('nothing to collapse');
		return;
	}

	for (const [cid, { ids, merged }] of multi) {
		const keepId = pickCanonicalChallengeConfigMessageId(ids);
		const dropIds = ids.filter((id) => id !== keepId);
		const payload = buildFullChallengeConfigBody(merged, cid);
		console.log(
			`${apply ? 'APPLY' : 'DRY'} ${cid}: keep ${keepId}, delete [${dropIds.join(', ')}], title=${JSON.stringify(payload.title || '')}`
		);
		if (!apply) continue;
		const { error: upErr } = await sb
			.from(MESSAGES_TABLE)
			.update({ body: JSON.stringify(payload) })
			.eq('id', keepId)
			.eq('thread_id', threadId);
		if (upErr) throw upErr;
		const { error: delErr } = await sb
			.from(MESSAGES_TABLE)
			.delete()
			.in('id', dropIds)
			.eq('thread_id', threadId);
		if (delErr) throw delErr;
	}

	if (!apply) {
		console.log('\nRe-run with --apply to write.');
	} else {
		console.log('\nDone.');
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
