import { deriveChallengePhase } from "../../src/chat/challenges/model/phases.js";
import {
	pickChallengeHeroImageUrl,
	pickChallengeResultsCreationUrl,
	pickChallengeConfigTimestamp,
	IMPLIED_CHALLENGE_ORGANIZER,
	normalizeChallengeOrganizerUserNames,
	organizersWithoutImplied,
	withImpliedChallengeOrganizer,
	resolveOrganizersByTrackFromGlobalPayload,
	resolveChallengeOrganizerAllowlistFromMessages,
	pickLatestChallengesGlobalConfig,
	viewerOrganizesTrack,
	tracksViewerCanOrganize
} from "../../src/chat/challenges/challengeAdmin.js";
import {
	challengeAcceptsMediaType,
	creationMediaTypeFromMeta
} from "../../src/chat/challenges/model/tracks.js";
import { verifyShareToken } from "./shareLink.js";

export {
	IMPLIED_CHALLENGE_ORGANIZER,
	normalizeChallengeOrganizerUserNames,
	organizersWithoutImplied,
	withImpliedChallengeOrganizer,
	resolveOrganizersByTrackFromGlobalPayload,
	resolveChallengeOrganizerAllowlistFromMessages,
	viewerOrganizesTrack,
	tracksViewerCanOrganize
};

/** @deprecated Prefer pickLatestChallengesGlobalConfig from challengeAdmin; kept for API callers. */
export const pickLatestChallengesGlobalConfigPayload = pickLatestChallengesGlobalConfig;

const MAX_NOTE_CHARS = 500;
const MESSAGE_FETCH_LIMIT = 500;
const RECENT_SELF_SCAN = 120;

/**
 * Phases where voting has closed and the challenge is considered "over" (no longer
 * active for submissions/voting). Entries in these phases may be published and can
 * no longer be withdrawn.
 */
export const CHALLENGE_ENDED_PHASES = new Set(["finalizing", "results"]);

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
 * Latest `challenge_config` for a challenge that is currently accepting submissions.
 * When multiple challenges accept, prefers the newest by config message created_at.
 * Prefer {@link listChallengeConfigsAcceptingSubmissions} + explicit challenge_id for multi-track.
 *
 * @param {{ body?: unknown, created_at?: string }[]} messagesNewestFirst
 * @param {number} [nowMs]
 * @returns {object | null}
 */
export function pickChallengeConfigAcceptingSubmissions(messagesNewestFirst, nowMs) {
	const list = listChallengeConfigsAcceptingSubmissions(messagesNewestFirst, nowMs);
	return list[0]?.cfg || null;
}

/**
 * All challenges currently accepting submissions (newest config first).
 *
 * @param {{ body?: unknown, created_at?: string }[]} messagesNewestFirst
 * @param {number} [nowMs]
 * @returns {{ cfg: object, created_at: string, challengeId: string }[]}
 */
export function listChallengeConfigsAcceptingSubmissions(messagesNewestFirst, nowMs) {
	const now = typeof nowMs === "number" ? nowMs : Date.now();
	const byId = latestChallengeConfigByChallengeId(messagesNewestFirst);
	/** @type {{ cfg: object, created_at: string, challengeId: string, sortKey: number }[]} */
	const out = [];
	for (const { payload: cfg, created_at } of byId.values()) {
		const phase = deriveChallengePhase(cfg, now);
		if (phase !== "submitting" && phase !== "submit_and_vote") continue;
		const challengeId = cfg?.challenge_id != null ? String(cfg.challenge_id).trim() : "";
		if (!challengeId) continue;
		const t = Date.parse(created_at || "");
		const sortKey = Number.isFinite(t) ? t : 0;
		out.push({
			cfg,
			created_at: typeof created_at === "string" ? created_at : "",
			challengeId,
			sortKey
		});
	}
	out.sort((a, b) => b.sortKey - a.sortKey);
	return out.map(({ cfg, created_at, challengeId }) => ({ cfg, created_at, challengeId }));
}

/**
 * Filter accepting challenges to those whose accepted_media includes the creation media type.
 * @param {{ cfg: object, challengeId: string, created_at?: string }[]} accepting
 * @param {unknown} mediaType
 * @returns {{ cfg: object, challengeId: string, created_at?: string }[]}
 */
export function filterAcceptingChallengesByMedia(accepting, mediaType) {
	const list = Array.isArray(accepting) ? accepting : [];
	return list.filter((row) => challengeAcceptsMediaType(row?.cfg, mediaType));
}

/**
 * Public eligibility list shape for creation detail.
 * @param {{ cfg: object, challengeId: string }[]} accepting
 * @returns {{ challenge_id: string, title: string, details: string, ends_at: string }[]}
 */
export function summarizeAcceptingChallengesForEligibility(accepting) {
	return (Array.isArray(accepting) ? accepting : []).map(({ cfg, challengeId }) => {
		const rawTitle = typeof cfg?.title === "string" ? cfg.title.trim() : "";
		const title = rawTitle || (challengeId ? `Challenge: ${challengeId}` : "Challenge");
		let details = "";
		if (cfg?.details != null) {
			details =
				typeof cfg.details === "string" ? cfg.details.trim() : String(cfg.details).trim();
		}
		const ends =
			pickChallengeConfigTimestamp(cfg, "submission_end_at") ||
			pickChallengeConfigTimestamp(cfg, "voting_end_at") ||
			"";
		return {
			challenge_id: challengeId,
			title,
			details,
			ends_at: typeof ends === "string" ? ends : ""
		};
	});
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
 * Newest `limit` messages, returned in chronological order (oldest → newest within the slice).
 * Fetching newest-first avoids the oldest-slice cliff once the thread exceeds MESSAGE_FETCH_LIMIT.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} threadId
 * @param {number} [limit]
 */
export async function fetchThreadMessagesChronological(sb, threadId, limit = MESSAGE_FETCH_LIMIT) {
	const newestFirst = await fetchThreadMessagesNewestFirst(sb, threadId, limit);
	return newestFirst.slice().reverse();
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
 * Read creation id from share token payload (first segment) without requiring a valid HMAC.
 * Matches client hero/thumb resolution — production tokens may use a rotated secret.
 * @param {string} fullToken
 * @returns {number}
 */
function decodeCreationIdFromShareTokenPayload(fullToken) {
	const raw = String(fullToken || "").trim();
	if (!raw.includes(".")) return NaN;
	const p = raw.split(".")[0];
	if (!p) return NaN;
	const padded = p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4);
	try {
		const buf = Buffer.from(padded, "base64");
		if (!buf || buf.length < 3) return NaN;
		const id = (buf[0] << 16) | (buf[1] << 8) | buf[2];
		return Number.isFinite(id) && id > 0 ? id : NaN;
	} catch {
		return NaN;
	}
}

/**
 * Parse a creation id from challenge hero / results / topic-vote reference strings
 * (`/creations/:id`, API paths, full creation URLs, or `sh.parascene.com/s/...` share links).
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

		// Share links: /s/{version}/{token}/{slug} — same shape organizers paste into hero fields.
		const shareMatch = (u.pathname || "").match(/^\/s\/([^/]+)\/([^/]+)(?:\/[^/]*)?\/?$/i);
		if (shareMatch) {
			const verified = verifyShareToken({ version: shareMatch[1], token: shareMatch[2] });
			if (verified?.ok === true) {
				const imageId = Number(verified.imageId);
				if (Number.isFinite(imageId) && imageId > 0) return imageId;
			}
			const decoded = decodeCreationIdFromShareTokenPayload(shareMatch[2]);
			if (Number.isFinite(decoded) && decoded > 0) return decoded;
		}
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
 * Walk newest challenge_config rows for `challengeId` until a results/highlights ref matches `creationId`.
 * @param {{ body?: unknown }[]} messagesNewestFirst
 * @param {string} challengeId
 * @param {number} creationId
 */
export function challengeResultsCreationMatchesInRecentConfigs(messagesNewestFirst, challengeId, creationId) {
	const cid = String(challengeId || "").trim();
	const targetId = Number(creationId);
	if (!cid || !Number.isFinite(targetId) || targetId <= 0) return false;
	for (const m of messagesNewestFirst || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		if (String(p.challenge_id || "").trim() !== cid) continue;
		const resultsRef = pickChallengeResultsCreationUrl(p);
		if (!resultsRef) continue;
		const resultsCreationId = parseCreationIdFromChallengeHeroRef(resultsRef);
		if (Number.isFinite(resultsCreationId) && resultsCreationId === targetId) return true;
	}
	return false;
}

/**
 * Viewer may load another user's unpublished creation when it is the configured
 * results/highlights creation for a challenge (past challenges "View results").
 * Access lasts while the challenge still points at this creation — not tied to the winners pin window.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{
 *   ancestorRow: { id?: unknown, unavailable_at?: unknown },
 *   challengeId?: string,
 *   viewerUserId: number,
 * }} args
 */
export async function canViewUnpublishedCreationViaChallengeResults(sb, args) {
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
		return challengeResultsCreationMatchesInRecentConfigs(
			messagesNewest,
			challengeId,
			ancestorRow.id
		);
	}

	for (const cid of latestChallengeConfigByChallengeId(messagesNewest).keys()) {
		if (challengeResultsCreationMatchesInRecentConfigs(messagesNewest, cid, ancestorRow.id)) {
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
 *   challengeId?: string,
 *   mediaType?: string,
 * }} args
 * @returns {Promise<{ ok: true, challengeId: string, cfg: object, threadRow: object, noteTrim: string } | { ok: false, status: number, message: string }>}
 */
export async function validateChallengeSubmission({
	sb,
	userId,
	ownerUserId,
	creationId,
	meta,
	threadId,
	note,
	nowMs,
	challengeId: requestedChallengeId,
	mediaType: mediaTypeArg
}) {
	const now = typeof nowMs === "number" ? nowMs : Date.now();
	const mediaType =
		typeof mediaTypeArg === "string" && mediaTypeArg.trim()
			? mediaTypeArg.trim().toLowerCase()
			: creationMediaTypeFromMeta(meta);
	if (Number(userId) !== Number(ownerUserId)) {
		return { ok: false, status: 403, message: "Only the creation owner can submit to a challenge." };
	}
	if (meta?.group?.kind === "group_creations") {
		return {
			ok: false,
			status: 400,
			message: "Group creations cannot be submitted as one challenge entry."
		};
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
		const messagesNewest = [...messages].reverse();
		const wantId =
			requestedChallengeId != null ? String(requestedChallengeId).trim() : "";
		const acceptingAll = listChallengeConfigsAcceptingSubmissions(messagesNewest, now);
		const accepting = filterAcceptingChallengesByMedia(acceptingAll, mediaType);
		let cfg = null;
		if (wantId) {
			cfg = pickLatestChallengeConfigForChallengeId(messagesNewest, wantId);
			const phase = cfg ? deriveChallengePhase(cfg, now) : "";
			if (!cfg || (phase !== "submitting" && phase !== "submit_and_vote")) {
				return {
					ok: false,
					status: 400,
					message: "That challenge is not accepting submissions right now."
				};
			}
			if (!challengeAcceptsMediaType(cfg, mediaType)) {
				return {
					ok: false,
					status: 400,
					message: "This creation's media type is not accepted by that challenge."
				};
			}
		} else if (accepting.length === 1) {
			cfg = accepting[0].cfg;
		} else if (accepting.length > 1) {
			return {
				ok: false,
				status: 400,
				message:
					"Multiple challenges are accepting submissions — choose which challenge to enter."
			};
		}
		const challengeId =
			cfg && cfg.challenge_id != null ? String(cfg.challenge_id).trim() : "";
		if (!challengeId) {
			return {
				ok: false,
				status: 400,
				message:
					acceptingAll.length > 0 && accepting.length === 0
						? "No open challenge accepts this creation's media type."
						: "No challenge is accepting submissions right now."
			};
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

/**
 * Summarize the lifecycle phase of every challenge a creation is entered in
 * (derived from the latest `challenge_config` for each entry's thread/challenge id).
 *
 * @param {{
 *   sb: import("@supabase/supabase-js").SupabaseClient,
 *   meta: object | null | undefined,
 *   nowMs?: number,
 * }} args
 * @returns {Promise<{
 *   hasSubmission: boolean,
 *   allEnded: boolean,
 *   anyActive: boolean,
 *   entries: { thread_id: number, challenge_id: string, phase: string, ended: boolean, title: string }[],
 * }>}
 */
export async function summarizeChallengeSubmissionPhases({ sb, meta, nowMs }) {
	const now = typeof nowMs === "number" ? nowMs : Date.now();
	const subs = Array.isArray(meta?.challenge_submissions) ? meta.challenge_submissions : [];
	const empty = { hasSubmission: false, allEnded: false, anyActive: false, entries: [] };
	if (subs.length === 0 || !sb) return empty;

	// Group submissions by thread so we fetch each thread's messages once.
	const byThread = new Map();
	for (const s of subs) {
		const tid = Number(s?.thread_id);
		if (!Number.isFinite(tid) || tid <= 0) continue;
		if (!byThread.has(tid)) byThread.set(tid, []);
		byThread.get(tid).push(s);
	}

	const entries = [];
	for (const [tid, list] of byThread) {
		let messagesNewest = [];
		try {
			messagesNewest = await fetchThreadMessagesNewestFirst(sb, tid);
		} catch {
			messagesNewest = [];
		}
		for (const s of list) {
			const cid = String(s?.challenge_id || "").trim();
			const cfg = cid ? pickLatestChallengeConfigForChallengeId(messagesNewest, cid) : null;
			const phase = deriveChallengePhase(cfg, now);
			const rawTitle = cfg && typeof cfg.title === "string" ? cfg.title.trim() : "";
			const title = rawTitle || (cid ? `Challenge: ${cid}` : "Challenge");
			entries.push({
				thread_id: tid,
				challenge_id: cid,
				phase,
				ended: CHALLENGE_ENDED_PHASES.has(phase),
				title
			});
		}
	}

	if (entries.length === 0) return empty;

	return {
		hasSubmission: true,
		allEnded: entries.every((e) => e.ended),
		anyActive: entries.some((e) => !e.ended),
		entries
	};
}

/**
 * Batch variant of {@link summarizeChallengeSubmissionPhases} for list views: for a page of
 * creation rows, determine whether every challenge each row is entered in has ended.
 * Each referenced #challenges thread's config is fetched once (not per row).
 *
 * @param {{
 *   sb: import("@supabase/supabase-js").SupabaseClient,
 *   images: { id?: unknown, meta?: object | null }[],
 *   nowMs?: number,
 * }} args
 * @returns {Promise<Map<number, boolean>>} Map of creation id -> all challenges ended.
 *   Only rows that have at least one challenge submission are included.
 */
export async function computeChallengeEndedByImageId({ sb, images, nowMs }) {
	const now = typeof nowMs === "number" ? nowMs : Date.now();
	const result = new Map();
	if (!sb || !Array.isArray(images)) return result;

	const threadIds = new Set();
	for (const img of images) {
		const subs = Array.isArray(img?.meta?.challenge_submissions)
			? img.meta.challenge_submissions
			: [];
		for (const s of subs) {
			const tid = Number(s?.thread_id);
			if (Number.isFinite(tid) && tid > 0) threadIds.add(tid);
		}
	}
	if (threadIds.size === 0) return result;

	const configByThread = new Map();
	for (const tid of threadIds) {
		let msgs = [];
		try {
			msgs = await fetchThreadMessagesNewestFirst(sb, tid);
		} catch {
			msgs = [];
		}
		configByThread.set(tid, latestChallengeConfigByChallengeId(msgs));
	}

	for (const img of images) {
		const subs = Array.isArray(img?.meta?.challenge_submissions)
			? img.meta.challenge_submissions
			: [];
		if (subs.length === 0) continue;
		let allEnded = true;
		for (const s of subs) {
			const tid = Number(s?.thread_id);
			const cid = String(s?.challenge_id || "").trim();
			const cfgEntry = configByThread.get(tid);
			const cfg = cfgEntry ? cfgEntry.get(cid)?.payload : null;
			const phase = deriveChallengePhase(cfg, now);
			if (!CHALLENGE_ENDED_PHASES.has(phase)) {
				allEnded = false;
				break;
			}
		}
		result.set(Number(img.id), allEnded);
	}
	return result;
}
