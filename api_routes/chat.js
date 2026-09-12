import express from "express";
import crypto from "crypto";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "./utils/realtimeBroadcast.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";
import { dmChatInboxTitleFromProfile, otherUserIdFromDmPairKey } from "./utils/dmChatInboxTitle.js";
import { insertNotificationsForChatMentions } from "./utils/chatMentionNotifications.js";
import { REACTION_ORDER } from "./comments.js";
import { buildWhoListFromProfileRows } from "./utils/whoMeta.js";
import { getShareBaseUrl } from "./utils/url.js";
import { ACTIVE_SHARE_VERSION, mintShareToken } from "./utils/shareLink.js";
import { removeJoinedPrivateChannelInviteDmMessages } from "./utils/chatInviteCleanup.js";
import {
	resolveChallengeOrganizerAllowlistFromMessages,
	resolveOrganizersByTrackFromGlobalPayload,
	pickLatestChallengesGlobalConfigPayload,
	viewerOrganizesTrack,
	fetchThreadMessagesChronological,
	findChallengesChannelThreadId,
	parseCreationIdFromChallengeHeroRef,
	pickLatestChallengeConfigForChallengeId,
	CHALLENGE_ENDED_PHASES
} from "./utils/challengeSubmitShared.js";
import {
	upsertChallengeEditorialPin,
	removeChallengeEditorialPin,
	normalizeChallengePinKind,
	ORGANIZER_ROLE_TO_PIN_KIND
} from "./utils/challengeLifecycle.js";
import { invalidateAndRebuildChallengeFeedSnapshotCache } from "./feed/challengeFeedSnapshotCache.js";
import { syncChallengeOrganizerCreationRefsOnConfigWrite } from "./utils/challengeOrganizerRefSync.js";
import { persistSingleChallengeConfigMessage } from "./utils/challengeConfigMessage.js";
import { groupActionSupportedForMeta, parseMeta } from "./utils/groupV2.js";
import { loadEditorialPinPolicyDocument } from "./feed/editorialPinPolicy.js";
import { collectChatMiscGenericKeysFromMessageBody,
	isChatMiscGenericKeyOwnedByUser
} from "./utils/chatMiscGenericKeys.js";
import { canvasBodyMarkdownToSafeHtml } from "./utils/canvasBodyHtml.js";
import { CHALLENGE_SCORE_REACTION_KEYS } from "../src/chat/challenges/constants.js";
import {
	isChallengeScoreReactionKey,
	stripUserFromChallengeScoreReactions
} from "../src/chat/challenges/model/scoreReactions.js";
import { composeChatStampedReply, sanitizeClientReplyPreview } from "./utils/chatReplyStamp.js";
import {
	mergeFullChallengeConfigForChallenge,
	isChallengeConfigSoftDeleted,
	isChallengeConfigPurged,
	pickChallengeHeroImageUrl,
	pickChallengeResultsCreationUrl,
	pickChallengeTopicVoteCreationUrl,
	tracksViewerCanOrganize
} from "../src/chat/challenges/challengeAdmin.js";
import { deriveChallengePhase } from "../src/chat/challenges/model/phases.js";
import {
	MAX_CHAT_MESSAGE_CHARS,
	MAX_MACHINE_CHANNEL_MESSAGE_CHARS,
	maxChatMessageBodyChars
} from "./utils/chatMessageLimits.js";

function normalizeChatReactionsBucket(raw) {
	const out = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const k of Object.keys(raw)) {
		if (!REACTION_ORDER.includes(k)) continue;
		const arr = Array.isArray(raw[k]) ? raw[k] : [];
		const uids = [...new Set(arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
		if (uids.length > 0) out[k] = uids;
	}
	return out;
}

/** Stored on each message as jsonb: { emoji_key: [user_id, ...] }.
 * Normal messages: comment-style name lists for every reaction key.
 * Challenge submissions only: score keys stay numeric counts (blind votes).
 */
async function enrichChatReactionsFromMessageColumn(messages, viewerId, queries) {
	const viewerIdNum =
		viewerId != null && Number.isFinite(Number(viewerId)) ? Number(viewerId) : null;
	const list = Array.isArray(messages) ? messages : [];
	if (list.length === 0) return list;

	const allUserIds = new Set();
	const buckets = list.map((m) => normalizeChatReactionsBucket(m.reactions));
	const challengeSubmissionFlags = list.map((m) => isChallengeSubmissionMessage(m));
	for (let i = 0; i < buckets.length; i++) {
		const bucket = buckets[i];
		const isChallengeSubmission = challengeSubmissionFlags[i];
		for (const emojiKey of REACTION_ORDER) {
			// Score keys on challenge submissions stay anonymous — no profile lookup.
			if (isChallengeSubmission && isChallengeScoreReactionKey(emojiKey)) continue;
			for (const uid of bucket[emojiKey] || []) allUserIds.add(uid);
		}
	}

	let profilesById = new Map();
	if (allUserIds.size > 0) {
		if (typeof queries?.selectUserProfilesByUserIds === "function") {
			try {
				profilesById = await queries.selectUserProfilesByUserIds([...allUserIds]);
			} catch {
				profilesById = new Map();
			}
		}
		if (!(profilesById instanceof Map) || profilesById.size === 0) {
			try {
				const sb = getSupabaseServiceClient();
				if (sb) {
					const { data: profiles, error } = await sb
						.from("prsn_user_profiles")
						.select("user_id, user_name, display_name")
						.in("user_id", [...allUserIds]);
					if (!error && Array.isArray(profiles)) {
						profilesById = new Map();
						for (const p of profiles) {
							profilesById.set(Number(p.user_id), p);
						}
					}
				}
			} catch {
				// keep empty map — still expose overflow count via buildWhoListFromProfileRows
			}
		}
	}

	return list.map((m, idx) => {
		const bucket = buckets[idx] || {};
		const isChallengeSubmission = challengeSubmissionFlags[idx];
		const reactions = {};
		const viewer_reactions = [];
		for (const emojiKey of REACTION_ORDER) {
			const userIds = bucket[emojiKey] || [];
			const total = userIds.length;
			if (total === 0) continue;
			if (isChallengeSubmission && isChallengeScoreReactionKey(emojiKey)) {
				reactions[emojiKey] = total;
			} else {
				const profileRows = userIds.map((uid) => {
					const p = profilesById.get(Number(uid)) ?? {};
					return { user_name: p.user_name ?? null, display_name: p.display_name ?? null };
				});
				reactions[emojiKey] = buildWhoListFromProfileRows(profileRows, total);
			}
			if (viewerIdNum != null && userIds.some((uid) => Number(uid) === viewerIdNum)) {
				viewer_reactions.push(emojiKey);
			}
		}
		return { ...m, reactions, viewer_reactions };
	});
}

/**
 * Marks each message whose `meta.reply.referenced_id` still exists in-thread.
 */
async function enrichMessagesReplyParentExists(sb, threadId, messages) {
	const tid = Number(threadId);
	if (!Array.isArray(messages) || messages.length === 0 || !Number.isFinite(tid) || tid <= 0) return messages;

	const refs = [
		...new Set(
			messages
				.map((m) => Number(m?.meta?.reply?.referenced_id))
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	];
	if (refs.length === 0) {
		return messages.map((m) => {
			if (!m?.meta?.reply?.referenced_id) return m;
			return { ...m, reply_parent_exists: false };
		});
	}
	const { data, error } = await sb.from("prsn_chat_messages").select("id").eq("thread_id", tid).in("id", refs);
	if (error) throw error;
	const alive = new Set((data ?? []).map((row) => Number(row.id)));

	return messages.map((m) => {
		const ref = Number(m?.meta?.reply?.referenced_id);
		if (!Number.isFinite(ref) || ref <= 0) return m;
		return { ...m, reply_parent_exists: alive.has(ref) };
	});
}

function tryParseChallengeJsonBody(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || (!s.startsWith("{") && !s.startsWith("["))) return null;
	try {
		const parsed = JSON.parse(s);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isChallengeSubmissionMessage(message) {
	const payload = tryParseChallengeJsonBody(message?.body);
	return Boolean(payload && String(payload.kind || "").trim() === "challenge_submission");
}

/** Bayesian prior for challenge stats — scoped to one thread, short mem cache. */
const CHALLENGE_STATS_GLOBAL_AVG_TTL_MS = 60_000;
/** @type {Map<number, { at: number, value: number }>} */
const challengeThreadGlobalAverageCache = new Map();

/**
 * Mean score across all challenge_submission votes in the thread (not site-wide).
 * @param {number} threadId
 * @param {{ body?: unknown, reactions?: unknown }[]} rows
 */
function getCachedChallengeThreadGlobalAverage(threadId, rows) {
	const tid = Number(threadId);
	const now = Date.now();
	if (Number.isFinite(tid) && tid > 0) {
		const hit = challengeThreadGlobalAverageCache.get(tid);
		if (hit && now - hit.at < CHALLENGE_STATS_GLOBAL_AVG_TTL_MS) {
			return hit.value;
		}
	}
	let globalVoteValue = 0;
	let globalVoteCount = 0;
	for (const msg of Array.isArray(rows) ? rows : []) {
		const payload = tryParseChallengeJsonBody(msg?.body);
		if (!payload || String(payload.kind || "").trim() !== "challenge_submission") continue;
		const reactions =
			msg?.reactions && typeof msg.reactions === "object" && !Array.isArray(msg.reactions)
				? msg.reactions
				: {};
		for (let i = 0; i < CHALLENGE_SCORE_REACTION_KEYS.length; i += 1) {
			const key = CHALLENGE_SCORE_REACTION_KEYS[i];
			const weight = i + 1;
			const ids = Array.isArray(reactions[key]) ? reactions[key] : [];
			for (const rawUid of ids) {
				const uid = Number(rawUid);
				if (!Number.isFinite(uid) || uid <= 0) continue;
				globalVoteCount += 1;
				globalVoteValue += weight;
			}
		}
	}
	const value = globalVoteCount > 0 ? globalVoteValue / globalVoteCount : 0;
	if (Number.isFinite(tid) && tid > 0) {
		challengeThreadGlobalAverageCache.set(tid, { at: now, value });
	}
	return value;
}

function normalizeUsernameForChallengeOrganizer(input) {
	const raw = typeof input === "string" ? input.trim().replace(/^@+/, "") : "";
	if (!raw) return null;
	const normalized = raw.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
	return normalized;
}

function normalizeOrganizerUserNamesList(raw) {
	const list = Array.isArray(raw) ? raw : [];
	const out = [];
	const seen = new Set();
	for (const entry of list) {
		const normalized = normalizeUsernameForChallengeOrganizer(entry);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

const MAX_MESSAGE_CHARS = MAX_CHAT_MESSAGE_CHARS;
const MAX_CANVAS_TITLE_CHARS = 200;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const PRIVATE_CHANNEL_VISIBILITY = "private";
const CHAT_PRIVATE_BODY_PREFIX = "enc:v1:";
const INVITE_TOKEN_VERSION = "ci1";
const INVITE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const TIMED_MESSAGE_KIND_CHANNEL_INVITE = "channel_invite";
const TIMED_MESSAGE_DEFAULT_INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const SYSTEM_EVENT_KIND_CHANNEL_INVITE_SENT = "channel_invite_sent";

/**
 * Client-only pseudo lanes (no real thread); POST /api/chat/channels rejects these so they are not
 * created as hashtag channels. Keep in sync with `public/shared/chatSidebarRoster.js` strip.
 */
const POST_REJECT_PSEUDO_CHANNEL_SLUGS = new Set(["comments", "feed", "explore", "creations"]);

/**
 * Reserved names for hashtag picker + collision semantics (includes pseudo slugs + feedback).
 * `#feedback` is a real channel thread (find-or-create via POST); pseudo slugs stay POST-rejected.
 * Keep in sync with `public/shared/chatSidebarRoster.js` (strip + feedback).
 */
const SYSTEM_RESERVED_CHANNEL_SLUGS = new Set([...POST_REJECT_PSEUDO_CHANNEL_SLUGS, "feedback"]);

/** Slugs where founder canvases are blocked (pseudo-column channels). `#feedback` behaves like a normal channel for canvases. */
const CANVAS_DISALLOWED_CHANNEL_SLUGS = new Set(["comments", "feed", "explore", "creations", "challenges"]);

/** Match trailing punctuation on pasted URLs (aligned with client `splitUrlTrailingPunctuation`). */
function splitUrlTrailingPunctuationForChat(rawUrl) {
	let url = String(rawUrl || "");
	let trailing = "";
	const stripChars = ".,!?:;";
	let safety = 0;
	while (url && safety < 8) {
		const last = url[url.length - 1];
		if (stripChars.includes(last)) {
			trailing = last + trailing;
			url = url.slice(0, -1);
			safety++;
			continue;
		}
		if ((last === ")" || last === "]" || last === "}") && url.length > 1) {
			const openCount = (url.match(/\(/g) || []).length;
			const closeCount = (url.match(/\)/g) || []).length;
			const openB = (url.match(/\[/g) || []).length;
			const closeB = (url.match(/\]/g) || []).length;
			const openC = (url.match(/\{/g) || []).length;
			const closeC = (url.match(/\}/g) || []).length;
			const unmatched =
				(last === ")" && closeCount > openCount) ||
				(last === "]" && closeB > openB) ||
				(last === "}" && closeC > openC);
			if (unmatched) {
				trailing = last + trailing;
				url = url.slice(0, -1);
				safety++;
				continue;
			}
		}
		break;
	}
	return { url, trailing };
}

/**
 * Spans in `text` that are bare `/creations/:id` or `/api/create/images/:id`,
 * or http(s) URLs whose path is exactly one of those forms.
 */
function collectCreationDetailUrlSpansInChatBody(text) {
	const spans = [];
	const t = String(text || "");
	const urlRe = /https?:\/\/[^\s"'<>]+/g;
	let m;
	while ((m = urlRe.exec(t)) !== null) {
		const raw = m[0];
		const { url } = splitUrlTrailingPunctuationForChat(raw);
		try {
			const u = new URL(url);
			const mm = (u.pathname || "").match(
				/^(?:\/creations\/(\d+)\/?|\/api\/create\/images\/(\d+)\/?)$/i
			);
			if (mm) {
				const id = Number(mm[1] || mm[2]);
				if (Number.isFinite(id) && id > 0) {
					spans.push({ start: m.index, end: m.index + raw.length, id });
				}
			}
		} catch {
			// ignore
		}
	}
	const bareRe = /(^|[\s(])\/creations\/(\d+)(?=\/?(?:[\s]|$|[.,!?;:)]|\)|\?|#))/gi;
	while ((m = bareRe.exec(t)) !== null) {
		const id = Number(m[2]);
		const start = m.index + m[1].length;
		const end = bareRe.lastIndex;
		if (Number.isFinite(id) && id > 0) {
			spans.push({ start, end, id });
		}
	}
	const bareApiRe = /(^|[\s(])\/api\/create\/images\/(\d+)(?=\/?(?:[\s]|$|[.,!?;:)]|\)|\?|#))/gi;
	while ((m = bareApiRe.exec(t)) !== null) {
		const id = Number(m[2]);
		const start = m.index + m[1].length;
		const end = bareApiRe.lastIndex;
		if (Number.isFinite(id) && id > 0) {
			spans.push({ start, end, id });
		}
	}
	spans.sort((a, b) => a.start - b.start || b.end - a.end - (b.start - a.start));
	const out = [];
	let lastEnd = -1;
	for (const s of spans) {
		if (s.start < lastEnd) continue;
		out.push(s);
		lastEnd = s.end;
	}
	return out;
}

async function mintShareUrlForOwnerUnpublishedCreation(id, senderUserId, queries, shareBase, bust) {
	try {
		let row = await queries.selectCreatedImageById?.get(id, senderUserId);
		if (!row && typeof queries.selectCreatedImageByIdAnyUser?.get === "function") {
			const anyRow = await queries.selectCreatedImageByIdAnyUser.get(id);
			const ownerId = Number(anyRow?.user_id);
			const senderIdNum = Number(senderUserId);
			if (
				anyRow &&
				Number.isFinite(ownerId) &&
				ownerId > 0 &&
				Number.isFinite(senderIdNum) &&
				senderIdNum > 0 &&
				ownerId === senderIdNum
			) {
				row = anyRow;
			}
		}
		if (!row) return null;
		const pub = row.published === 1 || row.published === true;
		if (pub) return null;
		const status = row.status || "completed";
		if (status !== "completed") return null;
		if (row.unavailable_at != null && String(row.unavailable_at) !== "") return null;
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: Number(id),
			sharedByUserId: Number(senderUserId)
		});
		return `${shareBase}/s/${ACTIVE_SHARE_VERSION}/${token}/${bust}`;
	} catch {
		return null;
	}
}

/** Replace in-app creation detail URLs with share URLs when the sender owns the creation and it is not published (so recipients can load previews via share token headers). */
async function normalizeUnpublishedCreationUrlsInChatBody(body, senderUserId, queries) {
	if (!queries?.selectCreatedImageById?.get) return body;
	// Challenge configs store organizer media refs — keep stable /creations/:id (or parseable share)
	// instead of rewriting to ephemeral share URLs meant for chat recipients.
	const challengePayload = tryParseChallengeJsonBody(body);
	const challengeKind = String(challengePayload?.kind || "").trim();
	if (challengeKind === "challenge_config" || challengeKind === "challenges_global_config") {
		return body;
	}
	const spans = collectCreationDetailUrlSpansInChatBody(body);
	if (spans.length === 0) return body;

	const shareBase = getShareBaseUrl();
	const bust = Math.floor(Date.now() / 1000).toString(36);
	const ids = [...new Set(spans.map((s) => s.id))];
	const shareUrlById = new Map();

	for (const id of ids) {
		const url = await mintShareUrlForOwnerUnpublishedCreation(id, senderUserId, queries, shareBase, bust);
		if (url) shareUrlById.set(id, url);
	}

	let out = body;
	const toApply = spans
		.filter((s) => shareUrlById.has(s.id))
		.sort((a, b) => b.start - a.start);
	for (const s of toApply) {
		out = out.slice(0, s.start) + shareUrlById.get(s.id) + out.slice(s.end);
	}
	return out;
}

const CHALLENGE_CONFIG_CREATION_REF_FIELDS = [
	"hero_image_url",
	"cover_image_url",
	"image_url",
	"hero_image",
	"hero_media_url",
	"hero_media",
	"hero_ref",
	"hero_url",
	"results_creation_url",
	"results_url",
	"results_highlights_url",
	"topic_vote_creation_url",
	"theme_vote_creation_url",
	"topic_vote_url",
	"next_theme_creation_url",
	"creation_url"
];

/**
 * Prefer durable `/creations/:id` on challenge_config media fields (share links still parse, but churn).
 * @param {string} body
 * @returns {string}
 */
function stabilizeChallengeConfigCreationRefsInBody(body) {
	const parsed = tryParseChallengeJsonBody(body);
	if (!parsed || String(parsed.kind || "").trim() !== "challenge_config") return body;
	let changed = false;
	for (const field of CHALLENGE_CONFIG_CREATION_REF_FIELDS) {
		if (typeof parsed[field] !== "string") continue;
		const raw = parsed[field].trim();
		if (!raw) continue;
		const id = parseCreationIdFromChallengeHeroRef(raw);
		if (!Number.isFinite(id) || id <= 0) continue;
		const stable = `/creations/${id}`;
		if (raw !== stable) {
			parsed[field] = stable;
			changed = true;
		}
	}
	if (!changed) return body;
	try {
		return JSON.stringify(parsed);
	} catch {
		return body;
	}
}

function dmPairKey(a, b) {
	const x = Number(a);
	const y = Number(b);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const lo = Math.min(x, y);
	const hi = Math.max(x, y);
	return `${lo}:${hi}`;
}

function base64UrlEncodeFromBuffer(buf) {
	return Buffer.from(buf).toString("base64url");
}

function base64UrlDecodeToBuffer(value) {
	try {
		return Buffer.from(String(value || ""), "base64url");
	} catch {
		return null;
	}
}

function getChatInviteSecret() {
	const envSecret = String(process.env.CHAT_INVITE_SECRET || "").trim();
	return envSecret || "parascene-chat-invite-v1";
}

function signInvitePayload(payloadB64) {
	return crypto
		.createHmac("sha256", getChatInviteSecret())
		.update(String(payloadB64))
		.digest("base64url")
		.slice(0, 20);
}

function mintChatInviteToken({ threadId, secretK, inviterUserId, expiresAtMs }) {
	const payload = {
		v: INVITE_TOKEN_VERSION,
		t: Number(threadId),
		k: String(secretK || ""),
		u: Number(inviterUserId),
		e: Number(expiresAtMs)
	};
	const p = base64UrlEncodeFromBuffer(Buffer.from(JSON.stringify(payload), "utf8"));
	const s = signInvitePayload(p);
	return `${p}.${s}`;
}

function verifyChatInviteToken(raw) {
	const parts = String(raw || "").split(".");
	if (parts.length !== 2) return { ok: false, error: "INVALID_TOKEN" };
	const [p, s] = parts;
	if (!p || !s) return { ok: false, error: "INVALID_TOKEN" };
	const expected = signInvitePayload(p);
	const sigBuf = Buffer.from(String(s), "utf8");
	const expBuf = Buffer.from(String(expected), "utf8");
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		return { ok: false, error: "BAD_SIGNATURE" };
	}
	const payloadBuf = base64UrlDecodeToBuffer(p);
	if (!payloadBuf) return { ok: false, error: "INVALID_PAYLOAD" };
	let payload;
	try {
		payload = JSON.parse(payloadBuf.toString("utf8"));
	} catch {
		return { ok: false, error: "INVALID_PAYLOAD" };
	}
	if (payload?.v !== INVITE_TOKEN_VERSION) return { ok: false, error: "BAD_VERSION" };
	const threadId = Number(payload?.t);
	const inviterUserId = Number(payload?.u);
	const expiresAtMs = Number(payload?.e);
	const secretK = typeof payload?.k === "string" ? payload.k.trim() : "";
	if (!Number.isFinite(threadId) || threadId <= 0) return { ok: false, error: "BAD_THREAD" };
	if (!Number.isFinite(inviterUserId) || inviterUserId <= 0) return { ok: false, error: "BAD_USER" };
	if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return { ok: false, error: "BAD_EXP" };
	if (!secretK) return { ok: false, error: "BAD_KEY" };
	if (Date.now() > expiresAtMs) return { ok: false, error: "EXPIRED" };
	return { ok: true, threadId, inviterUserId, expiresAtMs, secretK };
}

function threadVisibilityFromMeta(meta) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "public";
	const raw = typeof meta.visibility === "string" ? meta.visibility.trim().toLowerCase() : "";
	return raw === PRIVATE_CHANNEL_VISIBILITY ? PRIVATE_CHANNEL_VISIBILITY : "public";
}

function buildPrivateChannelMeta({ prevMeta, encName, encProbe }) {
	const prev =
		prevMeta && typeof prevMeta === "object" && !Array.isArray(prevMeta) ? { ...prevMeta } : {};
	prev.visibility = PRIVATE_CHANNEL_VISIBILITY;
	prev.enc_v = 1;
	prev.enc_name = String(encName || "");
	prev.enc_probe = String(encProbe || "");
	return prev;
}

function randomPrivateSlug() {
	return `p-${crypto.randomBytes(9).toString("base64url").replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`;
}

function decryptPrivateTextWithSecret(token, secret) {
	const parts = String(token || "").split(".");
	if (parts.length !== 2) return null;
	const iv = base64UrlDecodeToBuffer(parts[0]);
	const ctAndTag = base64UrlDecodeToBuffer(parts[1]);
	const sec = String(secret || "");
	if (!iv || !ctAndTag || !sec) return null;
	if (iv.length !== 12 || ctAndTag.length <= 16) return null;
	try {
		const key = crypto.createHash("sha256").update(sec).digest();
		const tag = ctAndTag.subarray(ctAndTag.length - 16);
		const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16);
		const dec = crypto.createDecipheriv("aes-256-gcm", key, iv);
		dec.setAuthTag(tag);
		const plain = Buffer.concat([dec.update(ciphertext), dec.final()]).toString("utf8");
		return plain || null;
	} catch {
		return null;
	}
}

function encryptPrivateTextWithSecret(plainText, secret) {
	const sec = String(secret || "");
	if (!sec) return null;
	try {
		const iv = crypto.randomBytes(12);
		const key = crypto.createHash("sha256").update(sec).digest();
		const enc = crypto.createCipheriv("aes-256-gcm", key, iv);
		const ciphertext = Buffer.concat([enc.update(String(plainText || ""), "utf8"), enc.final()]);
		const tag = enc.getAuthTag();
		const payload = Buffer.concat([ciphertext, tag]);
		return `${base64UrlEncodeFromBuffer(iv)}.${base64UrlEncodeFromBuffer(payload)}`;
	} catch {
		return null;
	}
}

function parseTimedMessageMeta(rawMeta) {
	const m = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : null;
	if (!m) return null;
	const ts = m.time_sensitive;
	if (!ts || typeof ts !== "object" || Array.isArray(ts)) return null;
	const kind = typeof ts.kind === "string" ? ts.kind.trim().toLowerCase() : "";
	const expiresAt = typeof ts.expires_at === "string" ? ts.expires_at.trim() : "";
	const expMs = Date.parse(expiresAt);
	if (!kind || !expiresAt || !Number.isFinite(expMs)) return null;
	return { kind, expires_at: expiresAt, expires_ms: expMs, raw: ts };
}

function isTimedMessageExpired(rawMeta, nowMs = Date.now()) {
	const parsed = parseTimedMessageMeta(rawMeta);
	if (!parsed) return false;
	return parsed.expires_ms <= nowMs;
}

/** Same rules as `normalizeUsername` in user.js — public handle for DM URLs. */
function normalizeDmUsernameInput(input) {
	const raw = typeof input === "string" ? input.trim() : "";
	if (!raw) return null;
	const normalized = raw.startsWith("@") ? raw.slice(1).trim().toLowerCase() : raw.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
	return normalized;
}

function encodeCursor(createdAt, id) {
	const payload = JSON.stringify({ c: createdAt, i: Number(id) });
	return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(raw) {
	if (typeof raw !== "string" || !raw.trim()) return null;
	try {
		const json = Buffer.from(raw.trim(), "base64url").toString("utf8");
		const o = JSON.parse(json);
		const c = o?.c;
		const i = o?.i;
		if (typeof c !== "string" || !Number.isFinite(Number(i))) return null;
		return { created_at: c, id: Number(i) };
	} catch {
		return null;
	}
}

/** Attach `sender_user_name`, `sender_avatar_url`, and `sender_plan` (from `prsn_users.meta.plan`) for each message row. */
async function enrichChatMessagesWithSenderProfiles(sb, messages) {
	if (!Array.isArray(messages) || messages.length === 0) return [];
	const ids = [
		...new Set(
			messages
				.map((m) => Number(m?.sender_id))
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	];
	if (ids.length === 0) {
		return messages.map((m) => ({
			...m,
			sender_user_name: null,
			sender_avatar_url: null,
			sender_plan: "free"
		}));
	}
	const { data: rows, error } = await sb
		.from("prsn_user_profiles")
		.select("user_id, user_name, avatar_url")
		.in("user_id", ids);
	if (error) throw error;
	const map = new Map();
	for (const row of rows || []) {
		map.set(Number(row.user_id), {
			user_name: row.user_name != null ? String(row.user_name) : null,
			avatar_url: row.avatar_url != null ? String(row.avatar_url) : null
		});
	}
	const { data: userRows, error: userErr } = await sb.from("prsn_users").select("id, meta").in("id", ids);
	if (userErr) throw userErr;
	const planMap = new Map();
	for (const u of userRows || []) {
		const id = Number(u.id);
		const founder = u?.meta && typeof u.meta === "object" && u.meta.plan === "founder";
		planMap.set(id, founder ? "founder" : "free");
	}
	return messages.map((m) => {
		const sid = Number(m.sender_id);
		const p = map.get(sid);
		const sender_plan = planMap.get(sid) === "founder" ? "founder" : "free";
		return {
			...m,
			sender_user_name: p?.user_name ?? null,
			sender_avatar_url: p?.avatar_url ?? null,
			sender_plan
		};
	});
}

async function deleteChatMiscGenericFilesForMessage(storage, messageBody, senderId) {
	if (!storage?.deleteGenericImage) return;
	const keys = collectChatMiscGenericKeysFromMessageBody(messageBody);
	const sid = Number(senderId);
	if (!Number.isFinite(sid) || sid <= 0) return;
	for (const key of keys) {
		if (!isChatMiscGenericKeyOwnedByUser(key, sid)) continue;
		try {
			await storage.deleteGenericImage(key);
		} catch (e) {
			console.warn("[DELETE chat message] misc generic image:", e?.message || e);
		}
	}
}

export default function createChatRoutes({ queries, storage }) {
	const router = express.Router();

	function requireUser(req, res) {
		const userId = req.auth?.userId;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		return userId;
	}

	function getSb(res) {
		const sb = getSupabaseServiceClient();
		if (!sb) {
			res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
			return null;
		}
		return sb;
	}

	async function getUserMeta(sb, userId) {
		const { data, error } = await sb
			.from("prsn_users")
			.select("meta")
			.eq("id", userId)
			.maybeSingle();
		if (error) throw error;
		const meta = data?.meta;
		return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
	}

	async function normalizeBodyForThreadStorage(sb, threadRow, userId, bodyRaw) {
		const body = typeof bodyRaw === "string" ? bodyRaw : "";
		const isPrivateChannel =
			threadRow?.type === "channel" &&
			threadVisibilityFromMeta(threadRow?.meta) === PRIVATE_CHANNEL_VISIBILITY;
		if (!isPrivateChannel) {
			const withShares = await normalizeUnpublishedCreationUrlsInChatBody(body, userId, queries);
			return stabilizeChallengeConfigCreationRefsInBody(withShares);
		}
		if (!body.startsWith(CHAT_PRIVATE_BODY_PREFIX)) {
			return body;
		}
		const cipherToken = body.slice(CHAT_PRIVATE_BODY_PREFIX.length);
		if (!cipherToken) {
			throw new Error("Private channel message payload is invalid");
		}
		const userMeta = await getUserMeta(sb, userId);
		const keyMap =
			userMeta.chat_private_keys &&
			typeof userMeta.chat_private_keys === "object" &&
			!Array.isArray(userMeta.chat_private_keys)
				? userMeta.chat_private_keys
				: {};
		const keyEntry =
			keyMap[String(Number(threadRow?.id))] &&
			typeof keyMap[String(Number(threadRow?.id))] === "object"
				? keyMap[String(Number(threadRow?.id))]
				: null;
		const secretK = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
		if (!secretK) {
			throw new Error("Private channel key missing for sender");
		}
		const plain = decryptPrivateTextWithSecret(cipherToken, secretK);
		if (plain == null) {
			throw new Error("Could not decrypt private channel message");
		}
		const normalizedPlain = await normalizeUnpublishedCreationUrlsInChatBody(plain, userId, queries);
		const stabilizedPlain = stabilizeChallengeConfigCreationRefsInBody(normalizedPlain);
		if (stabilizedPlain === plain) {
			return body;
		}
		const nextCipher = encryptPrivateTextWithSecret(stabilizedPlain, secretK);
		if (!nextCipher) {
			throw new Error("Could not encrypt private channel message");
		}
		return `${CHAT_PRIVATE_BODY_PREFIX}${nextCipher}`;
	}

	async function validateAndNormalizeChallengesGlobalConfigBody(sb, threadRow, bodyRaw, userId) {
		const body = typeof bodyRaw === "string" ? bodyRaw : "";
		const parsed = tryParseChallengeJsonBody(body);
		const kind = String(parsed?.kind || "").trim();
		if (kind !== "challenges_global_config") {
			return { ok: true, body };
		}
		const isChallengesThread =
			threadRow?.type === "channel" &&
			String(threadRow?.channel_slug || "").trim().toLowerCase() === "challenges";
		if (!isChallengesThread) {
			return {
				ok: false,
				status: 400,
				message: "challenges_global_config can only be posted in #challenges."
			};
		}
		const viewerProfile =
			typeof queries?.selectUserProfileByUserId?.get === "function"
				? await queries.selectUserProfileByUserId.get(userId).catch(() => null)
				: null;
		const viewerUserName =
			typeof viewerProfile?.user_name === "string"
				? viewerProfile.user_name.trim().toLowerCase()
				: "";
		if (viewerUserName !== "oceanman") {
			return {
				ok: false,
				status: 403,
				message: "Only oceanman can edit challenge organizer settings."
			};
		}
		const implied = "oceanman";
		const withoutImplied = (raw) =>
			normalizeOrganizerUserNamesList(raw).filter((u) => u !== implied);
		const byTrackRaw =
			parsed?.organizers_by_track && typeof parsed.organizers_by_track === "object"
				? parsed.organizers_by_track
				: null;
		const legacy = withoutImplied(parsed?.organizer_user_names);
		const organizersByTrack = {
			monthly: withoutImplied(
				byTrackRaw
					? Array.isArray(byTrackRaw.monthly)
						? byTrackRaw.monthly
						: []
					: legacy
			),
			weekly: withoutImplied(
				byTrackRaw
					? Array.isArray(byTrackRaw.weekly)
						? byTrackRaw.weekly
						: []
					: legacy
			),
			suno: withoutImplied(
				byTrackRaw ? (Array.isArray(byTrackRaw.suno) ? byTrackRaw.suno : []) : legacy
			)
		};
		const organizerUserNames = normalizeOrganizerUserNamesList([
			...organizersByTrack.monthly,
			...organizersByTrack.weekly,
			...organizersByTrack.suno
		]);
		if (organizerUserNames.length > 0) {
			const { data: rows, error } = await sb
				.from("prsn_user_profiles")
				.select("user_name")
				.in("user_name", organizerUserNames);
			if (error) throw error;
			const existing = new Set(
				(Array.isArray(rows) ? rows : [])
					.map((row) =>
						typeof row?.user_name === "string" ? row.user_name.trim().toLowerCase() : ""
					)
					.filter(Boolean)
			);
			const missing = organizerUserNames.filter((u) => !existing.has(u));
			if (missing.length > 0) {
				return {
					ok: false,
					status: 400,
					message: `Unknown usernames in Challenge Organizer Team: ${missing.join(", ")}`
				};
			}
		}
		const normalizedPayload = {
			...parsed,
			kind: "challenges_global_config",
			organizers_by_track: organizersByTrack,
			organizer_user_names: organizerUserNames
		};
		return { ok: true, body: JSON.stringify(normalizedPayload) };
	}

	/**
	 * Ensure the viewer may set `track` on challenge_config (create, or when changing type).
	 * @param {import("@supabase/supabase-js").SupabaseClient} sb
	 * @param {object | null | undefined} threadRow
	 * @param {number} userId
	 * @param {string} bodyRaw
	 * @param {string | null | undefined} [previousBody] prior message body when patching
	 */
	async function validateChallengeConfigOrganizerTrack(
		sb,
		threadRow,
		userId,
		bodyRaw,
		previousBody
	) {
		const parsed = tryParseChallengeJsonBody(bodyRaw);
		const kind = String(parsed?.kind || "").trim();
		if (kind !== "challenge_config") {
			return { ok: true, body: bodyRaw };
		}
		const isChallengesThread =
			threadRow?.type === "channel" &&
			String(threadRow?.channel_slug || "").trim().toLowerCase() === "challenges";
		if (!isChallengesThread) {
			return { ok: true, body: bodyRaw };
		}
		const nextRaw = String(parsed?.track || "monthly")
			.trim()
			.toLowerCase();
		const nextTrack =
			nextRaw === "weekly" || nextRaw === "suno" || nextRaw === "monthly" ? nextRaw : "monthly";
		const prevParsed = tryParseChallengeJsonBody(previousBody);
		const prevRaw =
			prevParsed && String(prevParsed.kind || "").trim() === "challenge_config"
				? String(prevParsed.track || "monthly")
						.trim()
						.toLowerCase()
				: "";
		const prevTrack =
			prevRaw === "weekly" || prevRaw === "suno" || prevRaw === "monthly" ? prevRaw : "";
		const trackUnchanged = Boolean(prevTrack) && prevTrack === nextTrack;
		if (trackUnchanged) {
			return { ok: true, body: bodyRaw };
		}
		const viewerProfile =
			typeof queries?.selectUserProfileByUserId?.get === "function"
				? await queries.selectUserProfileByUserId.get(userId).catch(() => null)
				: null;
		const viewerUserName =
			typeof viewerProfile?.user_name === "string"
				? viewerProfile.user_name.trim().toLowerCase()
				: "";
		if (!viewerUserName) {
			return {
				ok: false,
				status: 403,
				message: "Username required to save challenge config."
			};
		}
		const tid = Number(threadRow?.id);
		const messages =
			Number.isFinite(tid) && tid > 0
				? await fetchThreadMessagesChronological(sb, tid)
				: [];
		const globalCfg = pickLatestChallengesGlobalConfigPayload(messages);
		const byTrack = resolveOrganizersByTrackFromGlobalPayload(globalCfg?.payload);
		if (!viewerOrganizesTrack(viewerUserName, byTrack, nextTrack)) {
			return {
				ok: false,
				status: 403,
				message: "You can only set the challenge type to a type you organize."
			};
		}
		return { ok: true, body: bodyRaw };
	}

	async function setUserPrivateKeyForThread(sb, userId, threadId, secretK) {
		const next = await getUserMeta(sb, userId);
		const keys =
			next.chat_private_keys &&
			typeof next.chat_private_keys === "object" &&
			!Array.isArray(next.chat_private_keys)
				? { ...next.chat_private_keys }
				: {};
		keys[String(Number(threadId))] = {
			k: String(secretK || ""),
			v: 1,
			added_at: new Date().toISOString()
		};
		next.chat_private_keys = keys;
		const { error } = await sb.from("prsn_users").update({ meta: next }).eq("id", userId);
		if (error) throw error;
	}

	async function removeUserPrivateKeyForThread(sb, userId, threadId) {
		const next = await getUserMeta(sb, userId);
		const keys =
			next.chat_private_keys &&
			typeof next.chat_private_keys === "object" &&
			!Array.isArray(next.chat_private_keys)
				? { ...next.chat_private_keys }
				: null;
		if (!keys) return;
		delete keys[String(Number(threadId))];
		next.chat_private_keys = keys;
		const { error } = await sb.from("prsn_users").update({ meta: next }).eq("id", userId);
		if (error) throw error;
	}

	async function ensureDmThreadForUsers(sb, aUserId, bUserId) {
		const pairKey = dmPairKey(aUserId, bUserId);
		if (!pairKey) throw new Error("Invalid DM user ids");
		const { data: existing } = await sb
			.from("prsn_chat_threads")
			.select("id")
			.eq("type", "dm")
			.eq("dm_pair_key", pairKey)
			.maybeSingle();
		let threadId = existing?.id;
		if (!threadId) {
			const ins = await sb
				.from("prsn_chat_threads")
				.insert({ type: "dm", dm_pair_key: pairKey, channel_slug: null })
				.select("id")
				.single();
			if (ins.error) {
				const { data: again } = await sb
					.from("prsn_chat_threads")
					.select("id")
					.eq("type", "dm")
					.eq("dm_pair_key", pairKey)
					.maybeSingle();
				threadId = again?.id;
			} else {
				threadId = ins.data?.id;
			}
		}
		if (!threadId) throw new Error("Could not create DM thread");
		const members =
			Number(aUserId) === Number(bUserId)
				? [{ thread_id: threadId, user_id: aUserId }]
				: [
						{ thread_id: threadId, user_id: aUserId },
						{ thread_id: threadId, user_id: bUserId }
					];
		const { error: memErr } = await sb.from("prsn_chat_members").upsert(members, {
			onConflict: "thread_id,user_id",
			ignoreDuplicates: true
		});
		if (memErr) throw memErr;
		return { threadId: Number(threadId), pairKey };
	}

	function buildTimedChannelInviteBody({ inviterName }) {
		const who = inviterName && String(inviterName).trim() ? String(inviterName).trim() : "A member";
		return `${who} invited you to a private channel.`;
	}

function buildChannelInviteSystemBody({ inviterHandle, invitedHandles }) {
	const inviter = String(inviterHandle || "").trim() || "Someone";
	const invited = Array.isArray(invitedHandles)
		? invitedHandles.map((h) => String(h || "").trim()).filter(Boolean)
		: [];
	const invitedText = invited.length > 0 ? invited.join(", ") : "someone";
	return `${inviter} invited ${invitedText} to the channel`;
}

	async function isMember(sb, threadId, userId) {
		const { data, error } = await sb
			.from("prsn_chat_members")
			.select("user_id")
			.eq("thread_id", threadId)
			.eq("user_id", userId)
			.maybeSingle();
		if (error) throw error;
		return !!data;
	}

	async function viewerIsAdminRole(userId) {
		try {
			if (typeof queries?.selectUserById?.get !== "function") return false;
			const u = await queries.selectUserById.get(userId);
			return u?.role === "admin";
		} catch {
			return false;
		}
	}

	async function viewerIsFounderPlan(userId) {
		try {
			if (typeof queries?.selectUserById?.get !== "function") return false;
			const u = await queries.selectUserById.get(userId);
			const plan = u?.meta && typeof u.meta === "object" ? u.meta.plan : null;
			return plan === "founder";
		} catch {
			return false;
		}
	}

	/** Channel message pin allowlist (in addition to admins). */
	const CHANNEL_MESSAGE_PIN_ALLOWLIST_USERNAMES = new Set(["oceanman"]);

	async function viewerCanPinChannelMessages(userId) {
		if (await viewerIsAdminRole(userId)) return true;
		try {
			if (typeof queries?.selectUserProfileByUserId?.get !== "function") return false;
			const profile = await queries.selectUserProfileByUserId.get(userId);
			const un =
				typeof profile?.user_name === "string" ? profile.user_name.trim().toLowerCase() : "";
			return un.length > 0 && CHANNEL_MESSAGE_PIN_ALLOWLIST_USERNAMES.has(un);
		} catch {
			return false;
		}
	}

	function isCanvasMessageRow(msg) {
		const meta = msg?.meta;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
		const canvas = meta.canvas;
		if (!canvas || typeof canvas !== "object") return false;
		const title = typeof canvas.title === "string" ? canvas.title.trim() : "";
		return title.length > 0;
	}

	/** Channel default canvas: `prsn_chat_threads.meta.canvas.pinned_message_id` (message id). */
	function getPinnedCanvasMessageIdFromThreadRow(threadRow) {
		if (!threadRow || typeof threadRow !== "object") return null;
		const m = threadRow.meta;
		if (!m || typeof m !== "object" || Array.isArray(m)) return null;
		const canvas = m.canvas;
		if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) return null;
		const id = canvas.pinned_message_id ?? canvas.pinnedMessageId;
		const n = id != null ? Number(id) : null;
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	function buildThreadMetaWithPinnedCanvasId(prevMeta, pinnedMessageIdOrNull) {
		const prev =
			prevMeta && typeof prevMeta === "object" && !Array.isArray(prevMeta) ? { ...prevMeta } : {};
		const prevCanvas =
			prev.canvas && typeof prev.canvas === "object" && !Array.isArray(prev.canvas)
				? { ...prev.canvas }
				: {};
		if (pinnedMessageIdOrNull == null) {
			delete prevCanvas.pinned_message_id;
			delete prevCanvas.pinnedMessageId;
			if (Object.keys(prevCanvas).length === 0) {
				delete prev.canvas;
			} else {
				prev.canvas = prevCanvas;
			}
		} else {
			prevCanvas.pinned_message_id = pinnedMessageIdOrNull;
			delete prevCanvas.pinnedMessageId;
			prev.canvas = prevCanvas;
		}
		return prev;
	}

	/** Channel message pin (one per channel): `prsn_chat_threads.meta.channel_pin.message_id`. */
	function getChannelPinnedMessageIdFromThreadRow(threadRow) {
		if (!threadRow || typeof threadRow !== "object") return null;
		const m = threadRow.meta;
		if (!m || typeof m !== "object" || Array.isArray(m)) return null;
		const pin = m.channel_pin;
		if (!pin || typeof pin !== "object" || Array.isArray(pin)) return null;
		const id = pin.message_id ?? pin.messageId;
		const n = id != null ? Number(id) : null;
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	function buildThreadMetaWithChannelPin(prevMeta, pinnedMessageIdOrNull, pinnedByUserId) {
		const prev =
			prevMeta && typeof prevMeta === "object" && !Array.isArray(prevMeta) ? { ...prevMeta } : {};
		if (pinnedMessageIdOrNull == null) {
			delete prev.channel_pin;
			return prev;
		}
		const pin = {
			message_id: pinnedMessageIdOrNull,
			pinned_at: new Date().toISOString()
		};
		const by = pinnedByUserId != null ? Number(pinnedByUserId) : null;
		if (Number.isFinite(by) && by > 0) pin.pinned_by = by;
		prev.channel_pin = pin;
		return prev;
	}

	function isSystemEventMessageRow(msg) {
		const meta = msg?.meta;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
		const ev = meta.system_event;
		return Boolean(ev && typeof ev === "object" && !Array.isArray(ev));
	}

	// GET /api/chat/unread-summary — total unread + split for Challenges vs Chat nav badges
	router.get("/api/chat/unread-summary", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const { data, error } = await sb.rpc("prsn_chat_unread_total", {
				p_user_id: userId
			});
			if (error) throw error;
			const raw = data;
			const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
			const total = Number.isFinite(n) ? Math.max(0, n) : 0;

			let challengesUnread = 0;
			const challengesTid = await findChallengesChannelThreadId(sb);
			if (challengesTid != null) {
				const { data: mem, error: memErr } = await sb
					.from("prsn_chat_members")
					.select("last_read_message_id")
					.eq("thread_id", challengesTid)
					.eq("user_id", userId)
					.maybeSingle();
				if (memErr) throw memErr;
				if (mem) {
					const lastRead =
						mem.last_read_message_id != null ? Number(mem.last_read_message_id) : null;
					let q = sb
						.from("prsn_chat_messages")
						.select("id", { count: "exact", head: true })
						.eq("thread_id", challengesTid)
						.neq("sender_id", userId);
					if (Number.isFinite(lastRead) && lastRead > 0) {
						q = q.gt("id", lastRead);
					}
					const { count, error: cntErr } = await q;
					if (cntErr) throw cntErr;
					const c = Number(count);
					challengesUnread = Number.isFinite(c) && c > 0 ? c : 0;
				}
			}

			const chatUnread = Math.max(0, total - challengesUnread);
			return res.status(200).json({
				total_unread: total,
				challenges_unread: challengesUnread,
				chat_unread: chatUnread,
				viewer_id: userId
			});
		} catch (err) {
			console.error("[GET /api/chat/unread-summary]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/normalize-body  { body } — canonicalize outgoing body (e.g. unpublished /creations/:id -> share URL)
	router.post("/api/chat/normalize-body", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const bodyRaw = req.body?.body;
		const body =
			typeof bodyRaw === "string"
				? bodyRaw.replace(/\u0000/g, "").trim()
				: "";
		if (!body) {
			return res.status(400).json({ error: "Bad request", message: "body required" });
		}
		if (body.length > MAX_MESSAGE_CHARS) {
			return res.status(400).json({
				error: "Bad request",
				message: `body must be at most ${MAX_MESSAGE_CHARS} characters`
			});
		}
		try {
			const normalized = await normalizeUnpublishedCreationUrlsInChatBody(body, userId, queries);
			return res.status(200).json({
				body: stabilizeChallengeConfigCreationRefsInBody(normalized)
			});
		} catch (err) {
			console.error("[POST /api/chat/normalize-body]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads — threads the current user belongs to (with last message preview)
	router.get("/api/chat/threads", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const { data: rows, error } = await sb.rpc("prsn_chat_threads_for_user", {
				p_user_id: userId
			});
			if (error) throw error;

			const list = Array.isArray(rows) ? rows : [];
			const viewerMeta = await getUserMeta(sb, userId);
			const viewerPrivateKeys =
				viewerMeta.chat_private_keys &&
				typeof viewerMeta.chat_private_keys === "object" &&
				!Array.isArray(viewerMeta.chat_private_keys)
					? viewerMeta.chat_private_keys
					: {};
			const threadIds = list
				.map((row) => Number(row?.thread_id))
				.filter((n) => Number.isFinite(n) && n > 0);
			const threadMetaById = new Map();
			if (threadIds.length > 0) {
				const { data: threadsMetaRows, error: tErr } = await sb
					.from("prsn_chat_threads")
					.select("id, meta")
					.in("id", threadIds);
				if (tErr) throw tErr;
				for (const tr of threadsMetaRows || []) {
					threadMetaById.set(Number(tr.id), tr.meta && typeof tr.meta === "object" ? tr.meta : {});
				}
			}
			const otherIds = new Set();
			for (const row of list) {
				if (row?.thread_type === "dm" && row?.dm_pair_key) {
					const oid = otherUserIdFromDmPairKey(row.dm_pair_key, userId);
					if (oid != null) otherIds.add(oid);
				}
			}

			let profileMap = new Map();
			if (otherIds.size > 0 && typeof queries.selectUserProfilesByUserIds === "function") {
				profileMap = await queries.selectUserProfilesByUserIds([...otherIds]);
			}

			const threads = list.map((row) => {
				const id = Number(row.thread_id);
				const type = row.thread_type;
				const lastMsgId = row.last_message_id != null ? Number(row.last_message_id) : null;
				const lastMessage =
					row.last_message_at && row.last_message_body != null
						? {
								id: Number.isFinite(lastMsgId) && lastMsgId > 0 ? lastMsgId : null,
								body: String(row.last_message_body),
								created_at: row.last_message_at,
								sender_id: Number(row.last_sender_id)
							}
						: null;
				const lastRead =
					row.last_read_message_id != null ? Number(row.last_read_message_id) : null;
				const uc = Number(row.unread_count);
				const unreadCount = Number.isFinite(uc) && uc > 0 ? uc : 0;

				if (type === "channel") {
					const slug = row.channel_slug ? String(row.channel_slug) : "";
					const threadMeta = threadMetaById.get(id) || {};
					const visibility = threadVisibilityFromMeta(threadMeta);
					let title = slug ? `#${slug}` : "Channel";
					if (visibility === PRIVATE_CHANNEL_VISIBILITY) {
						const keyEntry =
							viewerPrivateKeys[String(id)] && typeof viewerPrivateKeys[String(id)] === "object"
								? viewerPrivateKeys[String(id)]
								: null;
						const k = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
						const encName =
							typeof threadMeta.enc_name === "string" ? String(threadMeta.enc_name).trim() : "";
						const dec = k && encName ? decryptPrivateTextWithSecret(encName, k) : null;
						title = dec && dec.trim() ? `#${dec.trim()}` : "#private";
					}
					return {
						id,
						type: "channel",
						channel_slug: slug,
						title,
						last_message: lastMessage,
						last_read_message_id: Number.isFinite(lastRead) && lastRead > 0 ? lastRead : null,
						unread_count: unreadCount,
						visibility,
						enc_name:
							visibility === PRIVATE_CHANNEL_VISIBILITY &&
							typeof threadMeta.enc_name === "string" &&
							threadMeta.enc_name.trim()
								? String(threadMeta.enc_name)
								: null,
						enc_probe:
							visibility === PRIVATE_CHANNEL_VISIBILITY &&
							typeof threadMeta.enc_probe === "string" &&
							threadMeta.enc_probe.trim()
								? String(threadMeta.enc_probe)
								: null
					};
				}

				const otherId = otherUserIdFromDmPairKey(row.dm_pair_key, userId);
				const profile = otherId != null ? profileMap.get(otherId) : null;
				const title = dmChatInboxTitleFromProfile(profile, otherId);
				return {
					id,
					type: "dm",
					dm_pair_key: row.dm_pair_key,
					other_user_id: otherId,
					title,
					other_user:
						otherId != null
							? {
									id: otherId,
									display_name: profile?.display_name ?? null,
									user_name: profile?.user_name ?? null,
									avatar_url: profile?.avatar_url ?? null
								}
							: null,
					last_message: lastMessage,
					last_read_message_id: Number.isFinite(lastRead) && lastRead > 0 ? lastRead : null,
					unread_count: unreadCount
				};
			});

			let viewerIsAdmin = false;
			let viewerIsFounder = false;
			let viewerCanPinMessages = false;
			try {
				if (typeof queries?.selectUserById?.get === "function") {
					const u = await queries.selectUserById.get(userId);
					viewerIsAdmin = u?.role === "admin";
					const plan = u?.meta && typeof u.meta === "object" ? u.meta.plan : null;
					viewerIsFounder = plan === "founder";
				}
				viewerCanPinMessages = await viewerCanPinChannelMessages(userId);
			} catch {
				viewerIsAdmin = false;
				viewerIsFounder = false;
				viewerCanPinMessages = false;
			}

			return res.status(200).json({
				viewer_id: userId,
				viewer_is_admin: viewerIsAdmin,
				viewer_is_founder: viewerIsFounder,
				viewer_can_pin_messages: viewerCanPinMessages,
				threads
			});
		} catch (err) {
			console.error("[GET /api/chat/threads]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/channel-slugs — distinct channel tags that exist (browse / open)
	router.get("/api/chat/channel-slugs", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const { data, error } = await sb
				.from("prsn_chat_threads")
				.select("channel_slug, meta")
				.eq("type", "channel");
			if (error) throw error;
			const set = new Set();
			for (const row of data || []) {
				const s = row?.channel_slug != null ? String(row.channel_slug).trim() : "";
				const visibility = threadVisibilityFromMeta(row?.meta);
				if (visibility === PRIVATE_CHANNEL_VISIBILITY) continue;
				if (s) set.add(s);
			}
			const slugs = [...set].sort((a, b) => a.localeCompare(b));
			return res.status(200).json({ slugs });
		} catch (err) {
			console.error("[GET /api/chat/channel-slugs]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/hashtag-channel-exists/:rawSlug — hashtag channel thread exists (for # link chooser in chat UI)
	router.get("/api/chat/hashtag-channel-exists/:rawSlug", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const slug = normalizeTag(req.params?.rawSlug ?? "");
		if (!slug) {
			return res.status(400).json({ error: "Bad request", message: "Invalid tag" });
		}
		const sb = getSb(res);
		if (!sb) return;

		if (SYSTEM_RESERVED_CHANNEL_SLUGS.has(slug)) {
			return res.status(200).json({ slug, channelExists: true });
		}

		try {
			const { data, error } = await sb
				.from("prsn_chat_threads")
				.select("id, meta")
				.eq("type", "channel")
				.eq("channel_slug", slug)
				.maybeSingle();
			if (error) throw error;
			const exists = Boolean(data?.id) && threadVisibilityFromMeta(data?.meta) !== PRIVATE_CHANNEL_VISIBILITY;
			return res.status(200).json({ slug, channelExists: exists });
		} catch (err) {
			console.error("[GET /api/chat/hashtag-channel-exists]", err);
			return res.status(500).json({ error: "Server error", message: "Failed" });
		}
	});

	// POST /api/chat/dm  { other_user_id } | { other_user_name }
	router.post("/api/chat/dm", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const idRaw = req.body?.other_user_id ?? req.body?.otherUserId;
		const nameRaw = req.body?.other_user_name ?? req.body?.otherUsername ?? req.body?.username;

		let otherId = null;
		if (idRaw != null && String(idRaw).trim() !== "") {
			const n = Number(idRaw);
			if (Number.isFinite(n) && n > 0) otherId = n;
		}

		if (otherId == null) {
			const un = normalizeDmUsernameInput(typeof nameRaw === "string" ? nameRaw : "");
			if (!un) {
				return res.status(400).json({
					error: "Bad request",
					message: "other_user_id or other_user_name required"
				});
			}
			if (!queries.selectUserProfileByUsername?.get) {
				return res.status(503).json({
					error: "Service unavailable",
					message: "Username lookup unavailable"
				});
			}
			const profile = await queries.selectUserProfileByUsername.get(un);
			const uid = Number(profile?.user_id);
			if (!Number.isFinite(uid) || uid <= 0) {
				return res.status(404).json({ error: "Not found", message: "User not found" });
			}
			otherId = uid;
		}

		try {
			const otherUser = await queries.selectUserById?.get(otherId);
			if (!otherUser) {
				return res.status(404).json({ error: "Not found", message: "User not found" });
			}

			const pairKey = dmPairKey(userId, otherId);
			if (!pairKey) {
				return res.status(400).json({ error: "Bad request", message: "Invalid user ids" });
			}

			const { data: existing } = await sb
				.from("prsn_chat_threads")
				.select("id")
				.eq("type", "dm")
				.eq("dm_pair_key", pairKey)
				.maybeSingle();

			let threadId = existing?.id;

			if (!threadId) {
				const ins = await sb
					.from("prsn_chat_threads")
					.insert({ type: "dm", dm_pair_key: pairKey, channel_slug: null })
					.select("id")
					.single();
				if (ins.error) {
					const { data: again } = await sb
						.from("prsn_chat_threads")
						.select("id")
						.eq("type", "dm")
						.eq("dm_pair_key", pairKey)
						.maybeSingle();
					threadId = again?.id;
				} else {
					threadId = ins.data?.id;
				}
			}

			if (!threadId) {
				return res.status(500).json({ error: "Server error", message: "Could not create thread" });
			}

			const members =
				otherId === userId
					? [{ thread_id: threadId, user_id: userId }]
					: [
							{ thread_id: threadId, user_id: userId },
							{ thread_id: threadId, user_id: otherId }
						];
			const { error: memErr } = await sb.from("prsn_chat_members").upsert(members, {
				onConflict: "thread_id,user_id",
				ignoreDuplicates: true
			});
			if (memErr) throw memErr;

			return res.status(200).json({
				thread: { id: threadId, type: "dm", dm_pair_key: pairKey, channel_slug: null }
			});
		} catch (err) {
			console.error("[POST /api/chat/dm]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/channels  { tag }
	router.post("/api/chat/channels", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const visibilityRaw = typeof req.body?.visibility === "string" ? req.body.visibility.trim().toLowerCase() : "";
		const isPrivate = visibilityRaw === PRIVATE_CHANNEL_VISIBILITY;
		const encName = typeof req.body?.enc_name === "string" ? req.body.enc_name.trim() : "";
		const encProbe = typeof req.body?.enc_probe === "string" ? req.body.enc_probe.trim() : "";
		const secretK = typeof req.body?.secret_k === "string" ? req.body.secret_k.trim() : "";
		let slug = normalizeTag(req.body?.tag ?? req.body?.channel ?? "");
		if (isPrivate) slug = encName;
		if (!slug) {
			return res.status(400).json({ error: "Bad request", message: "Invalid or missing tag" });
		}
		if (isPrivate && (!encName || !encProbe || !secretK)) {
			return res.status(400).json({
				error: "Bad request",
				message: "enc_name, enc_probe, and secret_k are required for private channels"
			});
		}
		if (isPrivate) {
			const [isAdmin, isFounder] = await Promise.all([
				viewerIsAdminRole(userId),
				viewerIsFounderPlan(userId)
			]);
			if (!isAdmin && !isFounder) {
				return res.status(403).json({
					error: "Forbidden",
					message: "Only founders or admins can create private channels"
				});
			}
		}

		if (POST_REJECT_PSEUDO_CHANNEL_SLUGS.has(slug)) {
			return res.status(400).json({
				error: "Bad request",
				message: "This channel name is reserved. Use the shortcuts in chat to open that view.",
			});
		}

		try {
			const { data: existing } = await sb
				.from("prsn_chat_threads")
				.select("id")
				.eq("type", "channel")
				.eq("channel_slug", slug)
				.maybeSingle();

			let threadId = existing?.id;

			if (!threadId) {
				const threadMeta = isPrivate ? buildPrivateChannelMeta({ prevMeta: null, encName, encProbe }) : {};
				const ins = await sb
					.from("prsn_chat_threads")
					.insert({ type: "channel", dm_pair_key: null, channel_slug: slug, meta: threadMeta })
					.select("id")
					.single();
				if (ins.error) {
					const { data: again } = await sb
						.from("prsn_chat_threads")
						.select("id")
						.eq("type", "channel")
						.eq("channel_slug", slug)
						.maybeSingle();
					threadId = again?.id;
				} else {
					threadId = ins.data?.id;
				}
			}

			if (!threadId) {
				return res.status(500).json({ error: "Server error", message: "Could not create channel" });
			}

			const { error: memErr } = await sb.from("prsn_chat_members").upsert(
				{ thread_id: threadId, user_id: userId },
				{ onConflict: "thread_id,user_id", ignoreDuplicates: true }
			);
			if (memErr) throw memErr;
			if (isPrivate) {
				await setUserPrivateKeyForThread(sb, userId, threadId, secretK);
			}

			return res.status(200).json({
				thread: {
					id: threadId,
					type: "channel",
					channel_slug: slug,
					dm_pair_key: null,
					visibility: isPrivate ? PRIVATE_CHANNEL_VISIBILITY : "public",
					enc_name: isPrivate ? encName : null,
					enc_probe: isPrivate ? encProbe : null
				}
			});
		} catch (err) {
			console.error("[POST /api/chat/channels]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/invites  { thread_id } — private channel only; member can issue.
	router.post("/api/chat/invites", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.body?.thread_id ?? req.body?.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "thread_id required" });
		}
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(400).json({ error: "Bad request", message: "Invite only supports channels" });
			}
			if (threadVisibilityFromMeta(thread.meta) !== PRIVATE_CHANNEL_VISIBILITY) {
				return res.status(400).json({ error: "Bad request", message: "Invites are only for private channels" });
			}
			const userMeta = await getUserMeta(sb, userId);
			const keyMap =
				userMeta.chat_private_keys &&
				typeof userMeta.chat_private_keys === "object" &&
				!Array.isArray(userMeta.chat_private_keys)
					? userMeta.chat_private_keys
					: {};
			const keyEntry =
				keyMap[String(threadId)] && typeof keyMap[String(threadId)] === "object"
					? keyMap[String(threadId)]
					: null;
			const secretK = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
			if (!secretK) {
				return res.status(400).json({ error: "Bad request", message: "Missing channel key for inviter" });
			}
			const expiresAtMs = Date.now() + INVITE_TOKEN_TTL_MS;
			const inviteToken = mintChatInviteToken({
				threadId,
				secretK,
				inviterUserId: userId,
				expiresAtMs
			});
			const inviteUrl = `${getShareBaseUrl()}/chat#ci=${encodeURIComponent(inviteToken)}`;
			return res.status(200).json({
				invite_token: inviteToken,
				invite_url: inviteUrl,
				expires_at: new Date(expiresAtMs).toISOString()
			});
		} catch (err) {
			console.error("[POST /api/chat/invites]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/invites/accept  { invite_token } — joins private channel and copies key to invitee meta.
	router.post("/api/chat/invites/accept", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const inviteToken = typeof req.body?.invite_token === "string" ? req.body.invite_token.trim() : "";
		if (!inviteToken) {
			return res.status(400).json({ error: "Bad request", message: "invite_token required" });
		}
		try {
			const parsed = verifyChatInviteToken(inviteToken);
			if (!parsed.ok) {
				return res.status(400).json({ error: "Bad request", message: "Invalid or expired invite token" });
			}
			const threadId = parsed.threadId;
			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(404).json({ error: "Not found", message: "Channel not found" });
			}
			if (threadVisibilityFromMeta(thread.meta) !== PRIVATE_CHANNEL_VISIBILITY) {
				return res.status(400).json({ error: "Bad request", message: "Invite is not for a private channel" });
			}
			if (!(await isMember(sb, threadId, parsed.inviterUserId))) {
				return res.status(403).json({ error: "Forbidden", message: "Invite issuer is no longer a member" });
			}
			const { error: memErr } = await sb.from("prsn_chat_members").upsert(
				{ thread_id: threadId, user_id: userId },
				{ onConflict: "thread_id,user_id", ignoreDuplicates: true }
			);
			if (memErr) throw memErr;
			await setUserPrivateKeyForThread(sb, userId, threadId, parsed.secretK);
			const { data: memRows } = await sb.from("prsn_chat_members").select("user_id").eq("thread_id", threadId);
			const uids = Array.isArray(memRows) ? memRows.map((r) => r.user_id) : [];
			void broadcastUserInboxDirty(threadId, uids);
			try {
				await removeJoinedPrivateChannelInviteDmMessages({ sb, userId });
			} catch (cleanupErr) {
				console.warn("[POST /api/chat/invites/accept] invite DM cleanup:", cleanupErr?.message || cleanupErr);
			}
			return res.status(200).json({ ok: true, thread_id: threadId });
		} catch (err) {
			console.error("[POST /api/chat/invites/accept]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/invites/dm  { thread_id, recipients: [{ user_id? user_name? }] }
	router.post("/api/chat/invites/dm", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.body?.thread_id ?? req.body?.threadId);
		const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "thread_id required" });
		}
		if (recipients.length === 0) {
			return res.status(400).json({ error: "Bad request", message: "recipients required" });
		}
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel" || threadVisibilityFromMeta(thread.meta) !== PRIVATE_CHANNEL_VISIBILITY) {
				return res.status(400).json({ error: "Bad request", message: "Only private channels support DM invites" });
			}
			const inviterMeta = await getUserMeta(sb, userId);
			const keyMap =
				inviterMeta.chat_private_keys &&
				typeof inviterMeta.chat_private_keys === "object" &&
				!Array.isArray(inviterMeta.chat_private_keys)
					? inviterMeta.chat_private_keys
					: {};
			const keyEntry =
				keyMap[String(threadId)] && typeof keyMap[String(threadId)] === "object"
					? keyMap[String(threadId)]
					: null;
			const secretK = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
			if (!secretK) {
				return res.status(400).json({ error: "Bad request", message: "Missing channel key for inviter" });
			}
			const inviterProfile =
				typeof queries?.selectUserProfileByUserId?.get === "function"
					? await queries.selectUserProfileByUserId.get(userId).catch(() => null)
					: null;
			const inviterName =
				typeof inviterProfile?.display_name === "string" && inviterProfile.display_name.trim()
					? inviterProfile.display_name.trim()
					: typeof inviterProfile?.user_name === "string" && inviterProfile.user_name.trim()
						? `@${inviterProfile.user_name.trim()}`
						: "A member";
			const inviterHandle =
				typeof inviterProfile?.user_name === "string" && inviterProfile.user_name.trim()
					? `@${inviterProfile.user_name.trim()}`
					: inviterName;
			const sent = [];
			const alreadyJoined = [];
			const invitedHandles = [];
			const processedRecipientIds = new Set();
			for (const r of recipients) {
				let toUserId = null;
				let toUserHandle = "";
				const idCandidate = Number(r?.user_id ?? r?.userId);
				if (Number.isFinite(idCandidate) && idCandidate > 0) {
					toUserId = idCandidate;
					if (typeof queries?.selectUserProfileByUserId?.get === "function") {
						const p = await queries.selectUserProfileByUserId.get(toUserId).catch(() => null);
						if (typeof p?.user_name === "string" && p.user_name.trim()) {
							toUserHandle = `@${p.user_name.trim()}`;
						}
					}
				} else {
					const un = normalizeDmUsernameInput(r?.user_name ?? r?.userName ?? "");
					if (un && typeof queries?.selectUserProfileByUsername?.get === "function") {
						const p = await queries.selectUserProfileByUsername.get(un).catch(() => null);
						const uid = Number(p?.user_id);
						if (Number.isFinite(uid) && uid > 0) {
							toUserId = uid;
							toUserHandle =
								typeof p?.user_name === "string" && p.user_name.trim()
									? `@${p.user_name.trim()}`
									: "";
						}
					}
				}
				if (!Number.isFinite(Number(toUserId)) || Number(toUserId) <= 0) continue;
				if (Number(toUserId) === Number(userId)) continue;
				if (processedRecipientIds.has(Number(toUserId))) continue;
				processedRecipientIds.add(Number(toUserId));
				if (await isMember(sb, threadId, toUserId)) {
					alreadyJoined.push(toUserHandle || `user ${Number(toUserId)}`);
					continue;
				}
				const expiresAtMs = Date.now() + TIMED_MESSAGE_DEFAULT_INVITE_TTL_MS;
				const inviteToken = mintChatInviteToken({
					threadId,
					secretK,
					inviterUserId: userId,
					expiresAtMs
				});
				const { threadId: dmThreadId } = await ensureDmThreadForUsers(sb, userId, toUserId);
				const body = buildTimedChannelInviteBody({ inviterName });
				const meta = {
					time_sensitive: {
						kind: TIMED_MESSAGE_KIND_CHANNEL_INVITE,
						expires_at: new Date(expiresAtMs).toISOString(),
						delete_on_expire: true,
						cta: {
							action: "accept_private_channel_invite",
							label: "Accept invite",
							invite_token: inviteToken
						},
						private_channel_invite: {
							channel_thread_id: threadId,
							invitee_user_id: Number(toUserId)
						}
					}
				};
				const ins = await sb
					.from("prsn_chat_messages")
					.insert({
						thread_id: dmThreadId,
						sender_id: userId,
						body,
						meta
					})
					.select("id")
					.single();
				if (ins.error) throw ins.error;
				const mid = Number(ins.data?.id);
				if (Number.isFinite(mid) && mid > 0) {
					const { error: readErr } = await sb
						.from("prsn_chat_members")
						.update({ last_read_message_id: mid })
						.eq("thread_id", dmThreadId)
						.eq("user_id", userId);
					if (readErr) throw readErr;
					void broadcastRoomDirty(dmThreadId, mid);
				}
				const mem = await sb.from("prsn_chat_members").select("user_id").eq("thread_id", dmThreadId);
				const uids = Array.isArray(mem.data) ? mem.data.map((x) => x.user_id) : [];
				void broadcastUserInboxDirty(dmThreadId, uids);
				if (toUserHandle) invitedHandles.push(toUserHandle);
				sent.push({ to_user_id: Number(toUserId), dm_thread_id: dmThreadId });
			}
			if (sent.length > 0) {
				const channelSystemBodyPlain = buildChannelInviteSystemBody({
					inviterHandle,
					invitedHandles
				});
				const channelSystemCipher = encryptPrivateTextWithSecret(channelSystemBodyPlain, secretK);
				if (!channelSystemCipher) {
					throw new Error("Could not encrypt private channel system event");
				}
				const channelSystemBody = `${CHAT_PRIVATE_BODY_PREFIX}${channelSystemCipher}`;
				const systemMeta = {
					system_event: {
						kind: SYSTEM_EVENT_KIND_CHANNEL_INVITE_SENT,
						inviter_user_id: Number(userId),
						invited_user_ids: sent.map((x) => Number(x.to_user_id)).filter((n) => Number.isFinite(n) && n > 0)
					}
				};
				const insSystem = await sb
					.from("prsn_chat_messages")
					.insert({
						thread_id: threadId,
						sender_id: userId,
						body: channelSystemBody,
						meta: systemMeta
					})
					.select("id")
					.single();
				if (!insSystem.error) {
					const sysMid = Number(insSystem.data?.id);
					if (Number.isFinite(sysMid) && sysMid > 0) {
						const { error: readErr } = await sb
							.from("prsn_chat_members")
							.update({ last_read_message_id: sysMid })
							.eq("thread_id", threadId)
							.eq("user_id", userId);
						if (readErr) throw readErr;
						void broadcastRoomDirty(threadId, sysMid);
						const mem = await sb.from("prsn_chat_members").select("user_id").eq("thread_id", threadId);
						const uids = Array.isArray(mem.data) ? mem.data.map((x) => x.user_id) : [];
						void broadcastUserInboxDirty(threadId, uids);
					}
				}
			}
			const alreadyJoinedUnique = [...new Set(alreadyJoined)];
			if (sent.length === 0 && alreadyJoinedUnique.length > 0) {
				return res.status(409).json({
					error: "Conflict",
					message: `Already joined: ${alreadyJoinedUnique.join(", ")}`,
					already_joined: alreadyJoinedUnique,
					sent_count: 0,
					sent: []
				});
			}
			return res.status(200).json({
				ok: true,
				sent_count: sent.length,
				sent,
				already_joined: alreadyJoinedUnique
			});
		} catch (err) {
			console.error("[POST /api/chat/invites/dm]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId/private-key — return viewer key for private thread.
	router.get("/api/chat/threads/:threadId/private-key", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || threadVisibilityFromMeta(thread.meta) !== PRIVATE_CHANNEL_VISIBILITY) {
				return res.status(404).json({ error: "Not found", message: "Private key not available" });
			}
			const userMeta = await getUserMeta(sb, userId);
			const keyMap =
				userMeta.chat_private_keys &&
				typeof userMeta.chat_private_keys === "object" &&
				!Array.isArray(userMeta.chat_private_keys)
					? userMeta.chat_private_keys
					: {};
			const row =
				keyMap[String(threadId)] && typeof keyMap[String(threadId)] === "object"
					? keyMap[String(threadId)]
					: null;
			const k = typeof row?.k === "string" ? row.k.trim() : "";
			const v = Number(row?.v);
			if (!k) {
				return res.status(404).json({ error: "Not found", message: "Private key missing" });
			}
			return res.status(200).json({ k, v: Number.isFinite(v) && v > 0 ? v : 1 });
		} catch (err) {
			console.error("[GET /api/chat/threads/:threadId/private-key]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId
	router.get("/api/chat/threads/:threadId", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: thread, error } = await sb
				.from("prsn_chat_threads")
				.select("id, type, dm_pair_key, channel_slug, created_at, meta")
				.eq("id", threadId)
				.single();
			if (error || !thread) {
				return res.status(404).json({ error: "Not found", message: "Thread not found" });
			}

			const { data: memRow, error: memErr } = await sb
				.from("prsn_chat_members")
				.select("last_read_message_id")
				.eq("thread_id", threadId)
				.eq("user_id", userId)
				.maybeSingle();
			if (memErr) throw memErr;
			const lr = memRow?.last_read_message_id != null ? Number(memRow.last_read_message_id) : null;

			const out = { ...thread };
			const visibility = threadVisibilityFromMeta(thread.meta);
			out.visibility = visibility;
			out.enc_name =
				visibility === PRIVATE_CHANNEL_VISIBILITY && typeof thread?.meta?.enc_name === "string"
					? thread.meta.enc_name
					: null;
			out.enc_probe =
				visibility === PRIVATE_CHANNEL_VISIBILITY && typeof thread?.meta?.enc_probe === "string"
					? thread.meta.enc_probe
					: null;
			out.last_read_message_id = Number.isFinite(lr) && lr > 0 ? lr : null;
			const pcm = getPinnedCanvasMessageIdFromThreadRow(thread);
			out.pinned_canvas_message_id = pcm;
			const channelPinId = getChannelPinnedMessageIdFromThreadRow(thread);
			out.pinned_message_id = channelPinId;
			out.pinned_message = null;
			if (channelPinId != null) {
				const { data: pinMsg, error: pinMsgErr } = await sb
					.from("prsn_chat_messages")
					.select("id, thread_id, sender_id, body, reactions, meta, created_at")
					.eq("id", channelPinId)
					.eq("thread_id", threadId)
					.maybeSingle();
				if (pinMsgErr) throw pinMsgErr;
				if (pinMsg) {
					const enriched = await enrichChatMessagesWithSenderProfiles(sb, [pinMsg]);
					out.pinned_message = (
						await enrichChatReactionsFromMessageColumn(
							[enriched[0] || pinMsg],
							userId,
							queries
						)
					)[0];
				} else {
					// Stale pin (message gone) — clear meta so banner does not stick.
					const nextMeta = buildThreadMetaWithChannelPin(thread.meta, null);
					const { error: clearErr } = await sb
						.from("prsn_chat_threads")
						.update({ meta: nextMeta })
						.eq("id", threadId);
					if (clearErr) throw clearErr;
					out.pinned_message_id = null;
					out.pinned_message = null;
				}
			}
			if (thread.type === "channel") {
				const slug = thread.channel_slug ? String(thread.channel_slug) : "";
				if (visibility === PRIVATE_CHANNEL_VISIBILITY) {
					const viewerMeta = await getUserMeta(sb, userId);
					const keyMap =
						viewerMeta.chat_private_keys &&
						typeof viewerMeta.chat_private_keys === "object" &&
						!Array.isArray(viewerMeta.chat_private_keys)
							? viewerMeta.chat_private_keys
							: {};
					const keyEntry =
						keyMap[String(threadId)] && typeof keyMap[String(threadId)] === "object"
							? keyMap[String(threadId)]
							: null;
					const k = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
					const encName =
						typeof thread?.meta?.enc_name === "string" ? thread.meta.enc_name.trim() : "";
					const dec = k && encName ? decryptPrivateTextWithSecret(encName, k) : null;
					out.title = dec && dec.trim() ? `#${dec.trim()}` : "#private";
				} else {
					out.title = slug ? `#${slug}` : "Channel";
				}
			} else if (thread.type === "dm" && thread.dm_pair_key) {
				const otherId = otherUserIdFromDmPairKey(thread.dm_pair_key, userId);
				let profile = null;
				if (otherId != null && typeof queries.selectUserProfileByUserId?.get === "function") {
					try {
						profile = await queries.selectUserProfileByUserId.get(otherId);
					} catch {
						profile = null;
					}
				}
				out.title = dmChatInboxTitleFromProfile(profile, otherId);
			}

			return res.status(200).json({ thread: out });
		} catch (err) {
			console.error("[GET /api/chat/threads/:threadId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId/member-status — private channel roster (joined vs invited)
	router.get("/api/chat/threads/:threadId/member-status", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: thread, error: threadErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (threadErr) throw threadErr;
			if (!thread || thread.type !== "channel") {
				return res.status(400).json({ error: "Bad request", message: "Only channel threads are supported" });
			}
			if (threadVisibilityFromMeta(thread.meta) !== PRIVATE_CHANNEL_VISIBILITY) {
				return res.status(400).json({ error: "Bad request", message: "Only private channels are supported" });
			}
			const { data: memberRows, error: memberErr } = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", threadId);
			if (memberErr) throw memberErr;
			const joinedIds = new Set(
				(memberRows || [])
					.map((row) => Number(row?.user_id))
					.filter((n) => Number.isFinite(n) && n > 0)
			);
			const { data: inviteRows, error: inviteErr } = await sb
				.from("prsn_chat_messages")
				.select("meta")
				.eq("thread_id", threadId)
				.contains("meta", { system_event: { kind: SYSTEM_EVENT_KIND_CHANNEL_INVITE_SENT } })
				.order("id", { ascending: false })
				.limit(200);
			if (inviteErr) throw inviteErr;
			const invitedIds = new Set();
			for (const row of inviteRows || []) {
				const meta = row?.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : null;
				const eventRaw = meta?.system_event;
				const event =
					eventRaw && typeof eventRaw === "object" && !Array.isArray(eventRaw) ? eventRaw : null;
				if (String(event?.kind || "").trim().toLowerCase() !== SYSTEM_EVENT_KIND_CHANNEL_INVITE_SENT) continue;
				const ids = Array.isArray(event?.invited_user_ids) ? event.invited_user_ids : [];
				for (const rawId of ids) {
					const n = Number(rawId);
					if (Number.isFinite(n) && n > 0) invitedIds.add(n);
				}
			}
			const allIds = [...new Set([...joinedIds, ...invitedIds])];
			let profileMap = new Map();
			if (allIds.length > 0 && typeof queries.selectUserProfilesByUserIds === "function") {
				try {
					const fetched = await queries.selectUserProfilesByUserIds(allIds);
					if (fetched instanceof Map) profileMap = fetched;
				} catch {
					profileMap = new Map();
				}
			}
			const members = allIds
				.map((id) => {
					const profile = profileMap.get(id);
					const userName =
						typeof profile?.user_name === "string" && profile.user_name.trim()
							? profile.user_name.trim()
							: null;
					const avatarUrl =
						typeof profile?.avatar_url === "string" && profile.avatar_url.trim()
							? profile.avatar_url.trim()
							: null;
					const status = joinedIds.has(id) ? "joined" : "invited";
					return {
						user_id: id,
						user_name: userName,
						avatar_url: avatarUrl,
						status
					};
				})
				.sort((a, b) => {
					if (a.status !== b.status) return a.status === "joined" ? -1 : 1;
					const aName = String(a.user_name || "").toLowerCase();
					const bName = String(b.user_name || "").toLowerCase();
					if (aName && bName) return aName.localeCompare(bName);
					if (aName) return -1;
					if (bName) return 1;
					return a.user_id - b.user_id;
				});
			return res.status(200).json({
				thread_id: threadId,
				members
			});
		} catch (err) {
			console.error("[GET /api/chat/threads/:threadId/member-status]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/read  { last_read_message_id }
	router.post("/api/chat/threads/:threadId/read", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		const rawMid = req.body?.last_read_message_id ?? req.body?.lastReadMessageId;
		const mid = Number(rawMid);
		if (!Number.isFinite(mid) || mid <= 0) {
			return res.status(400).json({ error: "Bad request", message: "last_read_message_id required" });
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: msg, error: msgErr } = await sb
				.from("prsn_chat_messages")
				.select("id")
				.eq("id", mid)
				.eq("thread_id", threadId)
				.maybeSingle();
			if (msgErr) throw msgErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found in this thread" });
			}

			const { data: memRow, error: memSelErr } = await sb
				.from("prsn_chat_members")
				.select("last_read_message_id")
				.eq("thread_id", threadId)
				.eq("user_id", userId)
				.maybeSingle();
			if (memSelErr) throw memSelErr;
			const prev = memRow?.last_read_message_id != null ? Number(memRow.last_read_message_id) : null;
			if (prev != null && mid < prev) {
				return res.status(200).json({
					ok: true,
					last_read_message_id: prev
				});
			}

			const { error: upErr } = await sb
				.from("prsn_chat_members")
				.update({ last_read_message_id: mid })
				.eq("thread_id", threadId)
				.eq("user_id", userId);
			if (upErr) throw upErr;

			if (queries.acknowledgeNotificationsForUserAndThread?.run) {
				const u = await queries.selectUserById?.get(userId);
				void queries.acknowledgeNotificationsForUserAndThread
					.run(userId, u?.role ?? null, threadId)
					.catch(() => {});
			}

			return res.status(200).json({ ok: true, last_read_message_id: mid });
		} catch (err) {
			console.error("[POST /api/chat/threads/:threadId/read]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/leave — remove self from thread + clear private key cache for that thread.
	router.post("/api/chat/threads/:threadId/leave", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(200).json({ ok: true, left: false });
			}
			const { error } = await sb
				.from("prsn_chat_members")
				.delete()
				.eq("thread_id", threadId)
				.eq("user_id", userId);
			if (error) throw error;
			await removeUserPrivateKeyForThread(sb, userId, threadId);
			return res.status(200).json({ ok: true, left: true });
		} catch (err) {
			console.error("[POST /api/chat/threads/:threadId/leave]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/hide — hide a DM from the sidebar (per-member).
	// Body { hidden: false } clears it. Hidden DMs reappear once a newer message arrives.
	router.post("/api/chat/threads/:threadId/hide", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;
		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}
		const hidden = req.body?.hidden !== false;
		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { error } = await sb
				.from("prsn_chat_members")
				.update({ hidden_at: hidden ? new Date().toISOString() : null })
				.eq("thread_id", threadId)
				.eq("user_id", userId);
			if (error) throw error;
			return res.status(200).json({ ok: true, hidden });
		} catch (err) {
			console.error("[POST /api/chat/threads/:threadId/hide]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId/messages?limit=&before=
	router.get("/api/chat/threads/:threadId/messages", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		let limit = Number(req.query.limit ?? DEFAULT_PAGE_LIMIT);
		if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_LIMIT;
		limit = Math.min(Math.floor(limit), MAX_PAGE_LIMIT);

		const beforeRaw = req.query.before;
		const beforeDecoded =
			typeof beforeRaw === "string" && beforeRaw.trim() ? decodeCursor(beforeRaw.trim()) : null;
		if (beforeRaw && !beforeDecoded) {
			return res.status(400).json({ error: "Bad request", message: "Invalid before cursor" });
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: rows, error } = await sb.rpc("prsn_chat_messages_page", {
				p_thread_id: threadId,
				p_before_created_at: beforeDecoded ? beforeDecoded.created_at : null,
				p_before_id: beforeDecoded ? beforeDecoded.id : null,
				p_limit: limit + 1
			});
			if (error) throw error;

			const list = Array.isArray(rows) ? rows : [];
			const nowMs = Date.now();
			const expiredIdsToDelete = [];
			for (const m of list) {
				if (!isTimedMessageExpired(m?.meta, nowMs)) continue;
				const parsed = parseTimedMessageMeta(m?.meta);
				const mid = Number(m?.id);
				if (!Number.isFinite(mid) || mid <= 0) continue;
				// Keep private-channel invite rows visible after expiry so both sides can see "expired".
				if (parsed?.kind === TIMED_MESSAGE_KIND_CHANNEL_INVITE) continue;
				expiredIdsToDelete.push(mid);
			}
			if (expiredIdsToDelete.length > 0) {
				const { error: delErr } = await sb.from("prsn_chat_messages").delete().in("id", expiredIdsToDelete);
				if (delErr) throw delErr;
			}
			const visibleList =
				expiredIdsToDelete.length > 0
					? list.filter((m) => !expiredIdsToDelete.includes(Number(m.id)))
					: list;
			const hasMore = visibleList.length > limit;
			const page = hasMore ? visibleList.slice(0, limit) : visibleList;
			page.reverse();

			let messagesOut = await enrichChatMessagesWithSenderProfiles(sb, page);
			messagesOut = messagesOut.map((m) => {
				const parsed = parseTimedMessageMeta(m?.meta);
				if (!parsed || parsed.kind !== TIMED_MESSAGE_KIND_CHANNEL_INVITE) return m;
				if (!isTimedMessageExpired(m?.meta, nowMs)) return m;
				const meta =
					m?.meta && typeof m.meta === "object" && !Array.isArray(m.meta) ? { ...m.meta } : {};
				const ts =
					meta.time_sensitive && typeof meta.time_sensitive === "object" && !Array.isArray(meta.time_sensitive)
						? { ...meta.time_sensitive }
						: null;
				if (!ts) return m;
				ts.expired = true;
				meta.time_sensitive = ts;
				return { ...m, meta };
			});
			messagesOut = await enrichChatReactionsFromMessageColumn(messagesOut, userId, queries);
			const { data: threadRow } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta")
				.eq("id", threadId)
				.maybeSingle();
			const isPrivateChannel =
				threadRow?.type === "channel" &&
				threadVisibilityFromMeta(threadRow?.meta) === PRIVATE_CHANNEL_VISIBILITY;
			if (isPrivateChannel && messagesOut.length > 0) {
				const userMeta = await getUserMeta(sb, userId);
				const keyMap =
					userMeta.chat_private_keys &&
					typeof userMeta.chat_private_keys === "object" &&
					!Array.isArray(userMeta.chat_private_keys)
						? userMeta.chat_private_keys
						: {};
				const keyEntry =
					keyMap[String(Number(threadId))] &&
					typeof keyMap[String(Number(threadId))] === "object"
						? keyMap[String(Number(threadId))]
						: null;
				const secretK = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
				const nextMessages = [];
				for (const m of messagesOut) {
					const body = String(m?.body || "");
					if (!body.startsWith(CHAT_PRIVATE_BODY_PREFIX) || !secretK) {
						nextMessages.push({ ...m, body: "[Encrypted message]" });
						continue;
					}
					const dec = decryptPrivateTextWithSecret(body.slice(CHAT_PRIVATE_BODY_PREFIX.length), secretK);
					if (dec == null) {
						nextMessages.push({ ...m, body: "[Encrypted message]" });
						continue;
					}
					const normalizedDec = await normalizeUnpublishedCreationUrlsInChatBody(
						dec,
						Number(m?.sender_id),
						queries
					);
					nextMessages.push({
						...m,
						body: typeof normalizedDec === "string" && normalizedDec ? normalizedDec : dec,
						private_decrypted: true
					});
				}
				messagesOut = nextMessages;
			}

			messagesOut = await enrichMessagesReplyParentExists(sb, threadId, messagesOut);

			let nextBefore = null;
			if (messagesOut.length > 0) {
				const oldest = messagesOut[0];
				nextBefore = encodeCursor(oldest.created_at, oldest.id);
			}

			return res.status(200).json({
				messages: messagesOut,
				hasMore,
				nextBefore
			});
		} catch (err) {
			console.error("[GET .../messages]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	/**
	 * POST /api/chat/challenges/organize/pins — challenge organizers upsert or clear a timed editorial pin.
	 * Body: { kind: 'open'|'winners'|'topic_vote', challenge_id, created_image_id?, creation_ref?, starts_at?, until?, clear? }
	 */
	router.post("/api/chat/challenges/organize/pins", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const profile =
				typeof queries?.selectUserProfileByUserId?.get === "function"
					? await queries.selectUserProfileByUserId.get(userId)
					: null;
			const viewerUserName =
				typeof profile?.user_name === "string" ? profile.user_name.trim().toLowerCase() : "";
			if (!viewerUserName) {
				return res.status(403).json({ error: "Forbidden", message: "Username required" });
			}

			const challengesTid = await findChallengesChannelThreadId(sb);
			if (!Number.isFinite(Number(challengesTid)) || Number(challengesTid) <= 0) {
				return res.status(404).json({ error: "Not found", message: "Challenges channel missing" });
			}
			const messages = await fetchThreadMessagesChronological(sb, Number(challengesTid));
			const allow = resolveChallengeOrganizerAllowlistFromMessages(messages);
			if (!new Set(allow).has(viewerUserName)) {
				return res.status(403).json({ error: "Forbidden", message: "Not a challenge organizer" });
			}

			const body = req.body && typeof req.body === "object" ? req.body : {};
			const pinKind = normalizeChallengePinKind(body.kind || "open");
			const challengeId = String(body.challenge_id || body.challengeId || "").trim();
			const clear = body.clear === true || body.clear === 1 || body.clear === "1";
			if (!pinKind) {
				return res.status(400).json({
					error: "Bad request",
					message: "kind must be open, winners, or topic_vote"
				});
			}
			if (!challengeId) {
				return res.status(400).json({ error: "Bad request", message: "challenge_id required" });
			}

			if (clear) {
				const removed = await removeChallengeEditorialPin({
					queries,
					kind: pinKind,
					challengeId
				});
				if (!removed.ok) {
					return res.status(400).json({ error: removed.error || "Could not clear pin" });
				}
				invalidateAndRebuildChallengeFeedSnapshotCache();
				return res.status(200).json({ ok: true, removed: removed.removed });
			}

			let createdImageId = Number(body.created_image_id ?? body.createdImageId);
			if (!Number.isFinite(createdImageId) || createdImageId <= 0) {
				const ref = String(body.creation_ref || body.creationRef || "").trim();
				if (ref) {
					createdImageId = parseCreationIdFromChallengeHeroRef(ref);
				}
			}
			if (!Number.isFinite(createdImageId) || createdImageId <= 0) {
				return res.status(400).json({
					error: "Bad request",
					message: "created_image_id required (promo / winners / theme-vote creation)"
				});
			}

			const startsAt =
				typeof body.starts_at === "string"
					? body.starts_at
					: typeof body.startsAt === "string"
						? body.startsAt
						: null;
			const until =
				typeof body.until === "string"
					? body.until
					: typeof body.until_at === "string"
						? body.until_at
						: null;

			const cfg = pickLatestChallengeConfigForChallengeId(
				[...messages].reverse(),
				challengeId
			);
			const challengeTitle = typeof cfg?.title === "string" ? cfg.title.trim() : "";
			const challengeDetails = typeof cfg?.details === "string" ? cfg.details.trim() : "";
			const challengeTrackRaw = String(cfg?.track || cfg?.challenge_track || "")
				.trim()
				.toLowerCase();
			const challengeTrack =
				challengeTrackRaw === "weekly" ||
				challengeTrackRaw === "suno" ||
				challengeTrackRaw === "monthly"
					? challengeTrackRaw
					: "monthly";

			const upserted = await upsertChallengeEditorialPin({
				queries,
				kind: pinKind,
				challengeId,
				createdImageId,
				startsAt,
				until,
				title: challengeTitle,
				details: challengeDetails,
				track: challengeTrack
			});
			if (!upserted.ok) {
				return res.status(400).json({ error: upserted.error || "Could not upsert pin" });
			}

			invalidateAndRebuildChallengeFeedSnapshotCache();
			return res.status(200).json({ ok: true, pin: upserted.pin });
		} catch (err) {
			console.error("[POST /api/chat/challenges/organize/pins]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	/** Config fields written per organizer media role (assign writes the first; clear blanks all aliases the merge respects). */
	const ORGANIZER_ASSIGN_ROLE_FIELDS = {
		hero: [
			"hero_image_url",
			"cover_image_url",
			"image_url",
			"hero_image",
			"hero_media_url",
			"hero_media",
			"hero_ref",
			"hero_url",
			"cover",
			"cover_url",
			"cover_image",
			"image",
			"image_ref",
			"image_path",
			"thumbnail_url",
			"creation_url"
		],
		results: ["results_creation_url", "results_url", "results_highlights_url"],
		topic_vote: [
			"topic_vote_creation_url",
			"theme_vote_creation_url",
			"topic_vote_url",
			"next_theme_creation_url"
		]
	};

	const ORGANIZER_ASSIGN_ROLE_PICKERS = {
		hero: pickChallengeHeroImageUrl,
		results: pickChallengeResultsCreationUrl,
		topic_vote: pickChallengeTopicVoteCreationUrl
	};

	/**
	 * Viewer's organizer context for the challenges channel: tracks they organize plus
	 * per-challenge merged configs (chronological message rows already grouped).
	 */
	async function loadOrganizerAssignContext(sb, queries, userId) {
		const profile =
			typeof queries?.selectUserProfileByUserId?.get === "function"
				? await queries.selectUserProfileByUserId.get(userId)
				: null;
		const viewerUserName =
			typeof profile?.user_name === "string" ? profile.user_name.trim().toLowerCase() : "";
		if (!viewerUserName) return { ok: false, status: 403, message: "Username required" };

		const challengesTid = await findChallengesChannelThreadId(sb);
		if (!Number.isFinite(Number(challengesTid)) || Number(challengesTid) <= 0) {
			return { ok: false, status: 404, message: "Challenges channel missing" };
		}
		const messages = await fetchThreadMessagesChronological(sb, Number(challengesTid));
		const globalCfg = pickLatestChallengesGlobalConfigPayload(messages);
		const byTrack = resolveOrganizersByTrackFromGlobalPayload(globalCfg?.payload);
		const tracks = tracksViewerCanOrganize(viewerUserName, byTrack);

		/** @type {Map<string, { entries: { msg: object, payload: object }[], newestMessageId: number }>} */
		const byChallenge = new Map();
		for (const m of messages) {
			const p = tryParseChallengeJsonBody(m?.body);
			if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
			const cid = String(p.challenge_id || "").trim();
			if (!cid) continue;
			const row = byChallenge.get(cid) || { entries: [], newestMessageId: 0 };
			row.entries.push({ msg: m, payload: p });
			const mid = Number(m?.id);
			if (Number.isFinite(mid) && mid > row.newestMessageId) row.newestMessageId = mid;
			byChallenge.set(cid, row);
		}
		return {
			ok: true,
			viewerUserName,
			threadId: Number(challengesTid),
			byTrack,
			tracks,
			byChallenge
		};
	}

	/**
	 * GET /api/chat/challenges/organize/assignable?creation_id=NNN
	 * Challenges the viewer organizes, with current hero / results / topic_vote assignments,
	 * for the creation-detail organizer panel.
	 * Only eligible for the viewer's own unpublished creations (panel is owner-library only).
	 */
	router.get("/api/chat/challenges/organize/assignable", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const creationId = Number(req.query?.creation_id);
			if (!Number.isFinite(creationId) || creationId <= 0) {
				return res.status(400).json({ error: "Bad request", message: "creation_id required" });
			}
			const creation =
				typeof queries?.selectCreatedImageByIdAnyUser?.get === "function"
					? await queries.selectCreatedImageByIdAnyUser.get(creationId)
					: null;
			if (!creation) {
				return res.status(404).json({ error: "Not found", message: "Creation not found" });
			}
			if (Number(creation.user_id) !== Number(userId)) {
				return res.status(200).json({ ok: true, is_organizer: false, challenges: [] });
			}
			if (creation.published === true || creation.published === 1) {
				return res.status(200).json({ ok: true, is_organizer: false, challenges: [] });
			}

			const ctx = await loadOrganizerAssignContext(sb, queries, userId);
			if (!ctx.ok) {
				if (ctx.status === 403) return res.status(200).json({ ok: true, is_organizer: false, challenges: [] });
				return res.status(ctx.status).json({ error: "Not found", message: ctx.message });
			}
			if (!ctx.tracks.length) {
				return res.status(200).json({ ok: true, is_organizer: false, challenges: [] });
			}

			const now = Date.now();
			const challenges = [];
			for (const [challengeId, row] of ctx.byChallenge.entries()) {
				const merged = mergeFullChallengeConfigForChallenge(row.entries, challengeId);
				if (isChallengeConfigSoftDeleted(merged) || isChallengeConfigPurged(merged)) continue;
				const track = String(merged.track || "monthly").trim().toLowerCase();
				const normalizedTrack = track === "weekly" || track === "suno" ? track : "monthly";
				if (!ctx.tracks.includes(normalizedTrack)) continue;
				const phase = deriveChallengePhase(merged, now);
				// Completed challenges (voting closed) can't take new organizer media assignments.
				if (CHALLENGE_ENDED_PHASES.has(phase)) continue;
				const slots = {};
				for (const role of ["hero", "results", "topic_vote"]) {
					const url = ORGANIZER_ASSIGN_ROLE_PICKERS[role](merged);
					const assignedId = parseCreationIdFromChallengeHeroRef(url);
					slots[role] = {
						url: url || null,
						creation_id: Number.isFinite(assignedId) && assignedId > 0 ? assignedId : null
					};
				}
				challenges.push({
					challenge_id: challengeId,
					title: String(merged.title || "").trim() || challengeId,
					track: normalizedTrack,
					phase,
					accepts_submissions: phase === "submitting" || phase === "submit_and_vote",
					newest_message_id: row.newestMessageId,
					slots
				});
			}
			challenges.sort((a, b) => b.newest_message_id - a.newest_message_id);
			return res.status(200).json({
				ok: true,
				is_organizer: true,
				creation_id: creationId,
				thread_id: ctx.threadId,
				challenges: challenges.slice(0, 12)
			});
		} catch (err) {
			console.error("[GET /api/chat/challenges/organize/assignable]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	/**
	 * POST /api/chat/challenges/organize/assign-creation
	 * Body: { challenge_id, role: 'hero'|'results'|'topic_vote', created_image_id, remove? }
	 * Patches the single challenge_config message (full body) and drops any duplicate rows.
	 */
	router.post("/api/chat/challenges/organize/assign-creation", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		try {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const challengeId = String(body.challenge_id || "").trim();
			const role = String(body.role || "").trim().toLowerCase();
			const createdImageId = Number(body.created_image_id ?? body.createdImageId);
			const remove = body.remove === true;
			if (!challengeId) {
				return res.status(400).json({ error: "Bad request", message: "challenge_id required" });
			}
			if (!ORGANIZER_ASSIGN_ROLE_FIELDS[role]) {
				return res.status(400).json({ error: "Bad request", message: "role must be hero, results, or topic_vote" });
			}
			if (!remove && (!Number.isFinite(createdImageId) || createdImageId <= 0)) {
				return res.status(400).json({ error: "Bad request", message: "created_image_id required" });
			}

			const ctx = await loadOrganizerAssignContext(sb, queries, userId);
			if (!ctx.ok) {
				return res.status(ctx.status).json({ error: "Forbidden", message: ctx.message });
			}
			const row = ctx.byChallenge.get(challengeId);
			if (!row) {
				return res.status(404).json({ error: "Not found", message: "Unknown challenge" });
			}
			const merged = mergeFullChallengeConfigForChallenge(row.entries, challengeId);
			if (isChallengeConfigSoftDeleted(merged) || isChallengeConfigPurged(merged)) {
				return res.status(400).json({ error: "Bad request", message: "Challenge is deleted" });
			}
			const track = String(merged.track || "monthly").trim().toLowerCase();
			const normalizedTrack = track === "weekly" || track === "suno" ? track : "monthly";
			if (!ctx.tracks.includes(normalizedTrack)) {
				return res.status(403).json({ error: "Forbidden", message: "Not an organizer for this challenge type" });
			}
			const phase = deriveChallengePhase(merged, Date.now());
			if (CHALLENGE_ENDED_PHASES.has(phase)) {
				return res.status(400).json({
					error: "Bad request",
					message: "This challenge is complete — organizer media can no longer be changed."
				});
			}

			if (!remove) {
				const creation =
					typeof queries?.selectCreatedImageByIdAnyUser?.get === "function"
						? await queries.selectCreatedImageByIdAnyUser.get(createdImageId)
						: null;
				if (!creation) {
					return res.status(404).json({ error: "Not found", message: "Creation not found" });
				}
				if (Number(creation.user_id) !== Number(userId)) {
					return res.status(403).json({
						error: "Forbidden",
						message: "You can only assign your own creations as organizer media."
					});
				}
				if (creation.published === true || creation.published === 1) {
					return res.status(400).json({
						error: "Bad request",
						message: "Published creations can't be assigned as organizer media."
					});
				}
				const creationMeta = parseMeta(creation.meta);
				if (groupActionSupportedForMeta(creationMeta, "challenge_assign") === false) {
					return res.status(400).json({
						error: "Bad request",
						message: "This creation cannot be assigned as challenge media.",
					});
				}
				const isEntry =
					Array.isArray(creationMeta?.challenge_submissions) &&
					creationMeta.challenge_submissions.length > 0;
				if (isEntry) {
					return res.status(400).json({
						error: "Bad request",
						message: "This creation is a challenge entry and can't double as organizer media."
					});
				}
			}

			// Assign writes the canonical field; remove blanks every alias the merged picker reads.
			const fields = ORGANIZER_ASSIGN_ROLE_FIELDS[role];
			/** @type {Record<string, string>} */
			const patch = {};
			if (remove) {
				for (const f of fields) patch[f] = "";
			} else {
				patch[fields[0]] = `/creations/${createdImageId}`;
				for (const f of fields.slice(1)) patch[f] = "";
			}

			const persisted = await persistSingleChallengeConfigMessage({
				sb,
				threadId: ctx.threadId,
				challengeId,
				messageIds: row.entries.map((e) => e?.msg?.id),
				merged,
				patch
			});
			void broadcastRoomDirty(ctx.threadId, persisted.messageId);

			invalidateAndRebuildChallengeFeedSnapshotCache();
			try {
				await syncChallengeOrganizerCreationRefsOnConfigWrite({
					queries,
					sb,
					storage,
					prevPayload: merged,
					nextPayload: persisted.payload
				});
			} catch (syncErr) {
				console.warn("[assign-creation] organizer ref sync", syncErr?.message || syncErr);
			}

			// Keep editorial pins aligned with assign/remove (organize form does this via pin sync ops).
			const pinKind = ORGANIZER_ROLE_TO_PIN_KIND[role];
			if (pinKind) {
				try {
					if (remove) {
						await removeChallengeEditorialPin({ queries, kind: pinKind, challengeId });
					} else {
						const pick = ORGANIZER_ASSIGN_ROLE_PICKERS[role];
						const prevCreationId = pick ? parseCreationIdFromChallengeHeroRef(pick(merged)) : NaN;
						const doc = await loadEditorialPinPolicyDocument(queries);
						const pinId = `challenge-${pinKind}-${challengeId}`;
						const existing = (doc.pins || []).find((p) => String(p?.id || "") === pinId);
						if (existing && Number(existing.created_image_id) !== createdImageId) {
							const title =
								typeof persisted.payload?.title === "string"
									? persisted.payload.title.trim()
									: typeof merged.title === "string"
										? merged.title.trim()
										: "";
							const details =
								typeof persisted.payload?.details === "string"
									? persisted.payload.details.trim()
									: typeof merged.details === "string"
										? merged.details.trim()
										: "";
							const trackRaw = String(
								persisted.payload?.track || merged.track || merged.challenge_track || ""
							)
								.trim()
								.toLowerCase();
							const track =
								trackRaw === "weekly" || trackRaw === "suno" || trackRaw === "monthly"
									? trackRaw
									: "monthly";
							await upsertChallengeEditorialPin({
								queries,
								kind: pinKind,
								challengeId,
								createdImageId,
								startsAt: existing.starts_at,
								until: existing.until,
								title,
								details,
								track
							});
						} else if (
							!existing &&
							Number.isFinite(prevCreationId) &&
							prevCreationId > 0 &&
							prevCreationId !== createdImageId
						) {
							// No pin to retarget; ref swap alone is enough.
						}
					}
				} catch (pinErr) {
					console.warn("[assign-creation] pin sync", pinErr?.message || pinErr);
				}
			}

			return res.status(200).json({
				ok: true,
				challenge_id: challengeId,
				role,
				created_image_id: remove ? null : createdImageId,
				config_message_id: persisted.messageId,
				deleted_duplicate_ids: persisted.deletedIds
			});
		} catch (err) {
			console.error("[POST /api/chat/challenges/organize/assign-creation]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId/challenges/:challengeId/stats
	router.get("/api/chat/threads/:threadId/challenges/:challengeId/stats", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}
		const challengeId = String(req.params.challengeId || "").trim();
		if (!challengeId) {
			return res.status(400).json({ error: "Bad request", message: "Invalid challenge id" });
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: rows, error } = await sb
				.from("prsn_chat_messages")
				.select("id, sender_id, body, reactions, created_at")
				.eq("thread_id", threadId)
				.order("created_at", { ascending: true })
				.order("id", { ascending: true });
			if (error) throw error;

			const globalAverage = getCachedChallengeThreadGlobalAverage(threadId, rows);

			const topCandidates = [];
			const votesPerUserId = new Map();
			const submissionsPerSenderId = new Map();
			for (const msg of Array.isArray(rows) ? rows : []) {
				const payload = tryParseChallengeJsonBody(msg?.body);
				if (!payload || String(payload.kind || "").trim() !== "challenge_submission") {
					continue;
				}
				const cid = payload.challenge_id != null ? String(payload.challenge_id).trim() : "";
				if (cid !== challengeId) continue;

				const senderId = msg.sender_id != null ? Number(msg.sender_id) : NaN;
				if (Number.isFinite(senderId) && senderId > 0) {
					submissionsPerSenderId.set(
						senderId,
						(submissionsPerSenderId.get(senderId) || 0) + 1
					);
				}

				const creationId =
					payload.created_image_id != null ? Number(payload.created_image_id) : NaN;
				const creationIdSafe =
					Number.isFinite(creationId) && creationId > 0 ? Math.floor(creationId) : null;
				const reactions =
					msg?.reactions && typeof msg.reactions === "object" && !Array.isArray(msg.reactions)
						? msg.reactions
						: {};

				let voteValue = 0;
				let voteCount = 0;
				for (let i = 0; i < CHALLENGE_SCORE_REACTION_KEYS.length; i += 1) {
					const key = CHALLENGE_SCORE_REACTION_KEYS[i];
					const weight = i + 1;
					const ids = Array.isArray(reactions[key]) ? reactions[key] : [];
					for (const rawUid of ids) {
						const uid = Number(rawUid);
						if (!Number.isFinite(uid) || uid <= 0) continue;
						voteCount += 1;
						voteValue += weight;
						votesPerUserId.set(uid, (votesPerUserId.get(uid) || 0) + 1);
					}
				}

				topCandidates.push({
					creationId: creationIdSafe,
					creatorUserId:
						Number.isFinite(senderId) && senderId > 0 ? Math.floor(senderId) : null,
					voteValue,
					voteCount,
					sortId: Number.isFinite(Number(msg?.id)) ? Number(msg.id) : 0
				});
			}

			topCandidates.sort((a, b) => {
				if (b.voteValue !== a.voteValue) return b.voteValue - a.voteValue;
				if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
				return a.sortId - b.sortId;
			});

			const voterLeaderboard = [...votesPerUserId.entries()]
				.map(([uid, n]) => ({ userId: uid, voteCount: n }))
				.sort((a, b) => {
					if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
					return a.userId - b.userId;
				});

			const submitterLeaderboard = [...submissionsPerSenderId.entries()]
				.map(([uid, n]) => ({ userId: uid, submissionCount: n }))
				.sort((a, b) => {
					if (b.submissionCount !== a.submissionCount) {
						return b.submissionCount - a.submissionCount;
					}
					return a.userId - b.userId;
				});

			const profileIds = [
				...new Set([
					...voterLeaderboard.map((r) => r.userId),
					...submitterLeaderboard.map((r) => r.userId),
					...topCandidates
						.map((r) => r.creatorUserId)
						.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)
				])
			];
			/** @type {Map<number, object>} */
			let profileMap = new Map();
			if (profileIds.length > 0 && typeof queries.selectUserProfilesByUserIds === "function") {
				try {
					const fetched = await queries.selectUserProfilesByUserIds(profileIds);
					profileMap = fetched instanceof Map ? fetched : new Map();
				} catch {
					profileMap = new Map();
				}
			}

			const userNameFromProfileMap = (uid) => {
				const p = profileMap.get(uid);
				return p && typeof p.user_name === "string" ? String(p.user_name).trim() : "";
			};

			const topVoters = voterLeaderboard.map((row) => ({
				userId: row.userId,
				voteCount: row.voteCount,
				userName: userNameFromProfileMap(row.userId) || null
			}));

			const topSubmitters = submitterLeaderboard.map((row) => ({
				userId: row.userId,
				submissionCount: row.submissionCount,
				userName: userNameFromProfileMap(row.userId) || null
			}));

			const topCreations = topCandidates.map((row) => {
				const cuid =
					row.creatorUserId != null &&
					Number.isFinite(Number(row.creatorUserId)) &&
					Number(row.creatorUserId) > 0
						? Math.floor(Number(row.creatorUserId))
						: null;
				return {
					creationId: row.creationId,
					messageId:
						Number.isFinite(Number(row.sortId)) && Number(row.sortId) > 0
							? Math.floor(Number(row.sortId))
							: null,
					voteValue: row.voteValue,
					voteCount: row.voteCount,
					creatorUserId: cuid,
					creatorUserName: cuid != null ? userNameFromProfileMap(cuid) || null : null
				};
			});

			return res.status(200).json({
				ok: true,
				challengeId,
				globalAverage,
				topCreations,
				topSubmitters,
				topVoters
			});
		} catch (err) {
			console.error("[GET /api/chat/threads/:threadId/challenges/:challengeId/stats]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/messages  { body }
	router.post("/api/chat/threads/:threadId/messages", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		const bodyRaw = req.body?.body;
		let body =
			typeof bodyRaw === "string"
				? bodyRaw.replace(/\u0000/g, "").trim()
				: "";
		if (!body) {
			return res.status(400).json({ error: "Bad request", message: "body required" });
		}
		// Absolute ceiling before we know the thread; refined after load for challenge configs.
		if (body.length > MAX_MACHINE_CHANNEL_MESSAGE_CHARS) {
			return res.status(400).json({
				error: "Bad request",
				message: `body must be at most ${MAX_MACHINE_CHANNEL_MESSAGE_CHARS} characters`
			});
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: threadRow, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta, channel_slug")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!threadRow) {
				return res.status(404).json({ error: "Not found", message: "Thread not found" });
			}
			const maxBodyChars = maxChatMessageBodyChars(threadRow, body, tryParseChallengeJsonBody);
			if (body.length > maxBodyChars) {
				return res.status(400).json({
					error: "Bad request",
					message: `body must be at most ${maxBodyChars} characters`
				});
			}
			if (
				threadRow.type === "channel" &&
				threadVisibilityFromMeta(threadRow.meta) === PRIVATE_CHANNEL_VISIBILITY &&
				!String(body || "").startsWith(CHAT_PRIVATE_BODY_PREFIX)
			) {
				return res.status(400).json({
					error: "Bad request",
					message: "Private channel messages must be encrypted"
				});
			}
			const globalConfigBodyResult = await validateAndNormalizeChallengesGlobalConfigBody(
				sb,
				threadRow,
				body,
				userId
			);
			if (!globalConfigBodyResult.ok) {
				const status = globalConfigBodyResult.status || 400;
				return res.status(status).json({
					error: status === 403 ? "Forbidden" : "Bad request",
					message: globalConfigBodyResult.message || "Invalid challenges global config"
				});
			}
			body = globalConfigBodyResult.body;

			const challengeTrackResult = await validateChallengeConfigOrganizerTrack(
				sb,
				threadRow,
				userId,
				body,
				null
			);
			if (!challengeTrackResult.ok) {
				return res.status(challengeTrackResult.status || 403).json({
					error: "Forbidden",
					message: challengeTrackResult.message || "Not allowed for this challenge type"
				});
			}
			body = challengeTrackResult.body;

			body = await normalizeBodyForThreadStorage(sb, threadRow, userId, body);
			{
				const maxBodyChars = maxChatMessageBodyChars(threadRow, body, tryParseChallengeJsonBody);
				if (body.length > maxBodyChars) {
					return res.status(400).json({
						error: "Bad request",
						message: `body must be at most ${maxBodyChars} characters`
					});
				}
			}

			// One challenge_config message per challenge_id — reject appends; clients must PATCH.
			// #challenges is not a human announce surface — reject challenge_announce.
			{
				const posted = tryParseChallengeJsonBody(body);
				const postedKind = String(posted?.kind || "").trim();
				const isChallengesThread =
					threadRow.type === "channel" &&
					String(threadRow.channel_slug || "").trim().toLowerCase() === "challenges";
				if (isChallengesThread && postedKind === "challenge_announce") {
					return res.status(400).json({
						error: "Bad request",
						message:
							"challenge_announce is not used in #challenges. Use the Announce tab / feed pins instead."
					});
				}
				if (isChallengesThread && postedKind === "challenge_config") {
					const newCid = String(posted?.challenge_id || "").trim();
					if (newCid) {
						const existing = await fetchThreadMessagesChronological(sb, threadId);
						const hit = existing.find((m) => {
							const p = tryParseChallengeJsonBody(m?.body);
							return (
								p &&
								String(p.kind || "").trim() === "challenge_config" &&
								String(p.challenge_id || "").trim() === newCid
							);
						});
						if (hit) {
							return res.status(409).json({
								error: "Conflict",
								message:
									"A challenge_config message already exists for this challenge_id. Update that message instead of posting another.",
								config_message_id: Number(hit.id) || null
							});
						}
					}
				}
			}

			const refRaw = req.body?.referenced_message_id;
			let referencedMid = Number.parseInt(String(refRaw ?? ""), 10);
			if (refRaw == null || String(refRaw).trim() === "") {
				referencedMid = NaN;
			}
			let metaIns = {};

			if (Number.isFinite(referencedMid) && referencedMid > 0) {
				const { data: parentMsg, error: parErr } = await sb
					.from("prsn_chat_messages")
					.select("id, thread_id, sender_id, body, meta")
					.eq("id", referencedMid)
					.maybeSingle();
				if (parErr) throw parErr;
				const ptid = Number(parentMsg?.thread_id);
				if (!parentMsg || !Number.isFinite(ptid) || ptid !== threadId) {
					return res.status(400).json({ error: "Bad request", message: "Invalid referenced message" });
				}
				const clientPrev = sanitizeClientReplyPreview(req.body?.reply_preview);
				const stamped = await composeChatStampedReply(sb, referencedMid, parentMsg, clientPrev);
				metaIns = { reply: stamped };
			}

			const ins = await sb
				.from("prsn_chat_messages")
				.insert({ thread_id: threadId, sender_id: userId, body, meta: metaIns })
				.select("id, thread_id, sender_id, body, created_at, meta, reactions")
				.single();

			if (ins.error) throw ins.error;

			if (ins.data?.id != null) {
				const newId = Number(ins.data.id);
				if (Number.isFinite(newId) && newId > 0) {
					const { error: readErr } = await sb
						.from("prsn_chat_members")
						.update({ last_read_message_id: newId })
						.eq("thread_id", threadId)
						.eq("user_id", userId);
					if (readErr) throw readErr;
				}
				void broadcastRoomDirty(threadId, ins.data.id);
				const [memRes, threadRes] = await Promise.all([
					sb.from("prsn_chat_members").select("user_id").eq("thread_id", threadId),
					sb.from("prsn_chat_threads").select("type, channel_slug, dm_pair_key").eq("id", threadId).maybeSingle()
				]);
				const uids = Array.isArray(memRes.data) ? memRes.data.map((r) => r.user_id) : [];
				void broadcastUserInboxDirty(threadId, uids);
				void insertNotificationsForChatMentions({
					queries,
					memberUserIds: uids,
					threadId,
					threadType: threadRes.data?.type,
					channelSlug: threadRes.data?.channel_slug,
					dmPairKey: threadRes.data?.dm_pair_key,
					senderId: userId,
					body
				});
			}

			let messageOut = ins.data;
			const enrichedNew = await enrichChatMessagesWithSenderProfiles(sb, [messageOut]);
			messageOut = enrichedNew[0] || messageOut;
			messageOut = (await enrichChatReactionsFromMessageColumn([messageOut], userId, queries))[0];
			if (messageOut?.meta?.reply) {
				messageOut = { ...messageOut, reply_parent_exists: true };
			}

			const postedKind = String(tryParseChallengeJsonBody(body)?.kind || "").trim();
			if (
				threadRow.type === "channel" &&
				String(threadRow.channel_slug || "").trim().toLowerCase() === "challenges" &&
				(postedKind === "challenge_config" || postedKind === "challenges_global_config")
			) {
				invalidateAndRebuildChallengeFeedSnapshotCache();
			}
			if (
				threadRow.type === "channel" &&
				String(threadRow.channel_slug || "").trim().toLowerCase() === "challenges" &&
				postedKind === "challenge_config"
			) {
				try {
					await syncChallengeOrganizerCreationRefsOnConfigWrite({
						queries,
						sb,
						storage,
						prevPayload: null,
						nextPayload: tryParseChallengeJsonBody(body)
					});
				} catch (err) {
					console.warn("[POST .../messages] organizer ref sync", err?.message || err);
				}
			}

			return res.status(201).json({ message: messageOut });
		} catch (err) {
			console.error("[POST .../messages]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/chat/threads/:threadId/canvases — channel threads: messages with meta.canvas (pinned canvas list)
	router.get("/api/chat/threads/:threadId/canvases", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(200).json({ canvases: [], pinned_message_id: null });
			}

			const { data: rows, error } = await sb
				.from("prsn_chat_messages")
				.select("id, sender_id, body, created_at, meta")
				.eq("thread_id", threadId)
				.contains("meta", { canvas: {} })
				.order("id", { ascending: true })
				.limit(200);
			if (error) throw error;

			const enrichedRows = await enrichChatMessagesWithSenderProfiles(
				sb,
				Array.isArray(rows) ? rows : []
			);
			const isPrivateChannel =
				thread.type === "channel" &&
				threadVisibilityFromMeta(thread.meta) === PRIVATE_CHANNEL_VISIBILITY;
			let privateSecretK = "";
			if (isPrivateChannel) {
				const userMeta = await getUserMeta(sb, userId);
				const keyMap =
					userMeta.chat_private_keys &&
					typeof userMeta.chat_private_keys === "object" &&
					!Array.isArray(userMeta.chat_private_keys)
						? userMeta.chat_private_keys
						: {};
				const keyEntry =
					keyMap[String(Number(threadId))] &&
					typeof keyMap[String(Number(threadId))] === "object"
						? keyMap[String(Number(threadId))]
						: null;
				privateSecretK = typeof keyEntry?.k === "string" ? keyEntry.k.trim() : "";
			}

			const canvases = [];
			for (const row of enrichedRows) {
				if (!isCanvasMessageRow(row)) continue;
				const title = String(row.meta?.canvas?.title || "").trim();
				let body = row.body != null ? String(row.body) : "";
				if (isPrivateChannel) {
					if (!body.startsWith(CHAT_PRIVATE_BODY_PREFIX) || !privateSecretK) {
						body = "[Encrypted message]";
					} else {
						const dec = decryptPrivateTextWithSecret(body.slice(CHAT_PRIVATE_BODY_PREFIX.length), privateSecretK);
						if (dec == null) {
							body = "[Encrypted message]";
						} else {
							const normalizedDec = await normalizeUnpublishedCreationUrlsInChatBody(
								dec,
								Number(row?.sender_id),
								queries
							);
							body = typeof normalizedDec === "string" && normalizedDec ? normalizedDec : dec;
						}
					}
				}
				const entry = {
					id: Number(row.id),
					sender_id: Number(row.sender_id),
					sender_user_name:
						typeof row.sender_user_name === "string" && row.sender_user_name.trim()
							? row.sender_user_name.trim()
							: null,
					title,
					body,
					created_at: row.created_at
				};
				const body_html = canvasBodyMarkdownToSafeHtml(body);
				if (body_html) entry.body_html = body_html;
				canvases.push(entry);
			}
			const pinned_message_id = getPinnedCanvasMessageIdFromThreadRow(thread);
			return res.status(200).json({ canvases, pinned_message_id });
		} catch (err) {
			console.error("[GET .../canvases]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/pinned-canvas  { message_id } | { message_id: null } — channel only; pin only canvas author; unpin author of pinned or admin
	router.post("/api/chat/threads/:threadId/pinned-canvas", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		const rawMid = req.body?.message_id ?? req.body?.messageId;
		const clearPin = rawMid == null || rawMid === "" || rawMid === false;
		const messageId = clearPin ? null : Number(rawMid);

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(400).json({ error: "Bad request", message: "Pinned canvas is only for channels" });
			}

			if (clearPin || !Number.isFinite(messageId) || messageId <= 0) {
				const cur = getPinnedCanvasMessageIdFromThreadRow(thread);
				if (cur == null || !Number.isFinite(cur) || cur <= 0) {
					return res.status(200).json({ ok: true, pinned_message_id: null });
				}
				const { data: pinnedMsg, error: pmErr } = await sb
					.from("prsn_chat_messages")
					.select("sender_id")
					.eq("id", cur)
					.maybeSingle();
				if (pmErr) throw pmErr;
				const sender = pinnedMsg?.sender_id != null ? Number(pinnedMsg.sender_id) : null;
				const isAdmin = await viewerIsAdminRole(userId);
				if (!isAdmin && (!Number.isFinite(sender) || sender !== Number(userId))) {
					return res.status(403).json({
						error: "Forbidden",
						message: "Only the pinned canvas author (or admin) can remove the channel pin"
					});
				}
				const nextMeta = buildThreadMetaWithPinnedCanvasId(thread.meta, null);
				const { error: upErr } = await sb
					.from("prsn_chat_threads")
					.update({ meta: nextMeta })
					.eq("id", threadId);
				if (upErr) throw upErr;
				void broadcastRoomDirty(threadId, 0);
				return res.status(200).json({ ok: true, pinned_message_id: null });
			}

			const { data: msg, error: msgErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, sender_id, body, meta")
				.eq("id", messageId)
				.maybeSingle();
			if (msgErr) throw msgErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found" });
			}
			if (Number(msg.thread_id) !== threadId) {
				return res.status(400).json({ error: "Bad request", message: "Message is not in this thread" });
			}
			if (!isCanvasMessageRow(msg)) {
				return res.status(400).json({ error: "Bad request", message: "Only a canvas can be pinned" });
			}
			if (Number(msg.sender_id) !== Number(userId)) {
				return res.status(403).json({ error: "Forbidden", message: "You can only pin your own canvas" });
			}

			const nextMeta = buildThreadMetaWithPinnedCanvasId(thread.meta, messageId);
			const { error: upErr } = await sb.from("prsn_chat_threads").update({ meta: nextMeta }).eq("id", threadId);
			if (upErr) throw upErr;
			void broadcastRoomDirty(threadId, messageId);
			return res.status(200).json({ ok: true, pinned_message_id: messageId });
		} catch (err) {
			console.error("[POST .../pinned-canvas]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/pinned-message  { message_id } | { message_id: null }
	// Channel only; one pin per channel; oceanman + admins
	router.post("/api/chat/threads/:threadId/pinned-message", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		const rawMid = req.body?.message_id ?? req.body?.messageId;
		const clearPin = rawMid == null || rawMid === "" || rawMid === false;
		const messageId = clearPin ? null : Number(rawMid);

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			if (!(await viewerCanPinChannelMessages(userId))) {
				return res.status(403).json({
					error: "Forbidden",
					message: "You cannot pin messages in this channel"
				});
			}

			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(400).json({ error: "Bad request", message: "Message pin is only for channels" });
			}

			if (clearPin || !Number.isFinite(messageId) || messageId <= 0) {
				const cur = getChannelPinnedMessageIdFromThreadRow(thread);
				if (cur == null || !Number.isFinite(cur) || cur <= 0) {
					return res.status(200).json({ ok: true, pinned_message_id: null, pinned_message: null });
				}
				const nextMeta = buildThreadMetaWithChannelPin(thread.meta, null);
				const { error: upErr } = await sb
					.from("prsn_chat_threads")
					.update({ meta: nextMeta })
					.eq("id", threadId);
				if (upErr) throw upErr;
				void broadcastRoomDirty(threadId, 0);
				return res.status(200).json({ ok: true, pinned_message_id: null, pinned_message: null });
			}

			const { data: msg, error: msgErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, sender_id, body, reactions, meta, created_at")
				.eq("id", messageId)
				.maybeSingle();
			if (msgErr) throw msgErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found" });
			}
			if (Number(msg.thread_id) !== threadId) {
				return res.status(400).json({ error: "Bad request", message: "Message is not in this thread" });
			}
			if (isSystemEventMessageRow(msg)) {
				return res.status(400).json({ error: "Bad request", message: "System messages cannot be pinned" });
			}

			const nextMeta = buildThreadMetaWithChannelPin(thread.meta, messageId, userId);
			const { error: upErr } = await sb.from("prsn_chat_threads").update({ meta: nextMeta }).eq("id", threadId);
			if (upErr) throw upErr;
			void broadcastRoomDirty(threadId, messageId);

			const enriched = await enrichChatMessagesWithSenderProfiles(sb, [msg]);
			const pinned_message = (
				await enrichChatReactionsFromMessageColumn([enriched[0] || msg], userId, queries)
			)[0];
			return res.status(200).json({ ok: true, pinned_message_id: messageId, pinned_message });
		} catch (err) {
			console.error("[POST .../pinned-message]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/threads/:threadId/canvases — founder plan only; real hashtag channel threads only
	router.post("/api/chat/threads/:threadId/canvases", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
		}

		const titleRaw = req.body?.title;
		const bodyRaw = req.body?.body;
		let title = typeof titleRaw === "string" ? titleRaw.replace(/\u0000/g, "").trim() : "";
		let body =
			typeof bodyRaw === "string" ? bodyRaw.replace(/\u0000/g, "").trim() : "";
		if (!title || !body) {
			return res.status(400).json({ error: "Bad request", message: "title and body required" });
		}
		if (title.length > MAX_CANVAS_TITLE_CHARS) {
			return res.status(400).json({
				error: "Bad request",
				message: `title must be at most ${MAX_CANVAS_TITLE_CHARS} characters`
			});
		}
		if (body.length > MAX_MESSAGE_CHARS) {
			return res.status(400).json({
				error: "Bad request",
				message: `body must be at most ${MAX_MESSAGE_CHARS} characters`
			});
		}

		try {
			if (!(await viewerIsFounderPlan(userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Founder plan required" });
			}

			const { data: thread, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("type, channel_slug")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!thread || thread.type !== "channel") {
				return res.status(403).json({ error: "Forbidden", message: "Canvases are only for channel threads" });
			}
			const slug = thread.channel_slug != null ? String(thread.channel_slug).trim().toLowerCase() : "";
			if (!slug || CANVAS_DISALLOWED_CHANNEL_SLUGS.has(slug)) {
				return res.status(403).json({ error: "Forbidden", message: "Canvases cannot be created in this channel" });
			}

			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			body = await normalizeUnpublishedCreationUrlsInChatBody(body, userId, queries);
			if (body.length > MAX_MESSAGE_CHARS) {
				return res.status(400).json({
					error: "Bad request",
					message: `body must be at most ${MAX_MESSAGE_CHARS} characters`
				});
			}

			const ins = await sb
				.from("prsn_chat_messages")
				.insert({
					thread_id: threadId,
					sender_id: userId,
					body,
					meta: { canvas: { title } },
					reactions: {}
				})
				.select("id, thread_id, sender_id, body, created_at, meta, reactions")
				.single();

			if (ins.error) throw ins.error;

			if (ins.data?.id != null) {
				const newId = Number(ins.data.id);
				if (Number.isFinite(newId) && newId > 0) {
					const { error: readErr } = await sb
						.from("prsn_chat_members")
						.update({ last_read_message_id: newId })
						.eq("thread_id", threadId)
						.eq("user_id", userId);
					if (readErr) throw readErr;
				}
				void broadcastRoomDirty(threadId, ins.data.id);
				const [memRes, threadRes] = await Promise.all([
					sb.from("prsn_chat_members").select("user_id").eq("thread_id", threadId),
					sb.from("prsn_chat_threads").select("type, channel_slug, dm_pair_key").eq("id", threadId).maybeSingle()
				]);
				const uids = Array.isArray(memRes.data) ? memRes.data.map((r) => r.user_id) : [];
				void broadcastUserInboxDirty(threadId, uids);
				void insertNotificationsForChatMentions({
					queries,
					memberUserIds: uids,
					threadId,
					threadType: threadRes.data?.type,
					channelSlug: threadRes.data?.channel_slug,
					dmPairKey: threadRes.data?.dm_pair_key,
					senderId: userId,
					body
				});
			}

			let messageOut = ins.data;
			const enriched = await enrichChatMessagesWithSenderProfiles(sb, [messageOut]);
			messageOut = enriched[0] || messageOut;
			messageOut = (await enrichChatReactionsFromMessageColumn([messageOut], userId, queries))[0];

			return res.status(201).json({ message: messageOut });
		} catch (err) {
			console.error("[POST .../canvases]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// PATCH /api/chat/messages/:messageId — update message body (sender/admin); optional canvas title for canvas messages
	router.patch("/api/chat/messages/:messageId", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const messageId = Number(req.params.messageId);
		if (!Number.isFinite(messageId) || messageId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid message id" });
		}

		const titleIn = req.body?.title;
		const bodyIn = req.body?.body;
		const hasTitle = titleIn !== undefined && titleIn !== null;
		const hasBody = bodyIn !== undefined && bodyIn !== null;
		if (!hasTitle && !hasBody) {
			return res.status(400).json({ error: "Bad request", message: "title or body required" });
		}

		try {
			const { data: msg, error: selErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, sender_id, body, meta, reactions")
				.eq("id", messageId)
				.maybeSingle();
			if (selErr) throw selErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found" });
			}
			const isCanvas = isCanvasMessageRow(msg);
			if (!isCanvas && hasTitle) {
				return res.status(400).json({
					error: "Bad request",
					message: "title can only be edited for canvas messages"
				});
			}

			const threadId = Number(msg.thread_id);
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}
			const { data: threadRow, error: thErr } = await sb
				.from("prsn_chat_threads")
				.select("id, type, meta, channel_slug")
				.eq("id", threadId)
				.maybeSingle();
			if (thErr) throw thErr;
			if (!threadRow) {
				return res.status(404).json({ error: "Not found", message: "Thread not found" });
			}

			const senderId = Number(msg.sender_id);
			const isSender = Number.isFinite(senderId) && senderId === Number(userId);
			const isAdmin = await viewerIsAdminRole(userId);
			const payload = tryParseChallengeJsonBody(msg?.body);
			const payloadKind = String(payload?.kind || "").trim();
			const isChallengesThread =
				threadRow?.type === "channel" &&
				String(threadRow?.channel_slug || "").trim().toLowerCase() === "challenges";
			const isChallengeConfigMessage =
				payloadKind === "challenge_config" || payloadKind === "challenges_global_config";
			let isChallengeOrganizer = false;
			if (isChallengesThread && isChallengeConfigMessage) {
				const challengeRows = await fetchThreadMessagesChronological(sb, threadId);
				const allowlist = resolveChallengeOrganizerAllowlistFromMessages(
					Array.isArray(challengeRows) ? challengeRows : []
				);
				const viewerProfile =
					typeof queries?.selectUserProfileByUserId?.get === "function"
						? await queries.selectUserProfileByUserId.get(userId).catch(() => null)
						: null;
				const viewerUserName =
					typeof viewerProfile?.user_name === "string"
						? viewerProfile.user_name.trim().toLowerCase()
						: "";
				isChallengeOrganizer = Boolean(viewerUserName) && allowlist.includes(viewerUserName);
			}
			if (!isSender && !isAdmin && !(isChallengesThread && isChallengeConfigMessage && isChallengeOrganizer)) {
				return res.status(403).json({ error: "Forbidden", message: "You can only edit your own messages" });
			}

			const prevMeta =
				msg.meta && typeof msg.meta === "object" && !Array.isArray(msg.meta) ? { ...msg.meta } : {};
			const prevCanvas =
				prevMeta.canvas && typeof prevMeta.canvas === "object" && !Array.isArray(prevMeta.canvas)
					? { ...prevMeta.canvas }
					: {};
			let newTitle = typeof prevCanvas.title === "string" ? prevCanvas.title.trim() : "";
			let newBody = msg.body != null ? String(msg.body) : "";

			if (hasTitle) {
				const t = typeof titleIn === "string" ? titleIn.replace(/\u0000/g, "").trim() : "";
				if (!t) {
					return res.status(400).json({ error: "Bad request", message: "title must be non-empty" });
				}
				if (t.length > MAX_CANVAS_TITLE_CHARS) {
					return res.status(400).json({
						error: "Bad request",
						message: `title must be at most ${MAX_CANVAS_TITLE_CHARS} characters`
					});
				}
				newTitle = t;
			}
			if (hasBody) {
				const b = typeof bodyIn === "string" ? bodyIn.replace(/\u0000/g, "").trim() : "";
				if (!b) {
					return res.status(400).json({ error: "Bad request", message: "body must be non-empty" });
				}
				{
					const maxBodyChars = maxChatMessageBodyChars(
						threadRow,
						b,
						tryParseChallengeJsonBody
					);
					if (b.length > maxBodyChars) {
						return res.status(400).json({
							error: "Bad request",
							message: `body must be at most ${maxBodyChars} characters`
						});
					}
				}
				if (
					threadRow.type === "channel" &&
					threadVisibilityFromMeta(threadRow.meta) === PRIVATE_CHANNEL_VISIBILITY &&
					!String(b).startsWith(CHAT_PRIVATE_BODY_PREFIX)
				) {
					return res.status(400).json({
						error: "Bad request",
						message: "Private channel messages must be encrypted"
					});
				}
				const globalConfigBodyResult = await validateAndNormalizeChallengesGlobalConfigBody(
					sb,
					threadRow,
					b,
					userId
				);
				if (!globalConfigBodyResult.ok) {
					const status = globalConfigBodyResult.status || 400;
					return res.status(status).json({
						error: status === 403 ? "Forbidden" : "Bad request",
						message: globalConfigBodyResult.message || "Invalid challenges global config"
					});
				}
				const challengeTrackResult = await validateChallengeConfigOrganizerTrack(
					sb,
					threadRow,
					userId,
					globalConfigBodyResult.body,
					msg.body != null ? String(msg.body) : null
				);
				if (!challengeTrackResult.ok) {
					return res.status(challengeTrackResult.status || 403).json({
						error: "Forbidden",
						message:
							challengeTrackResult.message || "Not allowed for this challenge type"
					});
				}
				newBody = await normalizeBodyForThreadStorage(
					sb,
					threadRow,
					userId,
					challengeTrackResult.body
				);
				{
					const maxBodyChars = maxChatMessageBodyChars(
						threadRow,
						newBody,
						tryParseChallengeJsonBody
					);
					if (newBody.length > maxBodyChars) {
						return res.status(400).json({
							error: "Bad request",
							message: `body must be at most ${maxBodyChars} characters`
						});
					}
				}
			}

			const editedAt = new Date().toISOString();
			const meta = {
				...prevMeta,
				edited_at: editedAt,
				edited_by_user_id: Number(userId)
			};
			if (isCanvas) {
				meta.canvas = {
					...prevCanvas,
					title: newTitle
				};
			}

			const { error: upErr } = await sb
				.from("prsn_chat_messages")
				.update({ body: newBody, meta })
				.eq("id", messageId);
			if (upErr) throw upErr;

			void broadcastRoomDirty(threadId, messageId);
			const mem = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", threadId);
			const uids = Array.isArray(mem.data) ? mem.data.map((r) => r.user_id) : [];
			void broadcastUserInboxDirty(threadId, uids);

			const { data: fresh, error: frErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, sender_id, body, created_at, meta, reactions")
				.eq("id", messageId)
				.maybeSingle();
			if (frErr) throw frErr;
			let out = fresh;
			const enriched = await enrichChatMessagesWithSenderProfiles(sb, [out]);
			out = enriched[0] || out;
			out = (await enrichChatReactionsFromMessageColumn([out], userId, queries))[0];

			const withExist = await enrichMessagesReplyParentExists(sb, threadId, [out]);
			out = withExist[0] || out;

			const patchedKind = String(tryParseChallengeJsonBody(newBody)?.kind || "").trim();
			if (
				isChallengesThread &&
				(patchedKind === "challenge_config" || patchedKind === "challenges_global_config")
			) {
				invalidateAndRebuildChallengeFeedSnapshotCache();
			}
			if (isChallengesThread && patchedKind === "challenge_config") {
				try {
					await syncChallengeOrganizerCreationRefsOnConfigWrite({
						queries,
						sb,
						storage,
						prevPayload: tryParseChallengeJsonBody(msg.body),
						nextPayload: tryParseChallengeJsonBody(newBody)
					});
				} catch (err) {
					console.warn("[PATCH .../messages] organizer ref sync", err?.message || err);
				}
				// Drop any leftover duplicate challenge_config rows for this id.
				try {
					const nextParsed = tryParseChallengeJsonBody(newBody);
					const cid = String(nextParsed?.challenge_id || "").trim();
					if (cid) {
						const rows = await fetchThreadMessagesChronological(sb, threadId);
						const siblingIds = [];
						for (const m of rows) {
							const p = tryParseChallengeJsonBody(m?.body);
							if (
								!p ||
								String(p.kind || "").trim() !== "challenge_config" ||
								String(p.challenge_id || "").trim() !== cid
							) {
								continue;
							}
							const mid = Number(m?.id);
							if (Number.isFinite(mid) && mid > 0 && mid !== messageId) {
								siblingIds.push(mid);
							}
						}
						if (siblingIds.length) {
							const { error: delErr } = await sb
								.from("prsn_chat_messages")
								.delete()
								.in("id", siblingIds)
								.eq("thread_id", threadId);
							if (delErr) throw delErr;
							void broadcastRoomDirty(threadId, messageId);
						}
					}
				} catch (err) {
					console.warn("[PATCH .../messages] collapse duplicate configs", err?.message || err);
				}
			}

			return res.status(200).json({ message: out });
		} catch (err) {
			console.error("[PATCH /api/chat/messages/:messageId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// DELETE /api/chat/messages/:messageId — sender or admin; removes row and broadcasts invalidation
	router.delete("/api/chat/messages/:messageId", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const messageId = Number(req.params.messageId);
		if (!Number.isFinite(messageId) || messageId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid message id" });
		}

		try {
			const { data: msg, error: selErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, sender_id, body")
				.eq("id", messageId)
				.maybeSingle();
			if (selErr) throw selErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found" });
			}

			const threadId = Number(msg.thread_id);
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const senderId = Number(msg.sender_id);
			const isSender = Number.isFinite(senderId) && senderId === userId;
			const isAdmin = await viewerIsAdminRole(userId);
			if (!isSender && !isAdmin) {
				return res.status(403).json({
					error: "Forbidden",
					message: "You can only delete your own messages"
				});
			}

			const bodyForAssets = msg.body != null ? String(msg.body) : "";
			const senderIdForAssets = Number(msg.sender_id);
			const previousMessageIdRes = await sb
				.from("prsn_chat_messages")
				.select("id")
				.eq("thread_id", threadId)
				.lt("id", messageId)
				.order("id", { ascending: false })
				.limit(1)
				.maybeSingle();
			if (previousMessageIdRes.error) throw previousMessageIdRes.error;
			const previousMessageId =
				previousMessageIdRes.data?.id != null ? Number(previousMessageIdRes.data.id) : null;

			// Keep read state stable when deleting the member's current read pointer.
			const readPointerPatch =
				Number.isFinite(previousMessageId) && previousMessageId > 0
					? { last_read_message_id: previousMessageId }
					: { last_read_message_id: null };
			const { error: readPointerErr } = await sb
				.from("prsn_chat_members")
				.update(readPointerPatch)
				.eq("thread_id", threadId)
				.eq("last_read_message_id", messageId);
			if (readPointerErr) throw readPointerErr;

			const { error: delErr } = await sb.from("prsn_chat_messages").delete().eq("id", messageId);
			if (delErr) throw delErr;

			await deleteChatMiscGenericFilesForMessage(storage, bodyForAssets, senderIdForAssets);

			const { data: threadForPin, error: threadPinErr } = await sb
				.from("prsn_chat_threads")
				.select("type, meta")
				.eq("id", threadId)
				.maybeSingle();
			if (threadPinErr) throw threadPinErr;
			if (threadForPin?.type === "channel") {
				const pinnedId = getChannelPinnedMessageIdFromThreadRow(threadForPin);
				if (pinnedId != null && pinnedId === messageId) {
					const nextMeta = buildThreadMetaWithChannelPin(threadForPin.meta, null);
					const { error: clearPinErr } = await sb
						.from("prsn_chat_threads")
						.update({ meta: nextMeta })
						.eq("id", threadId);
					if (clearPinErr) throw clearPinErr;
				}
			}

			void broadcastRoomDirty(threadId, messageId);
			const mem = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", threadId);
			const uids = Array.isArray(mem.data) ? mem.data.map((r) => r.user_id) : [];
			void broadcastUserInboxDirty(threadId, uids);

			return res.status(200).json({ ok: true, deleted_id: messageId, thread_id: threadId });
		} catch (err) {
			console.error("[DELETE /api/chat/messages/:messageId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/chat/messages/:messageId/reactions  { emoji_key, op? } — toggle/add/remove; stored on message.reactions jsonb
	router.post("/api/chat/messages/:messageId/reactions", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const messageId = Number(req.params.messageId);
		if (!Number.isFinite(messageId) || messageId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "Invalid message id" });
		}

		const emojiKey = typeof req.body?.emoji_key === "string" ? req.body.emoji_key.trim() : "";
		if (!emojiKey || !REACTION_ORDER.includes(emojiKey)) {
			return res.status(400).json({ error: "Bad request", message: "Invalid or missing emoji_key" });
		}
		const opRaw = typeof req.body?.op === "string" ? req.body.op.trim().toLowerCase() : "";
		const op = opRaw === "add" || opRaw === "remove" ? opRaw : "toggle";

		try {
			const { data: msg, error: msgErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, reactions, body")
				.eq("id", messageId)
				.maybeSingle();
			if (msgErr) throw msgErr;
			if (!msg) {
				return res.status(404).json({ error: "Not found", message: "Message not found" });
			}

			const threadId = Number(msg.thread_id);
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			const challengePayload = tryParseChallengeJsonBody(msg.body);
			const isChallengeSubmission =
				challengePayload && String(challengePayload.kind || "").trim() === "challenge_submission";
			const isScoreKey = isChallengeScoreReactionKey(emojiKey);

			const bucket = normalizeChatReactionsBucket(msg.reactions);
			const uid = Number(userId);
			let arr = Array.isArray(bucket[emojiKey]) ? [...bucket[emojiKey]].map((x) => Number(x)) : [];
			arr = [...new Set(arr.filter((n) => Number.isFinite(n) && n > 0))];
			const idx = arr.indexOf(uid);
			let added;
			if (op === "add") {
				if (idx < 0) arr.push(uid);
				bucket[emojiKey] = arr;
				added = true;
			} else if (op === "remove") {
				if (idx >= 0) arr.splice(idx, 1);
				added = false;
				if (arr.length === 0) delete bucket[emojiKey];
				else bucket[emojiKey] = arr;
			} else if (idx >= 0) {
				arr.splice(idx, 1);
				added = false;
				if (arr.length === 0) {
					delete bucket[emojiKey];
				} else {
					bucket[emojiKey] = arr;
				}
			} else {
				arr.push(uid);
				bucket[emojiKey] = arr;
				added = true;
			}

			// Challenge submissions: at most one score reaction per voter.
			if (isChallengeSubmission && isScoreKey) {
				if (added) {
					stripUserFromChallengeScoreReactions(bucket, uid, { keepKey: emojiKey });
				} else {
					stripUserFromChallengeScoreReactions(bucket, uid);
				}
			}

			const { error: upErr } = await sb
				.from("prsn_chat_messages")
				.update({ reactions: bucket })
				.eq("id", messageId);
			if (upErr) throw upErr;

			const count = Array.isArray(bucket[emojiKey]) ? bucket[emojiKey].length : 0;

			return res.json({ added, count });
		} catch (err) {
			console.error("[POST /api/chat/messages/:messageId/reactions]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	return router;
}
