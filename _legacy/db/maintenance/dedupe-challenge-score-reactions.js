#!/usr/bin/env node
/**
 * Deduplicate orphan challenge score reactions: when a voter has 2+ score keys
 * on one challenge_submission, keep the lowest score and strip the rest.
 *
 * Usage:
 *   node db/maintenance/dedupe-challenge-score-reactions.js           # dry-run
 *   node db/maintenance/dedupe-challenge-score-reactions.js --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
	CHALLENGE_SCORE_REACTION_KEYS,
	challengeReactionKeyToScore
} from '../../src/chat/challenges/constants.js';
import { stripUserFromChallengeScoreReactions } from '../../src/chat/challenges/model/scoreReactions.js';

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

function cloneReactionsBucket(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [k, v] of Object.entries(raw)) {
		if (Array.isArray(v)) out[k] = v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
		else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
		else out[k] = v;
	}
	return out;
}

async function fetchAllThreadMessages(sb, threadId) {
	const out = [];
	let beforeId = null;
	for (;;) {
		let q = sb
			.from(MESSAGES_TABLE)
			.select('id, body, reactions')
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
	return out;
}

/**
 * @param {Record<string, unknown>} reactions
 * @returns {{ userId: number, keys: string[], scores: number[], keepKey: string }[]}
 */
function findOrphansOnMessage(reactions) {
	/** @type {Map<number, string[]>} */
	const byUser = new Map();
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const raw = reactions?.[key];
		const ids = Array.isArray(raw)
			? raw.map(Number).filter((n) => Number.isFinite(n) && n > 0)
			: [];
		for (const uid of ids) {
			if (!byUser.has(uid)) byUser.set(uid, []);
			byUser.get(uid).push(key);
		}
	}
	const orphans = [];
	for (const [userId, keys] of byUser) {
		if (keys.length < 2) continue;
		const scored = keys
			.map((key) => ({ key, score: challengeReactionKeyToScore(key) }))
			.filter((x) => x.score != null)
			.sort((a, b) => a.score - b.score);
		if (scored.length < 2) continue;
		orphans.push({
			userId,
			keys: scored.map((x) => x.key),
			scores: scored.map((x) => x.score),
			keepKey: scored[0].key
		});
	}
	return orphans;
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
	/** @type {{ messageId: number, challengeId: string, orphans: ReturnType<typeof findOrphansOnMessage>, nextReactions: Record<string, unknown> }[]} */
	const fixes = [];

	for (const m of messages) {
		const payload = tryParseJsonObject(m.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_submission') continue;
		const challengeId = String(payload.challenge_id || payload.challengeId || '').trim();
		const orphans = findOrphansOnMessage(m.reactions);
		if (!orphans.length) continue;

		const next = cloneReactionsBucket(m.reactions);
		for (const o of orphans) {
			stripUserFromChallengeScoreReactions(next, o.userId, { keepKey: o.keepKey });
		}
		fixes.push({
			messageId: Number(m.id),
			challengeId,
			orphans,
			nextReactions: next
		});
	}

	console.log(apply ? 'APPLY mode' : 'DRY-RUN (pass --apply to write)');
	console.log(`Found ${fixes.length} submission(s) with orphan score reactions\n`);

	let voterPairs = 0;
	for (const fix of fixes) {
		for (const o of fix.orphans) {
			voterPairs += 1;
			console.log(
				`msg ${fix.messageId} challenge ${fix.challengeId || '?'} user ${o.userId}: ` +
					`scores ${o.scores.join('+')} → keep ${challengeReactionKeyToScore(o.keepKey)} (${o.keepKey})`
			);
		}
	}
	console.log(`\n${voterPairs} voter×submission pair(s) to dedupe`);

	if (!apply) return;

	for (const fix of fixes) {
		const { error } = await sb
			.from(MESSAGES_TABLE)
			.update({ reactions: fix.nextReactions })
			.eq('id', fix.messageId);
		if (error) throw error;
		console.log(`updated msg ${fix.messageId}`);
	}
	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
