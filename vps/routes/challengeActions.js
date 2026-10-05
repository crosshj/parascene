import { saveChallengeVote } from '../services/challenges/voteStore.js';
import express from "express";
import crypto from "crypto";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "../services/challenges/realtimeBroadcast.js";
import { getSupabaseServiceClient } from "../services/create/supabaseService.js";
import { insertNotificationsForChatMentions } from "../services/challenges/chatMentionNotifications.js";
import { REACTION_ORDER } from "../services/challenges/reactionOrder.js";
import { buildWhoListFromProfileRows } from "../services/challenges/whoMeta.js";
import { getShareBaseUrl } from "../services/create/url.js";
import { ACTIVE_SHARE_VERSION, mintShareToken } from "../services/challenges/shareLink.js";
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
} from "../services/create/challengeSubmitShared.js";
import {
	upsertChallengeEditorialPin,
	removeChallengeEditorialPin,
	normalizeChallengePinKind,
	ORGANIZER_ROLE_TO_PIN_KIND
} from "../services/create/challengeLifecycle.js";
import { invalidateAndRebuildChallengeFeedSnapshotCache } from "../services/feed/challengeFeedSnapshotCache.js";
import { syncChallengeOrganizerCreationRefsOnConfigWrite } from "../services/create/challengeOrganizerRefSync.js";
import { persistSingleChallengeConfigMessage } from "../services/create/challengeConfigMessage.js";
import { groupActionSupportedForMeta, parseMeta } from "../services/create/groupV2.js";
import { loadEditorialPinPolicyDocument } from "../services/feed/editorialPinPolicy.js";
import { collectChatMiscGenericKeysFromMessageBody,
	isChatMiscGenericKeyOwnedByUser
} from "../services/challenges/chatMiscGenericKeys.js";
import { CHALLENGE_SCORE_REACTION_KEYS } from "../client/shared/challenges/constants.js";
import {
	isChallengeScoreReactionKey,
	stripUserFromChallengeScoreReactions
} from "../client/shared/challenges/model/scoreReactions.js";
import { composeChatStampedReply, sanitizeClientReplyPreview } from "../services/challenges/chatReplyStamp.js";
import {
	mergeFullChallengeConfigForChallenge,
	isChallengeConfigSoftDeleted,
	isChallengeConfigPurged,
	pickChallengeHeroImageUrl,
	pickChallengeResultsCreationUrl,
	pickChallengeTopicVoteCreationUrl,
	tracksViewerCanOrganize
} from "../client/shared/challenges/challengeAdmin.js";
import { deriveChallengePhase } from "../client/shared/challenges/model/phases.js";
import { MAX_MACHINE_CHANNEL_MESSAGE_CHARS, maxChatMessageBodyChars } from "../services/challenges/chatMessageLimits.js";
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

const CHALLENGE_STATS_GLOBAL_AVG_TTL_MS = 60_000;

const challengeThreadGlobalAverageCache = new Map();

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

const MAX_CANVAS_TITLE_CHARS = 200;

const PRIVATE_CHANNEL_VISIBILITY = "private";

const CHAT_PRIVATE_BODY_PREFIX = "enc:v1:";

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

function threadVisibilityFromMeta(meta) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "public";
	const raw = typeof meta.visibility === "string" ? meta.visibility.trim().toLowerCase() : "";
	return raw === PRIVATE_CHANNEL_VISIBILITY ? PRIVATE_CHANNEL_VISIBILITY : "public";
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
export default function createChallengeActionsRoutes({ queries, storage, getClient = getSupabaseServiceClient }) {
const router = express.Router();
async function challengeMessageOnly(req, res, next) {
 if (!req.auth?.userId) return next();
 const sb = getSb(res); if (!sb) return;
 try {
  let threadId = Number(req.params.threadId);
  if (!threadId) { const {data,error} = await sb.from('prsn_chat_messages').select('thread_id').eq('id',Number(req.params.messageId)).maybeSingle(); if(error)throw error; threadId=Number(data?.thread_id); }
  if (!threadId) return next('route');
  const {data,error} = await sb.from('prsn_chat_threads').select('channel_slug').eq('id',threadId).maybeSingle(); if(error)throw error;
  if(data?.channel_slug !== 'challenges') return next('route');
  next();
 } catch(error) { next(error); }
}


function requireUser(req, res) {
		const userId = req.auth?.userId;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		return userId;
	}

function getSb(res) {
		const sb = getClient();
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

function isCanvasMessageRow(msg) {
		const meta = msg?.meta;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
		const canvas = meta.canvas;
		if (!canvas || typeof canvas !== "object") return false;
		const title = typeof canvas.title === "string" ? canvas.title.trim() : "";
		return title.length > 0;
	}

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

router.post("/api/chat/threads/:threadId/messages", challengeMessageOnly, async (req, res) => {
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

router.patch("/api/chat/messages/:messageId", challengeMessageOnly, async (req, res) => {
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

router.delete("/api/chat/messages/:messageId", challengeMessageOnly, async (req, res) => {
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

router.post("/api/chat/messages/:messageId/reactions", challengeMessageOnly, async (req, res) => {
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

			if (isChallengeSubmission && isScoreKey) {
    const saved = await saveChallengeVote({ sb, userId, messageId, emojiKey, op });
    void broadcastRoomDirty(saved.thread_id, messageId);
    void broadcastUserInboxDirty(saved.thread_id, [userId]);
    return res.json(saved);
   }
   if (isChallengeSubmission) return res.status(400).json({ message: 'Use the challenge score controls for entries.' });
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

			const { error: upErr } = await sb
				.from("prsn_chat_messages")
				.update({ reactions: bucket })
				.eq("id", messageId);
			if (upErr) throw upErr;

			const count = Array.isArray(bucket[emojiKey]) ? bucket[emojiKey].length : 0;

			return res.json({ added, count });
		} catch (err) {
			console.error("[POST /api/chat/messages/:messageId/reactions]", err);
			return res.status(err?.status || 500).json({ error: "Could not save reaction", message: err?.message || "Failed" });
		}
	});
router.put('/api/chat/messages/:messageId/challenge-vote', async (req, res, next) => {
 const userId = requireUser(req, res); if (!userId) return;
 const sb = getSb(res); if (!sb) return;
 try {
  if (Number(req.body?.viewer_id) !== Number(userId)) return res.status(403).json({ code: 'VIEWER_CHANGED', message: 'Sign in to the account that cast this vote.' });
  if (!req.body?.intent || req.body?.score === undefined) return res.status(400).json({ message: 'Score and intent required' });
  const saved = await saveChallengeVote({ sb, userId, messageId: Number(req.params.messageId), score: req.body.score, intent: req.body.intent });
  void broadcastRoomDirty(saved.thread_id, saved.message_id);
  void broadcastUserInboxDirty(saved.thread_id, [userId]);
  res.json(saved);
 } catch(error) { if(error.status) res.status(error.status).json({ message: error.message }); else next(error); }
});
return router;
}
