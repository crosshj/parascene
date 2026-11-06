#!/usr/bin/env node
/**
 * One-time cutover: convert legacy free-text reward fields on challenge_config
 * messages to the structured `prizes` block.
 *
 * Per challenge_config message in the #challenges thread:
 * - `prizes.main` parsed from reward_first/second/third digits (0 when absent)
 * - participation categories disabled (no historical challenge advertised them);
 *   amounts seeded with the standard defaults so re-enabling is one click
 * - `reward_participation` / legacy `reward` text folded into `reward_custom`
 *   (never dropped silently)
 * - reward_first/second/third/reward_participation/reward removed from the body
 *
 * Messages with no legacy reward keys are left untouched. Messages that already
 * have a `prizes` block only get their legacy keys scrubbed.
 *
 * Usage:
 *   node db/maintenance/migrate-challenge-prizes.js dr
 *   node db/maintenance/migrate-challenge-prizes.js exec
 *
 * exec writes a backup of original bodies to
 *   db/maintenance/backups/challenge-prizes-<timestamp>.jsonl
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCreditsAmount, DEFAULT_PARTICIPATION_AMOUNTS } from '../../src/chat/challenges/model/prizes.js';

const MESSAGES_TABLE = 'prsn_chat_messages';
const THREADS_TABLE = 'prsn_chat_threads';
const PAGE_SIZE = 500;
const LEGACY_KEYS = ['reward_first', 'reward_second', 'reward_third', 'reward_participation', 'reward'];

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

function trimStr(v) {
	return v == null ? '' : String(v).trim();
}

/** @returns {{ next: object, changes: string[] } | null} null when nothing to migrate */
function migrateConfigPayload(payload) {
	const legacyPresent = LEGACY_KEYS.filter((k) => trimStr(payload[k]));
	const hasLegacyKeysAtAll = LEGACY_KEYS.some((k) =>
		Object.prototype.hasOwnProperty.call(payload, k)
	);
	if (!legacyPresent.length && !hasLegacyKeysAtAll) return null;

	const next = { ...payload };
	const changes = [];

	if (!next.prizes || typeof next.prizes !== 'object') {
		const main = {
			first: parseCreditsAmount(payload.reward_first) ?? 0,
			second: parseCreditsAmount(payload.reward_second) ?? 0,
			third: parseCreditsAmount(payload.reward_third) ?? 0
		};
		next.prizes = {
			main,
			top_submitters: { enabled: false, amounts: [...DEFAULT_PARTICIPATION_AMOUNTS] },
			top_voters: { enabled: false, amounts: [...DEFAULT_PARTICIPATION_AMOUNTS] }
		};
		changes.push(
			`prizes.main=${main.first}/${main.second}/${main.third} (participation off)`
		);
	}

	// Fold free text we would otherwise lose into reward_custom.
	const custom = trimStr(next.reward_custom);
	const participationText = trimStr(payload.reward_participation);
	const legacySingle = trimStr(payload.reward);
	const extras = [participationText, legacySingle].filter(
		(t) => t && t !== custom
	);
	if (extras.length) {
		next.reward_custom = [custom, ...extras].filter(Boolean).join(' · ');
		changes.push(`reward_custom += ${extras.map((t) => JSON.stringify(t)).join(', ')}`);
	}

	for (const k of LEGACY_KEYS) {
		if (Object.prototype.hasOwnProperty.call(next, k)) {
			delete next[k];
			changes.push(`-${k}`);
		}
	}

	return changes.length ? { next, changes } : null;
}

async function fetchAllThreadMessages(sb, threadId) {
	const out = [];
	let beforeId = null;
	for (;;) {
		let q = sb
			.from(MESSAGES_TABLE)
			.select('id, body')
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

async function main() {
	const mode = process.argv[2];
	if (mode !== 'dr' && mode !== 'exec') {
		console.log('Usage: node db/maintenance/migrate-challenge-prizes.js <dr|exec>');
		process.exitCode = 1;
		return;
	}

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
		throw new Error('#challenges thread not found');
	}
	console.log(`#challenges thread id: ${threadId}`);

	const messages = await fetchAllThreadMessages(sb, threadId);
	console.log(`scanned ${messages.length} messages`);

	const planned = [];
	for (const row of messages) {
		const payload = tryParseJsonObject(row.body);
		if (!payload || trimStr(payload.kind) !== 'challenge_config') continue;
		const result = migrateConfigPayload(payload);
		if (!result) continue;
		planned.push({ id: row.id, oldBody: row.body, next: result.next, changes: result.changes });
	}

	if (!planned.length) {
		console.log('nothing to migrate — all challenge_config messages are already on the prizes model');
		return;
	}

	for (const p of planned) {
		const cid = trimStr(p.next.challenge_id) || '(no challenge_id)';
		console.log(`message ${p.id} [${cid}]: ${p.changes.join(', ')}`);
	}
	console.log(`${planned.length} message(s) to update`);

	if (mode === 'dr') {
		console.log('dry run — no writes. Re-run with exec to apply.');
		return;
	}

	const backupDir = path.join('db', 'maintenance', 'backups');
	mkdirSync(backupDir, { recursive: true });
	const backupFile = path.join(
		backupDir,
		`challenge-prizes-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
	);
	writeFileSync(
		backupFile,
		planned.map((p) => JSON.stringify({ id: p.id, body: p.oldBody })).join('\n') + '\n'
	);
	console.log(`backup written: ${backupFile}`);

	let updated = 0;
	for (const p of planned) {
		const { error } = await sb
			.from(MESSAGES_TABLE)
			.update({ body: JSON.stringify(p.next) })
			.eq('id', p.id);
		if (error) {
			console.error(`FAILED updating message ${p.id}: ${error.message}`);
			process.exitCode = 1;
			return;
		}
		updated += 1;
	}
	console.log(`updated ${updated}/${planned.length} messages — done`);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exitCode = 1;
});
