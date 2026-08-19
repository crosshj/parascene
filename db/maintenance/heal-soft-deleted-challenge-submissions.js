#!/usr/bin/env node
/**
 * Remove #challenges challenge_submission messages whose creation is missing
 * or owner-soft-deleted (unavailable_at), and drop matching meta.challenge_submissions.
 *
 * Usage: node db/maintenance/heal-soft-deleted-challenge-submissions.js [--dry-run]
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { broadcastRoomDirty, broadcastUserInboxDirty } from '../../api_routes/utils/realtimeBroadcast.js';
import { invalidateChallengeFeedSnapshotCache } from '../../api_routes/feed/challengeFeedSnapshotCache.js';
import { repairLastReadPointersForDeletedMessages } from '../../api_routes/utils/chatInviteCleanup.js';
import { groupSourceCreationIdsFromMeta } from '../../src/shared/challengeSubmitMeta.js';

const MESSAGES_TABLE = 'prsn_chat_messages';
const THREADS_TABLE = 'prsn_chat_threads';
const CREATIONS_TABLE = 'prsn_created_images';
const MEMBERS_TABLE = 'prsn_chat_members';
const PAGE_SIZE = 500;

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function tryParseJsonObject(body) {
	if (body == null) return null;
	if (typeof body === 'object' && !Array.isArray(body)) return body;
	const s = String(body).trim();
	if (!s || !s.startsWith('{')) return null;
	try {
		const o = JSON.parse(s);
		return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

function parseMeta(raw) {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
	if (typeof raw === 'string') {
		try {
			const o = JSON.parse(raw);
			if (o && typeof o === 'object' && !Array.isArray(o)) return { ...o };
		} catch {
			// ignore
		}
	}
	return {};
}

function imageIsGone(row) {
	if (!row) return true;
	return row.unavailable_at != null && String(row.unavailable_at) !== '';
}

function filterChallengeSubmissionsNotMatching(prev, dropMids, dropCids) {
	const list = Array.isArray(prev) ? prev : [];
	return list.filter((entry) => {
		const mid = Number(entry?.message_id);
		if (Number.isFinite(mid) && dropMids.has(mid)) return false;
		const cid = String(entry?.challenge_id || '').trim();
		if (cid && dropCids.has(cid)) return false;
		return true;
	});
}

async function fetchGroupRowsForUsers(sb, userIds) {
	const out = [];
	const seen = new Set();
	for (const rawUid of userIds) {
		const uid = Number(rawUid);
		if (!Number.isFinite(uid) || uid <= 0) continue;
		let beforeId = null;
		for (;;) {
			let q = sb
				.from(CREATIONS_TABLE)
				.select('id, user_id, filename, meta')
				.eq('user_id', uid)
				.like('filename', 'group/%')
				.order('id', { ascending: false })
				.limit(PAGE_SIZE);
			if (beforeId != null) q = q.lt('id', beforeId);
			const { data, error } = await q;
			if (error) throw error;
			const rows = Array.isArray(data) ? data : [];
			for (const row of rows) {
				const id = Number(row?.id);
				if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
				seen.add(id);
				out.push(row);
			}
			if (rows.length < PAGE_SIZE) break;
			beforeId = rows[rows.length - 1].id;
		}
	}
	return out;
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
	return out;
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
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

	const messages = await fetchAllThreadMessages(sb, threadId);
	/** @type {{ message_id: number, sender_id: number, challenge_id: string, created_image_id: number }[]} */
	const submissions = [];
	for (const m of messages) {
		const p = tryParseJsonObject(m.body);
		if (!p || String(p.kind || '').trim() !== 'challenge_submission') continue;
		const imgId = Number(p.created_image_id ?? p.creation_id);
		if (!Number.isFinite(imgId) || imgId <= 0) continue;
		submissions.push({
			message_id: Number(m.id),
			sender_id: Number(m.sender_id),
			challenge_id: String(p.challenge_id || '').trim(),
			created_image_id: imgId
		});
	}

	const imageIds = [...new Set(submissions.map((s) => s.created_image_id))];
	const { data: images, error: imgErr } = await sb
		.from(CREATIONS_TABLE)
		.select('id, unavailable_at, meta, user_id')
		.in('id', imageIds);
	if (imgErr) throw imgErr;
	const imgById = new Map((images || []).map((r) => [Number(r.id), r]));

	const stale = submissions.filter((s) => imageIsGone(imgById.get(s.created_image_id)));
	console.log(`#challenges thread ${threadId}: ${submissions.length} submissions, ${stale.length} on missing/soft-deleted creations`);
	if (stale.length === 0) return;

	for (const s of stale) {
		console.log(
			`  msg ${s.message_id} challenge=${s.challenge_id || '(none)'} creation=${s.created_image_id} sender=${s.sender_id}`
		);
	}

	const staleCreationIds = new Set(stale.map((s) => s.created_image_id));
	const dropMids = new Set(stale.map((s) => s.message_id));
	const dropCids = new Set(stale.map((s) => s.challenge_id).filter(Boolean));
	const senderIds = [...new Set(stale.map((s) => s.sender_id).filter((id) => Number.isFinite(id) && id > 0))];
	const groupRows = await fetchGroupRowsForUsers(sb, senderIds);
	const groupsToHeal = [];
	for (const row of groupRows) {
		const meta = parseMeta(row.meta);
		const sourceIds = groupSourceCreationIdsFromMeta(meta);
		if (!sourceIds.some((id) => staleCreationIds.has(id))) continue;
		const prev = Array.isArray(meta.challenge_submissions) ? meta.challenge_submissions : [];
		const next = filterChallengeSubmissionsNotMatching(prev, dropMids, dropCids);
		if (next.length === prev.length && prev.length === 0) {
			groupsToHeal.push({ row, meta, prev, next, stampChange: false });
			continue;
		}
		if (next.length === prev.length) continue;
		groupsToHeal.push({ row, meta, prev, next, stampChange: true });
	}
	if (groupsToHeal.length) {
		console.log(`group rows whose sources include healed creations: ${groupsToHeal.length}`);
		for (const g of groupsToHeal) {
			console.log(
				`  group ${g.row.id} filename=${g.row.filename} challenge_submissions ${g.prev.length} → ${g.next.length}`
			);
		}
	}

	if (dryRun) {
		console.log('dry-run: no writes');
		return;
	}

	const messageIds = stale.map((s) => s.message_id);
	await repairLastReadPointersForDeletedMessages({
		sb,
		threadId,
		deleteMessageIds: messageIds
	});
	const { error: delErr } = await sb.from(MESSAGES_TABLE).delete().in('id', messageIds);
	if (delErr) throw delErr;
	console.log(`deleted ${messageIds.length} challenge_submission message(s)`);

	const removedByCreation = new Map();
	for (const s of stale) {
		if (!removedByCreation.has(s.created_image_id)) removedByCreation.set(s.created_image_id, []);
		removedByCreation.get(s.created_image_id).push(s);
	}

	for (const [creationId, rows] of removedByCreation) {
		const img = imgById.get(creationId);
		if (!img) continue;
		const meta = parseMeta(img.meta);
		const prev = Array.isArray(meta.challenge_submissions) ? meta.challenge_submissions : [];
		const next = filterChallengeSubmissionsNotMatching(
			prev,
			new Set(rows.map((r) => r.message_id)),
			new Set(rows.map((r) => r.challenge_id).filter(Boolean))
		);
		if (next.length === prev.length) {
			console.log(`  creation ${creationId}: meta unchanged (${prev.length} submission stamp(s))`);
			continue;
		}
		const { error: upErr } = await sb
			.from(CREATIONS_TABLE)
			.update({ meta: { ...meta, challenge_submissions: next } })
			.eq('id', creationId);
		if (upErr) throw upErr;
		console.log(`  creation ${creationId}: challenge_submissions ${prev.length} → ${next.length}`);
	}

	for (const g of groupsToHeal) {
		if (!g.stampChange) {
			console.log(`  group ${g.row.id}: no copied challenge_submissions to strip`);
			continue;
		}
		const { error: upErr } = await sb
			.from(CREATIONS_TABLE)
			.update({ meta: { ...g.meta, challenge_submissions: g.next } })
			.eq('id', g.row.id);
		if (upErr) throw upErr;
		console.log(`  group ${g.row.id}: challenge_submissions ${g.prev.length} → ${g.next.length}`);
	}

	const { data: lastRow } = await sb
		.from(MESSAGES_TABLE)
		.select('id')
		.eq('thread_id', threadId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	const lastId = Number(lastRow?.id);
	if (Number.isFinite(lastId) && lastId > 0) {
		await broadcastRoomDirty(threadId, lastId);
	}
	const mem = await sb.from(MEMBERS_TABLE).select('user_id').eq('thread_id', threadId);
	const uids = Array.isArray(mem.data) ? mem.data.map((r) => r.user_id) : [];
	await broadcastUserInboxDirty(threadId, uids);
	await invalidateChallengeFeedSnapshotCache();
	console.log('broadcast + feed snapshot invalidate done');
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exitCode = 1;
});
