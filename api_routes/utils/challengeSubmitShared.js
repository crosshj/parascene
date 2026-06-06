import { deriveChallengePhase } from "../../src/chat/challenges/model/phases.js";
import { pickChallengeHeroImageUrl } from "../../src/chat/challenges/challengeAdmin.js";

const MAX_NOTE_CHARS = 500;
const MESSAGE_FETCH_LIMIT = 500;
const RECENT_SELF_SCAN = 120;

/**
 * @param {unknown} body
 */
export function tryParseChallengeJsonBody(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || (!s.startsWith("{") && !s.startsWith("["))) return null;
	try {
		const o = JSON.parse(s);
		return o && typeof o === "object" && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

/**
 * @param {{ body?: unknown, created_at?: string }[]} messagesAsc chronological
 * @returns {object | null} latest challenge_config payload
 */
export function pickLatestChallengeConfigPayload(messagesAsc) {
	let latest = null;
	let latestTs = -1;
	for (const m of messagesAsc) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		const t = Date.parse(m.created_at || "");
		if (Number.isFinite(t) && t >= latestTs) {
			latestTs = t;
			latest = p;
		}
	}
	return latest;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeChallengeOrganizerUserNames(raw) {
	const list = Array.isArray(raw) ? raw : [];
	const out = [];
	const seen = new Set();
	for (const entry of list) {
		const u = String(entry || "").trim().replace(/^@+/, "").toLowerCase();
		if (!u || seen.has(u)) continue;
		seen.add(u);
		out.push(u);
	}
	return out;
}

/**
 * @param {{ body?: unknown, id?: unknown }[]} messagesAsc chronological
 * @returns {{ payload: object, messageId: number } | null}
 */
export function pickLatestChallengesGlobalConfigPayload(messagesAsc) {
	let latest = null;
	let latestSortId = -1;
	for (const m of messagesAsc || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenges_global_config") continue;
		const mid = Number(m?.id);
		const sortId = Number.isFinite(mid) && mid > 0 ? Math.floor(mid) : 0;
		if (sortId >= latestSortId) {
			latestSortId = sortId;
			latest = { payload: p, messageId: sortId };
		}
	}
	return latest;
}

/**
 * @param {{ body?: unknown, id?: unknown }[]} messagesAsc chronological
 */
export function resolveChallengeOrganizerAllowlistFromMessages(messagesAsc) {
	const globalCfg = pickLatestChallengesGlobalConfigPayload(messagesAsc);
	if (globalCfg) {
		return normalizeChallengeOrganizerUserNames(globalCfg.payload?.organizer_user_names);
	}
	return [];
}

/**
 * @param {object | null | undefined} meta
 * @param {number} threadId
 * @param {string} challengeId
 */
export function metaHasChallengeSubmission(meta, threadId, challengeId) {
	const arr = meta?.challenge_submissions;
	if (!Array.isArray(arr)) return false;
	const tid = Number(threadId);
	const cid = String(challengeId || "").trim();
	return arr.some(
		(x) =>
			x &&
			typeof x === "object" &&
			Number(x.thread_id) === tid &&
			String(x.challenge_id || "").trim() === cid
	);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 * @param {number} userId
 */
export async function isChatThreadMember(sb, threadId, userId) {
	const { data, error } = await sb
		.from("prsn_chat_members")
		.select("user_id")
		.eq("thread_id", threadId)
		.eq("user_id", userId)
		.maybeSingle();
	if (error) throw error;
	return !!data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 */
export async function fetchChatChannelThreadRow(sb, threadId) {
	const { data, error } = await sb
		.from("prsn_chat_threads")
		.select("type, channel_slug, meta, dm_pair_key")
		.eq("id", threadId)
		.maybeSingle();
	if (error) throw error;
	return data || null;
}

/**
 * Canonical #challenges channel thread id (global channel row).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @returns {Promise<number | null>}
 */
export async function findChallengesChannelThreadId(sb) {
	const { data, error } = await sb
		.from("prsn_chat_threads")
		.select("id")
		.eq("type", "channel")
		.eq("channel_slug", "challenges")
		.maybeSingle();
	if (error) throw error;
	const id = Number(data?.id);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 */
export async function fetchThreadMessagesChronological(sb, threadId, limit = MESSAGE_FETCH_LIMIT) {
	const { data, error } = await sb
		.from("prsn_chat_messages")
		.select("id, body, created_at, sender_id, reactions")
		.eq("thread_id", threadId)
		.order("created_at", { ascending: true })
		.limit(limit);
	if (error) throw error;
	return Array.isArray(data) ? data : [];
}

/**
 * Recent thread messages, newest first (for resolving latest challenge_config rows).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 * @param {number} [limit]
 */
export async function fetchThreadMessagesNewestFirst(sb, threadId, limit = MESSAGE_FETCH_LIMIT) {
	const { data, error } = await sb
		.from("prsn_chat_messages")
		.select("id, body, created_at, sender_id, reactions")
		.eq("thread_id", threadId)
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(limit);
	if (error) throw error;
	return Array.isArray(data) ? data : [];
}

/**
 * Viewer may load another user's unpublished challenge entry when it is referenced by an existing
 * `challenge_submission` chat message in #challenges and the viewer is a thread member (same gate as submissions).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{
 *   ancestorRow: { id?: unknown, unavailable_at?: unknown },
 *   challengeMessageId: number,
 *   viewerUserId: number,
 * }} args
 */
export async function canViewUnpublishedCreationViaChallengeMessage(sb, args) {
	const ancestorRow = args?.ancestorRow;
	const mid = Number(args?.challengeMessageId);
	const vid = Number(args?.viewerUserId);
	if (!ancestorRow || !Number.isFinite(mid) || mid <= 0 || !Number.isFinite(vid) || vid <= 0) {
		return false;
	}
	if (ancestorRow.unavailable_at != null && ancestorRow.unavailable_at !== "") return false;

	const { data: row, error } = await sb
		.from("prsn_chat_messages")
		.select("id, thread_id, body")
		.eq("id", mid)
		.maybeSingle();
	if (error) throw error;
	if (!row) return false;

	const p = tryParseChallengeJsonBody(row.body);
	if (!p || String(p.kind || "").trim() !== "challenge_submission") return false;
	const imgFromMsg = p.created_image_id != null ? Number(p.created_image_id) : NaN;
	if (!Number.isFinite(imgFromMsg) || imgFromMsg !== Number(ancestorRow.id)) return false;

	const tid = Number(row.thread_id);
	if (!Number.isFinite(tid) || tid <= 0) return false;

	const threadRow = await fetchChatChannelThreadRow(sb, tid);
	const slug = String(threadRow?.channel_slug || "").toLowerCase();
	if (!threadRow || threadRow.type !== "channel" || slug !== "challenges") return false;

	return isChatThreadMember(sb, tid, vid);
}

/**
 * Parse a creation id from challenge hero reference strings (`/creations/:id`, API paths, or full URLs).
 * @param {unknown} raw
 * @returns {number}
 */
export function parseCreationIdFromChallengeHeroRef(raw) {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return NaN;

	const fromPlainPath = (text) => {
		const m1 = text.match(/\/creations\/(\d+)(?:\D|$)/i);
		if (m1) return Number(m1[1]);
		const m2 = text.match(/\/(?:api\/)?create\/images\/(\d+)(?:\D|$)/i);
		if (m2) return Number(m2[1]);
		return NaN;
	};

	const plain = fromPlainPath(s);
	if (Number.isFinite(plain) && plain > 0) return plain;

	try {
		const u = new URL(s, "https://www.parascene.com");
		const path = `${u.pathname || ""}${u.search || ""}`;
		const fromUrlPath = fromPlainPath(path);
		if (Number.isFinite(fromUrlPath) && fromUrlPath > 0) return fromUrlPath;
	} catch {
		// ignore
	}
	return NaN;
}

/**
 * Latest `challenge_config` payload for a given challenge id (newest messages first).
 * @param {{ body?: unknown, created_at?: string }[]} messagesNewestFirst
 * @param {unknown} challengeId
 * @returns {object | null}
 */
export function pickLatestChallengeConfigForChallengeId(messagesNewestFirst, challengeId) {
	const cid = String(challengeId || "").trim();
	if (!cid) return null;
	for (const m of messagesNewestFirst || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		if (String(p.challenge_id || "").trim() !== cid) continue;
		return p;
	}
	return null;
}

/**
 * @param {{ body?: unknown, created_at?: string }[]} messagesNewestFirst
 * @returns {Map<string, { payload: object, created_at?: string }>}
 */
export function latestChallengeConfigByChallengeId(messagesNewestFirst) {
	const map = new Map();
	for (const m of messagesNewestFirst || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		const cid = String(p.challenge_id || "").trim();
		if (!cid || map.has(cid)) continue;
		map.set(cid, { payload: p, created_at: m.created_at });
	}
	return map;
}

/**
 * Walk newest challenge_config rows for `challengeId` until a hero ref matches `creationId`
 * (handles partial config updates that omit hero_image_url on the latest row).
 * @param {{ body?: unknown }[]} messagesNewestFirst
 * @param {string} challengeId
 * @param {number} creationId
 */
export function challengeHeroCreationMatchesInRecentConfigs(messagesNewestFirst, challengeId, creationId) {
	const cid = String(challengeId || "").trim();
	const targetId = Number(creationId);
	if (!cid || !Number.isFinite(targetId) || targetId <= 0) return false;
	for (const m of messagesNewestFirst || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		if (String(p.challenge_id || "").trim() !== cid) continue;
		const heroRef = pickChallengeHeroImageUrl(p);
		if (!heroRef) continue;
		const heroCreationId = parseCreationIdFromChallengeHeroRef(heroRef);
		if (Number.isFinite(heroCreationId) && heroCreationId === targetId) return true;
	}
	return false;
}

/**
 * Viewer may load another user's unpublished creation when it is the configured hero image
 * for a challenge in #challenges.
 *
 * When `challengeId` is omitted, any recent challenge config whose hero ref resolves to the
 * creation id is accepted (supports clients that have not yet passed `?challenge_id=`).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{
 *   ancestorRow: { id?: unknown, unavailable_at?: unknown },
 *   challengeId?: string,
 *   viewerUserId: number,
 * }} args
 */
export async function canViewUnpublishedCreationViaChallengeHero(sb, args) {
	const ancestorRow = args?.ancestorRow;
	const challengeId = String(args?.challengeId || "").trim();
	const vid = Number(args?.viewerUserId);
	if (!ancestorRow || !Number.isFinite(vid) || vid <= 0) {
		return false;
	}
	if (ancestorRow.unavailable_at != null && ancestorRow.unavailable_at !== "") return false;

	const threadId = await findChallengesChannelThreadId(sb);
	if (!threadId) return false;

	const threadRow = await fetchChatChannelThreadRow(sb, threadId);
	const slug = String(threadRow?.channel_slug || "").toLowerCase();
	if (!threadRow || threadRow.type !== "channel" || slug !== "challenges") return false;

	const messagesNewest = await fetchThreadMessagesNewestFirst(sb, threadId);

	if (challengeId) {
		return challengeHeroCreationMatchesInRecentConfigs(
			messagesNewest,
			challengeId,
			ancestorRow.id
		);
	}

	for (const cid of latestChallengeConfigByChallengeId(messagesNewest).keys()) {
		if (challengeHeroCreationMatchesInRecentConfigs(messagesNewest, cid, ancestorRow.id)) {
			return true;
		}
	}
	return false;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 * @param {number} senderId
 * @param {number} creationId
 * @param {string} challengeId
 */
export async function findDuplicateChallengeSubmissionMessage(sb, threadId, senderId, creationId, challengeId) {
	const { data, error } = await sb
		.from("prsn_chat_messages")
		.select("body")
		.eq("thread_id", threadId)
		.eq("sender_id", senderId)
		.order("created_at", { ascending: false })
		.limit(RECENT_SELF_SCAN);
	if (error) throw error;
	const cid = String(challengeId || "").trim();
	const idNum = Number(creationId);
	for (const row of Array.isArray(data) ? data : []) {
		const p = tryParseChallengeJsonBody(row?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_submission") continue;
		const pc = p.challenge_id != null ? String(p.challenge_id).trim() : "";
		const img = p.created_image_id != null ? Number(p.created_image_id) : NaN;
		if (pc === cid && Number.isFinite(img) && img === idNum) return true;
	}
	return false;
}

/**
 * @param {{
 *   sb: import("@supabase/supabase-js").SupabaseClient,
 *   userId: number,
 *   ownerUserId: number,
 *   creationId: number,
 *   meta: object | null,
 *   threadId: number,
 *   note?: string,
 *   nowMs?: number,
 * }} args
 * @returns {Promise<{ ok: true, challengeId: string, cfg: object, threadRow: object, noteTrim: string } | { ok: false, status: number, message: string }>}
 */
export async function validateChallengeSubmission({ sb, userId, ownerUserId, creationId, meta, threadId, note, nowMs }) {
	const now = typeof nowMs === "number" ? nowMs : Date.now();
	if (Number(userId) !== Number(ownerUserId)) {
		return { ok: false, status: 403, message: "Only the creation owner can submit to a challenge." };
	}
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) {
		return { ok: false, status: 400, message: "Invalid challenge thread." };
	}

	let noteTrim = typeof note === "string" ? note.replace(/\u0000/g, "").trim() : "";
	if (noteTrim.length > MAX_NOTE_CHARS) noteTrim = noteTrim.slice(0, MAX_NOTE_CHARS);

	try {
		const member = await isChatThreadMember(sb, tid, userId);
		if (!member) {
			return { ok: false, status: 403, message: "Join the Challenges channel before submitting." };
		}

		const threadRow = await fetchChatChannelThreadRow(sb, tid);
		const slug = String(threadRow?.channel_slug || "").toLowerCase();
		if (!threadRow || threadRow.type !== "channel" || slug !== "challenges") {
			return { ok: false, status: 403, message: "Submissions must go to the Challenges channel thread." };
		}

		const messages = await fetchThreadMessagesChronological(sb, tid);
		const cfg = pickLatestChallengeConfigPayload(messages);
		const challengeId =
			cfg && cfg.challenge_id != null ? String(cfg.challenge_id).trim() : "";
		if (!challengeId) {
			return { ok: false, status: 400, message: "No challenge is configured in this thread yet." };
		}

		const phase = deriveChallengePhase(cfg, now);
		if (phase !== "submitting" && phase !== "submit_and_vote") {
			return { ok: false, status: 400, message: "This challenge is not accepting submissions right now." };
		}

		if (metaHasChallengeSubmission(meta, tid, challengeId)) {
			return {
				ok: false,
				status: 409,
				message: "This creation is already entered in the current challenge."
			};
		}

		const dupMsg = await findDuplicateChallengeSubmissionMessage(sb, tid, userId, creationId, challengeId);
		if (dupMsg) {
			return { ok: false, status: 409, message: "You already posted this entry to the challenge." };
		}

		return { ok: true, challengeId, cfg, threadRow, noteTrim };
	} catch (err) {
		const msg = err?.message || "Challenge validation failed";
		return { ok: false, status: 500, message: msg };
	}
}
