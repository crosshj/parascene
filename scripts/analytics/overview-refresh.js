#!/usr/bin/env node
/**
 * Overview report — refresh (ETL).
 *
 * Fetches Supabase (+ optional live Redis for today) and writes the compact
 * local data store the static overview app reads. This is the ONLY piece that
 * touches the DB; it never regenerates the app HTML. "Re-run the report" = run
 * this, then reload the page.
 *
 * Output (default): .output/overview/store.json  →  fetched by the report app.
 *   node scripts/analytics/overview-refresh.js              # incremental (default)
 *   node scripts/analytics/overview-refresh.js --full         # full rebuild from DB
 *   node scripts/analytics/overview-refresh.js --out .output/overview/store.json
 *   node scripts/analytics/overview-refresh.js --no-live    # skip today's Redis snapshot
 *
 * Store shape (v1) is pinned in scripts/analytics/overview/metrics.js.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import {
	usEastDayKey,
	usEastDayStartMs,
	yesterdayUsEastDayKey
} from "../../api_routes/utils/visitPulseCore.js";
import { SCHEMA_VERSION, CORE_ACTION_TYPES } from "./overview/metrics.js";
import { findChallengesChannelThreadId } from "../../api_routes/utils/challengeSubmitShared.js";
import { extractChallengeEvents } from "../../src/chat/challenges/model/extractEvents.js";
import { summarizeLatestChallengeConfigs } from "../../src/chat/challenges/model/organizerSummaries.js";
import { mergeFullChallengeConfigForChallenge, pickChallengeConfigTimestamp } from "../../src/chat/challenges/challengeAdmin.js";
import { deriveChallengePhase } from "../../src/chat/challenges/model/phases.js";
import { buildReactionsByMessageId } from "../../src/chat/challenges/model/participantSlice.js";
import { CHALLENGE_SCORE_REACTION_KEYS, challengeReactionKeyToScore } from "../../src/chat/challenges/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const HOURS_PER_DAY = 24;
const HOUR_MS = 60 * 60 * 1000;

function getArg(name) {
	const argv = process.argv.slice(2);
	const long = `--${name}`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long && argv[i + 1] != null && !argv[i + 1].startsWith("--")) return String(argv[i + 1]).trim();
		if (argv[i].startsWith(`${long}=`)) return argv[i].slice(long.length + 1).trim();
	}
	return "";
}

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

function safeDate(value) {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function parseMeta(value) {
	if (value == null) return {};
	if (typeof value === "object") return value;
	try {
		return JSON.parse(String(value));
	} catch {
		return {};
	}
}

function isPaidUser(meta) {
	return Boolean(meta?.plan === "founder" || (meta?.stripeSubscriptionId && String(meta.stripeSubscriptionId).trim()));
}

function dayKeyOf(tsRaw) {
	const d = safeDate(tsRaw);
	return d ? usEastDayKey(d) : null;
}

async function fetchSupabaseRows(client, table, columns, { applyFilter } = {}) {
	const pageSize = 1000;
	const out = [];
	let from = 0;
	while (true) {
		const to = from + pageSize - 1;
		let q = client.from(table).select(columns);
		if (applyFilter) q = applyFilter(q);
		const { data, error } = await q.range(from, to);
		if (error) throw new Error(`Supabase ${table}: ${error.message}`);
		const rows = Array.isArray(data) ? data : [];
		out.push(...rows);
		if (rows.length < pageSize) break;
		from += rows.length;
	}
	return out;
}

async function readExistingStore(outPath) {
	try {
		const raw = await fs.readFile(outPath, "utf8");
		const store = JSON.parse(raw);
		if (!store?.meta || store.meta.schemaVersion !== SCHEMA_VERSION) return null;
		return store;
	} catch {
		return null;
	}
}

/** Keep rows before sinceDay; replace rows on/after sinceDay with fresh. */
function mergeByDayKey(existing, fresh, key, sinceDay) {
	if (!sinceDay) return fresh;
	const kept = (existing || []).filter((r) => String(r[key]) < sinceDay);
	const next = (fresh || []).filter((r) => String(r[key]) >= sinceDay);
	return [...kept, ...next].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

/** Active partition hours (0..23) a pulse visitor touched on a given US-East day. */
function visitorActiveHours(visitor, dayStartMs) {
	const hours = new Set();
	const dayEnd = dayStartMs + HOURS_PER_DAY * HOUR_MS;
	for (const [startIso, endIso] of visitor.ranges || []) {
		const startMs = Date.parse(startIso);
		const endMs = Date.parse(endIso);
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
		const clipStart = Math.max(startMs, dayStartMs);
		const clipEnd = Math.min(endMs, dayEnd);
		if (clipEnd <= clipStart) continue;
		const h0 = Math.floor((clipStart - dayStartMs) / HOUR_MS);
		const h1 = Math.floor((clipEnd - 1 - dayStartMs) / HOUR_MS);
		for (let h = Math.max(0, h0); h <= h1 && h < HOURS_PER_DAY; h++) hours.add(h);
	}
	return hours;
}

/** Build one StoreVisitDay from a pulse row (DB row or Redis snapshot). */
function buildVisitDay(row) {
	const day = String(row.day);
	const dayStartMs = usEastDayStartMs(day);
	const visitors = Array.isArray(row?.details?.visitors) ? row.details.visitors : [];
	const hourlyAuthed = new Array(HOURS_PER_DAY).fill(0);
	const hourlyAnon = new Array(HOURS_PER_DAY).fill(0);
	const visitorKeys = [];
	const authedDetail = [];
	for (const v of visitors) {
		const key = v.visitor_key || (v.user_id != null ? `u:${v.user_id}` : v.client_id ? `v:${v.client_id}` : null);
		if (key) visitorKeys.push(key);
		const authed = v.user_id != null;
		const hours = visitorActiveHours(v, dayStartMs);
		for (const h of hours) {
			if (authed) hourlyAuthed[h]++;
			else hourlyAnon[h]++;
		}
		// Per-logged-in-user breakdown (small: authed visitors are few) so the report
		// can show HOW each user was present — hits + which hours they were active.
		if (authed) {
			authedDetail.push({
				id: Number(v.user_id),
				hits: Number(v.hits) || 0,
				hours: [...hours].sort((a, b) => a - b)
			});
		}
	}
	authedDetail.sort((a, b) => b.hits - a.hits);
	return {
		day,
		hits: Number(row.total_hits) || 0,
		blocks: Number(row.total_active_blocks) || 0,
		uniqueVisitors: Number(row.unique_visitors) || 0,
		authedVisitors: Number(row.authed_visitors) || 0,
		anonVisitors: Number(row.anon_visitors) || 0,
		hourlyAuthed,
		hourlyAnon,
		visitorKeys,
		authed: authedDetail,
		feedImpressions: row?.details?.feed_impressions ?? null,
		landingFunnel: row?.details?.landing_funnel ?? null
	};
}

async function loadUsers() {
	const { openDb } = await import("../../db/index.js");
	const dbInstance = await openDb({ quiet: true });
	const usersRaw = await dbInstance?.queries?.selectUsers?.all?.();
	const allowed = (Array.isArray(usersRaw) ? usersRaw : [])
		.map((row) => {
			const meta = parseMeta(row.meta);
			return {
				id: Number(row.id),
				created_at: row.created_at,
				role: row.role,
				suspended: meta?.suspended === true,
				paid: isPaidUser(meta)
			};
		})
		.filter((u) => u.role === "consumer" && !u.suspended && Number.isFinite(u.id));
	const labels = await resolveUserLabels(allowed.map((u) => u.id));
	const users = allowed.map((u) => {
		const info = labels.get(u.id);
		return {
			id: u.id,
			signupDay: dayKeyOf(u.created_at) || null,
			paid: u.paid,
			label: info?.label ?? null,
			userName: info?.user_name ?? null
		};
	});
	return { users, allowedIds: new Set(allowed.map((u) => u.id)) };
}

async function resolveUserLabels(userIds) {
	const ids = [...new Set(userIds.filter((id) => Number.isFinite(Number(id))).map(Number))];
	if (!ids.length) return new Map();
	const { openDb } = await import("../../db/index.js");
	const { getNotificationDisplayName } = await import("../../api_routes/utils/displayName.js");
	const { queries } = await openDb({ quiet: true });
	const profiles =
		typeof queries.selectUserProfilesByUserIds === "function" ? await queries.selectUserProfilesByUserIds(ids) : new Map();
	const users = typeof queries.selectUsersByIds === "function" ? await queries.selectUsersByIds(ids) : new Map();
	const out = new Map();
	for (const id of ids) {
		const profile = profiles.get(id);
		const user = users.get(id);
		out.set(id, {
			user_id: id,
			user_name: profile?.user_name ?? null,
			label: getNotificationDisplayName(
				{ email: user?.email, display_name: profile?.display_name, user_name: profile?.user_name },
				profile
			)
		});
	}
	return out;
}

/** Handles for authed visit-pulse users not in the consumer `users` list (admin, etc.). */
async function loadVisitUserHandles(visitDaily, users) {
	const known = new Set((users || []).map((u) => u.id));
	const extra = new Set();
	for (const row of visitDaily || []) {
		for (const a of row.authed || []) {
			const id = Number(a.id);
			if (Number.isFinite(id) && id > 0 && !known.has(id)) extra.add(id);
		}
	}
	if (!extra.size) return [];
	const labels = await resolveUserLabels([...extra]);
	return [...extra]
		.sort((a, b) => a - b)
		.map((id) => ({ id, userName: labels.get(id)?.user_name ?? null }));
}

/** Aggregate event tables into per-(user, day) core-action counts. */
async function loadUserDay(client, allowedIds, { sinceDay } = {}) {
	const sinceIso = sinceDay ? new Date(usEastDayStartMs(sinceDay)).toISOString() : null;
	const sinceFilter = (col) => (sinceIso ? (q) => q.gte(col, sinceIso) : undefined);

	const [createdImages, comments, likes, reactions, tips, sessions, follows, chats] = await Promise.all([
		sinceIso
			? fetchSupabaseRows(client, "prsn_created_images", "user_id,created_at,published_at,meta", {
					applyFilter: (q) => q.or(`created_at.gte.${sinceIso},published_at.gte.${sinceIso}`)
				})
			: fetchSupabaseRows(client, "prsn_created_images", "user_id,created_at,published_at,meta"),
		fetchSupabaseRows(client, "prsn_comments_created_image", "user_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_likes_created_image", "user_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_comment_reactions", "user_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_tip_activity", "from_user_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_sessions", "user_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_user_follows", "follower_id,created_at", { applyFilter: sinceFilter("created_at") }),
		fetchSupabaseRows(client, "prsn_chat_messages", "sender_id,created_at", { applyFilter: sinceFilter("created_at") })
	]);

	const byKey = new Map();
	const bump = (userIdRaw, tsRaw, type, n = 1) => {
		const userId = Number(userIdRaw);
		if (!Number.isFinite(userId) || userId <= 0 || !allowedIds.has(userId)) return;
		const day = dayKeyOf(tsRaw);
		if (!day) return;
		const k = `${userId}|${day}`;
		let rec = byKey.get(k);
		if (!rec) {
			rec = { u: userId, d: day, c: {} };
			byKey.set(k, rec);
		}
		rec.c[type] = (rec.c[type] || 0) + n;
	};

	for (const row of createdImages) {
		bump(row.user_id, row.created_at, "creation");
		const meta = parseMeta(row?.meta);
		const mid = Number(meta?.mutate_of_id);
		if (Number.isFinite(mid) && mid > 0) bump(row.user_id, row.created_at, "mutations");
		if (row.published_at) bump(row.user_id, row.published_at, "publish");
	}
	for (const row of comments) bump(row.user_id, row.created_at, "comment");
	for (const row of likes) bump(row.user_id, row.created_at, "like");
	for (const row of reactions) bump(row.user_id, row.created_at, "reaction");
	for (const row of tips) bump(row.from_user_id, row.created_at, "tip_sent");
	for (const row of sessions) bump(row.user_id, row.created_at, "session");
	for (const row of follows) bump(row.follower_id, row.created_at, "follows");
	for (const row of chats) bump(row.sender_id, row.created_at, "chat");

	return [...byKey.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.u - b.u));
}

async function loadVisitDaily(client, { sinceDay } = {}) {
	const rows = await fetchSupabaseRows(
		client,
		"prsn_visit_pulse_days",
		"day, unique_visitors, authed_visitors, anon_visitors, total_hits, total_active_blocks, flushed_at, details",
		{ applyFilter: sinceDay ? (q) => q.gte("day", sinceDay) : undefined }
	);
	return rows
		.filter((r) => r?.day)
		.map(buildVisitDay)
		.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

async function loadFunnelDaily(client, { sinceDay } = {}) {
	const sinceIso = sinceDay ? new Date(usEastDayStartMs(sinceDay)).toISOString() : null;
	const [shareRows, tryRows] = await Promise.all([
		fetchSupabaseRows(client, "prsn_share_page_views", "viewed_at,anon_cid", {
			applyFilter: sinceIso ? (q) => q.gte("viewed_at", sinceIso) : undefined
		}),
		fetchSupabaseRows(client, "prsn_try_requests", "anon_cid,created_at,meta", {
			applyFilter: sinceIso ? (q) => q.gte("created_at", sinceIso) : undefined
		})
	]);
	const byDay = new Map();
	const get = (day) => {
		let rec = byDay.get(day);
		if (!rec) {
			rec = { day, shareViews: 0, _shareCids: new Set(), tryRequests: 0, _tryCids: new Set(), _transUsers: new Set() };
			byDay.set(day, rec);
		}
		return rec;
	};
	for (const row of shareRows) {
		const day = dayKeyOf(row.viewed_at);
		if (!day) continue;
		const rec = get(day);
		rec.shareViews++;
		const cid = String(row.anon_cid || "").trim();
		if (cid) rec._shareCids.add(cid);
	}
	for (const row of tryRows) {
		const day = dayKeyOf(row.created_at);
		if (!day) continue;
		const cid = String(row.anon_cid || "").trim();
		if (!cid || cid === "__pool__") continue;
		const rec = get(day);
		rec.tryRequests++;
		rec._tryCids.add(cid);
		const meta = parseMeta(row.meta);
		const tu = Number(meta?.transitioned?.user_id);
		if (Number.isFinite(tu) && tu > 0) rec._transUsers.add(tu);
	}
	return [...byDay.values()]
		.sort((a, b) => (a.day < b.day ? -1 : 1))
		.map((r) => ({
			day: r.day,
			shareViews: r.shareViews,
			shareCids: r._shareCids.size,
			tryRequests: r.tryRequests,
			tryCids: r._tryCids.size,
			transitionedUsers: r._transUsers.size
		}));
}

/** Best-effort live snapshot of today's US-East partition from Redis. */
async function loadTodayLive() {
	try {
		const { buildDaySnapshotFromRedis } = await import("../../api_routes/utils/visitPulseCore.js");
		const { Redis } = await import("@upstash/redis");
		const redis = Redis.fromEnv();
		const dayKey = usEastDayKey();
		const snapshot = await buildDaySnapshotFromRedis(dayKey, redis);
		if (!snapshot || !Number(snapshot.unique_visitors)) return null;
		return buildVisitDay(snapshot);
	} catch (err) {
		console.warn("[overview-refresh] live Redis snapshot skipped:", err?.message || err);
		return null;
	}
}

/* -------------------------------------------------------------- */
/* Related-grid ("click-next") transitions.                       */
/* -------------------------------------------------------------- */

function creationLabelFrom(row) {
	if (!row) return null;
	const meta = parseMeta(row.meta);
	const prompt = meta?.prompt || meta?.args?.prompt || meta?.title || meta?.caption;
	const snippet = prompt ? String(prompt).trim().slice(0, 60) : null;
	return snippet ? `#${row.id} — ${snippet}` : `#${row.id}`;
}

async function loadTransitions(client) {
	let rows;
	try {
		rows = await fetchSupabaseRows(
			client,
			"prsn_related_transitions",
			"from_created_image_id,to_created_image_id,count,last_updated"
		);
	} catch (err) {
		console.warn("[overview-refresh] transitions skipped:", err?.message || err);
		return { transitionsDaily: [], transitionsTop: [] };
	}

	const byDay = new Map();
	for (const r of rows) {
		const day = dayKeyOf(r.last_updated);
		if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
	}
	const transitionsDaily = [...byDay.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([day, paths]) => ({ day, paths }));

	const top = [...rows]
		.sort((a, b) => Number(b.count) - Number(a.count) || String(a.last_updated).localeCompare(String(b.last_updated)))
		.slice(0, 50);
	const ids = [...new Set(top.flatMap((r) => [Number(r.from_created_image_id), Number(r.to_created_image_id)]))];
	const labelById = new Map();
	for (let i = 0; i < ids.length; i += 200) {
		const chunk = ids.slice(i, i + 200);
		const { data } = await client.from("prsn_created_images").select("id,meta").in("id", chunk);
		for (const row of data || []) labelById.set(Number(row.id), creationLabelFrom(row));
	}
	const transitionsTop = top.map((r) => {
		const from = Number(r.from_created_image_id);
		const to = Number(r.to_created_image_id);
		return {
			from,
			to,
			count: Number(r.count) || 0,
			lastDay: dayKeyOf(r.last_updated),
			fromLabel: labelById.get(from) || `#${from}`,
			toLabel: labelById.get(to) || `#${to}`
		};
	});
	return { transitionsDaily, transitionsTop };
}

/* -------------------------------------------------------------- */
/* Challenge participation (#challenges channel).                 */
/* -------------------------------------------------------------- */

function submissionsForChallenge(submissions, challengeId) {
	const cid = String(challengeId || "").trim();
	if (!cid) return [];
	return submissions.filter((s) => String(s.payload?.challenge_id ?? "").trim() === cid);
}

function votesFromReactions(reactions) {
	const out = [];
	if (!reactions || typeof reactions !== "object") return out;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		if (challengeReactionKeyToScore(key) == null) continue;
		const raw = reactions[key];
		if (!Array.isArray(raw)) continue;
		for (const entry of raw) {
			const uid = Number(entry);
			if (Number.isFinite(uid) && uid > 0) out.push(uid);
		}
	}
	return out;
}

async function fetchThreadMessages(client, threadId) {
	const rows = [];
	let offset = 0;
	const pageSize = 500;
	while (true) {
		const { data, error } = await client
			.from("prsn_chat_messages")
			.select("id, created_at, sender_id, reactions, body")
			.eq("thread_id", threadId)
			.order("created_at", { ascending: true })
			.order("id", { ascending: true })
			.range(offset, offset + pageSize - 1);
		if (error) throw error;
		if (!data?.length) break;
		rows.push(...data);
		if (data.length < pageSize) break;
		offset += data.length;
	}
	return rows;
}

async function loadChallenges(client) {
	const empty = { challenges: [], challengeSubs: [], challengeVotes: [] };
	try {
		const threadId = await findChallengesChannelThreadId(client);
		if (!threadId) return empty;
		const [{ count: memberCount }, messages] = await Promise.all([
			client.from("prsn_chat_members").select("user_id", { count: "exact", head: true }).eq("thread_id", threadId),
			fetchThreadMessages(client, threadId)
		]);
		const { configs, submissions } = extractChallengeEvents(messages);
		const summaries = summarizeLatestChallengeConfigs(configs);
		const reactionMap = buildReactionsByMessageId(messages);
		const nowMs = Date.now();

		const challenges = [];
		const challengeSubs = [];
		const challengeVotes = [];
		for (const summary of summaries) {
			const cid = String(summary.challenge_id || "").trim();
			if (!cid) continue;
			const merged = mergeFullChallengeConfigForChallenge(configs, cid);
			const dayOf = (key) => {
				const iso = pickChallengeConfigTimestamp(merged, key);
				return iso ? usEastDayKey(new Date(iso)) : null;
			};
			challenges.push({
				id: cid,
				title: typeof merged.title === "string" && merged.title.trim() ? merged.title.trim() : `Challenge ${cid}`,
				phase: deriveChallengePhase(merged, nowMs),
				subStartDay: dayOf("submission_start_at"),
				subEndDay: dayOf("submission_end_at"),
				voteStartDay: dayOf("voting_start_at"),
				voteEndDay: dayOf("voting_end_at"),
				memberCount: Number.isFinite(memberCount) ? memberCount : null
			});
			for (const { msg } of submissionsForChallenge(submissions, cid)) {
				const u = Number(msg?.sender_id);
				const d = dayKeyOf(msg?.created_at);
				if (!Number.isFinite(u) || u <= 0 || !d) continue;
				challengeSubs.push({ d, u, c: cid });
				const reactions = (msg?.id != null && reactionMap.get(Number(msg.id))) || msg?.reactions || {};
				for (const voter of votesFromReactions(reactions)) {
					challengeVotes.push({ u: voter, c: cid, to: u });
				}
			}
		}
		return { challenges, challengeSubs, challengeVotes };
	} catch (err) {
		console.warn("[overview-refresh] challenges skipped:", err?.message || err);
		return empty;
	}
}

function computeLaunchDay({ users, userDay, visitDaily }) {
	const candidates = [];
	for (const u of users) if (u.signupDay) candidates.push(u.signupDay);
	if (userDay.length) candidates.push(userDay[0].d);
	if (visitDaily.length) candidates.push(visitDaily[0].day);
	return candidates.length ? candidates.reduce((a, b) => (a < b ? a : b)) : usEastDayKey();
}

async function main() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	const client = createClient(url, key, { auth: { persistSession: false } });

	const outJson =
		getArg("out") || process.env.OUT || path.join(REPO_ROOT, ".output", "overview", "store.json");
	const existing = hasFlag("full") ? null : await readExistingStore(outJson);
	const full = hasFlag("full") || !existing;
	const sinceDay = full ? null : existing.meta.lastCompleteDay;

	console.log(
		full
			? "[overview-refresh] mode: full rebuild"
			: `[overview-refresh] mode: incremental (since ${sinceDay})`
	);

	const { users, allowedIds } = await loadUsers();
	const [freshUserDay, freshVisitDaily, freshFunnelDaily, transitions, challengeData] = await Promise.all([
		loadUserDay(client, allowedIds, { sinceDay }),
		loadVisitDaily(client, { sinceDay }),
		loadFunnelDaily(client, { sinceDay }),
		loadTransitions(client),
		loadChallenges(client)
	]);

	let userDay = freshUserDay;
	let visitDaily = freshVisitDaily;
	let funnelDaily = freshFunnelDaily;
	if (!full) {
		userDay = mergeByDayKey(existing.userDay, freshUserDay, "d", sinceDay);
		visitDaily = mergeByDayKey(existing.visitDaily, freshVisitDaily, "day", sinceDay);
		funnelDaily = mergeByDayKey(existing.funnelDaily, freshFunnelDaily, "day", sinceDay);
	}
	const userHandles = await loadVisitUserHandles(visitDaily, users);

	if (!hasFlag("no-live")) {
		const today = await loadTodayLive();
		if (today) {
			const idx = visitDaily.findIndex((r) => r.day === today.day);
			if (idx >= 0) visitDaily[idx] = today;
			else visitDaily.push(today);
			visitDaily.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
		}
	}

	const launchDay = computeLaunchDay({ users, userDay, visitDaily });
	const store = {
		meta: {
			schemaVersion: SCHEMA_VERSION,
			tz: "US East (UTC-5, no DST)",
			launchDay,
			lastCompleteDay: yesterdayUsEastDayKey(),
			lastRefresh: new Date().toISOString(),
			coreActionTypes: CORE_ACTION_TYPES
		},
		users,
		userHandles,
		userDay,
		visitDaily,
		funnelDaily,
		transitionsDaily: transitions.transitionsDaily,
		transitionsTop: transitions.transitionsTop,
		challenges: challengeData.challenges,
		challengeSubs: challengeData.challengeSubs,
		challengeVotes: challengeData.challengeVotes
	};

	const outJsonPath = outJson;
	await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
	const json = JSON.stringify(store);
	await fs.writeFile(outJsonPath, json, "utf8");

	console.log(
		`[overview-refresh] wrote ${outJsonPath}\n` +
			`  users=${users.length} userDay=${userDay.length} visitDays=${visitDaily.length} funnelDays=${funnelDaily.length}\n` +
			`  transitionDays=${transitions.transitionsDaily.length} topPaths=${transitions.transitionsTop.length} ` +
			`challenges=${challengeData.challenges.length} challengeSubs=${challengeData.challengeSubs.length} challengeVotes=${challengeData.challengeVotes.length}\n` +
			`  launch=${launchDay} lastComplete=${store.meta.lastCompleteDay} size=${(json.length / 1024).toFixed(1)}KB`
	);
}

main().catch((err) => {
	console.error("[overview-refresh]", err?.message || err);
	process.exit(1);
});
