import express from "express";
import { Redis } from "@upstash/redis";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "./utils/realtimeBroadcast.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";
import { dmChatInboxTitleFromProfile } from "./utils/dmChatInboxTitle.js";
import { REACTION_ORDER } from "./comments.js";
import { getShareBaseUrl } from "./utils/url.js";
import { ACTIVE_SHARE_VERSION, mintShareToken } from "./utils/shareLink.js";
import {
	collectChatMiscGenericKeysFromMessageBody,
	isChatMiscGenericKeyOwnedByUser
} from "./utils/chatMiscGenericKeys.js";

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

/** Stored on each message as jsonb: { emoji_key: [user_id, ...] }. Response uses numeric counts (not comment-style name lists). */
function enrichChatReactionsFromMessageColumn(messages, viewerId) {
	const viewerIdNum =
		viewerId != null && Number.isFinite(Number(viewerId)) ? Number(viewerId) : null;
	return messages.map((m) => {
		const bucket = normalizeChatReactionsBucket(m.reactions);
		const reactions = {};
		const viewer_reactions = [];
		for (const emojiKey of REACTION_ORDER) {
			const userIds = bucket[emojiKey] || [];
			const total = userIds.length;
			if (total === 0) continue;
			reactions[emojiKey] = total;
			if (viewerIdNum != null && userIds.includes(viewerIdNum)) {
				viewer_reactions.push(emojiKey);
			}
		}
		return { ...m, reactions, viewer_reactions };
	});
}

function otherUserIdFromDmPair(dmPairKey, userId) {
	if (!dmPairKey || typeof dmPairKey !== "string") return null;
	const parts = dmPairKey.split(":");
	if (parts.length !== 2) return null;
	const a = Number(parts[0]);
	const b = Number(parts[1]);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
	if (a === userId) return b;
	if (b === userId) return a;
	return null;
}

const MAX_MESSAGE_CHARS = 4000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const SEND_RATE_WINDOW_SEC = 60;
const SEND_RATE_MAX = 60;

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
 * Spans in `text` that are bare `/creations/:id` or http(s) URLs whose path is exactly `/creations/:id` (not `/edit`, etc.).
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
			const mm = (u.pathname || "").match(/^\/creations\/(\d+)\/?$/i);
			if (mm) {
				const id = Number(mm[1]);
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
		const row = await queries.selectCreatedImageById?.get(id, senderUserId);
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

let redis = null;
function getRedis() {
	if (!redis) redis = Redis.fromEnv();
	return redis;
}

function dmPairKey(a, b) {
	const x = Number(a);
	const y = Number(b);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const lo = Math.min(x, y);
	const hi = Math.max(x, y);
	return `${lo}:${hi}`;
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

async function rateLimitSend(userId) {
	try {
		const r = getRedis();
		const key = `chat:send:${userId}`;
		const n = await r.incr(key);
		if (n === 1) await r.expire(key, SEND_RATE_WINDOW_SEC);
		return n <= SEND_RATE_MAX;
	} catch {
		return true;
	}
}

/** Attach `sender_user_name` and `sender_avatar_url` from `prsn_user_profiles` for each message row. */
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
			sender_avatar_url: null
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
	return messages.map((m) => {
		const sid = Number(m.sender_id);
		const p = map.get(sid);
		return {
			...m,
			sender_user_name: p?.user_name ?? null,
			sender_avatar_url: p?.avatar_url ?? null
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

	// GET /api/chat/unread-summary — total unread messages across threads (for nav badge)
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
			return res.status(200).json({ total_unread: total });
		} catch (err) {
			console.error("[GET /api/chat/unread-summary]", err);
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
			const otherIds = new Set();
			for (const row of list) {
				if (row?.thread_type === "dm" && row?.dm_pair_key) {
					const oid = otherUserIdFromDmPair(row.dm_pair_key, userId);
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
					return {
						id,
						type: "channel",
						channel_slug: slug,
						title: slug ? `#${slug}` : "Channel",
						last_message: lastMessage,
						last_read_message_id: Number.isFinite(lastRead) && lastRead > 0 ? lastRead : null,
						unread_count: unreadCount
					};
				}

				const otherId = otherUserIdFromDmPair(row.dm_pair_key, userId);
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
			try {
				if (typeof queries?.selectUserById?.get === "function") {
					const u = await queries.selectUserById.get(userId);
					viewerIsAdmin = u?.role === "admin";
				}
			} catch {
				viewerIsAdmin = false;
			}

			return res.status(200).json({
				viewer_id: userId,
				viewer_is_admin: viewerIsAdmin,
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
				.select("channel_slug")
				.eq("type", "channel");
			if (error) throw error;
			const set = new Set();
			for (const row of data || []) {
				const s = row?.channel_slug != null ? String(row.channel_slug).trim() : "";
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

		/** Sidebar pseudo rows (#comments / #feedback) are always “channels” in the product sense. */
		const PSEUDO_CHANNEL_SLUGS = new Set(["comments", "feedback"]);
		if (PSEUDO_CHANNEL_SLUGS.has(slug)) {
			return res.status(200).json({ slug, channelExists: true });
		}

		try {
			const { data, error } = await sb
				.from("prsn_chat_threads")
				.select("id")
				.eq("type", "channel")
				.eq("channel_slug", slug)
				.maybeSingle();
			if (error) throw error;
			return res.status(200).json({ slug, channelExists: Boolean(data?.id) });
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

		const slug = normalizeTag(req.body?.tag ?? req.body?.channel ?? "");
		if (!slug) {
			return res.status(400).json({ error: "Bad request", message: "Invalid or missing tag" });
		}

		/** Client-side pseudo-channels (e.g. latest creation comments); not real hashtag threads. */
		const RESERVED_CHANNEL_SLUGS = new Set(["comments"]);
		if (RESERVED_CHANNEL_SLUGS.has(slug)) {
			return res.status(400).json({
				error: "Bad request",
				message: "This channel name is reserved.",
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
				const ins = await sb
					.from("prsn_chat_threads")
					.insert({ type: "channel", dm_pair_key: null, channel_slug: slug })
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

			return res.status(200).json({
				thread: { id: threadId, type: "channel", channel_slug: slug, dm_pair_key: null }
			});
		} catch (err) {
			console.error("[POST /api/chat/channels]", err);
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
				.select("id, type, dm_pair_key, channel_slug, created_at")
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
			out.last_read_message_id = Number.isFinite(lr) && lr > 0 ? lr : null;
			if (thread.type === "channel") {
				const slug = thread.channel_slug ? String(thread.channel_slug) : "";
				out.title = slug ? `#${slug}` : "Channel";
			} else if (thread.type === "dm" && thread.dm_pair_key) {
				const otherId = otherUserIdFromDmPair(thread.dm_pair_key, userId);
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

			return res.status(200).json({ ok: true, last_read_message_id: mid });
		} catch (err) {
			console.error("[POST /api/chat/threads/:threadId/read]", err);
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
			const hasMore = list.length > limit;
			const page = hasMore ? list.slice(0, limit) : list;
			page.reverse();

			let messagesOut = await enrichChatMessagesWithSenderProfiles(sb, page);
			messagesOut = enrichChatReactionsFromMessageColumn(messagesOut, userId);

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
		if (body.length > MAX_MESSAGE_CHARS) {
			return res.status(400).json({
				error: "Bad request",
				message: `body must be at most ${MAX_MESSAGE_CHARS} characters`
			});
		}

		try {
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			if (!(await rateLimitSend(userId))) {
				return res.status(429).json({ error: "Too many requests", message: "Rate limit exceeded" });
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
				.insert({ thread_id: threadId, sender_id: userId, body })
				.select("id, thread_id, sender_id, body, created_at")
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
				const mem = await sb
					.from("prsn_chat_members")
					.select("user_id")
					.eq("thread_id", threadId);
				const uids = Array.isArray(mem.data) ? mem.data.map((r) => r.user_id) : [];
				void broadcastUserInboxDirty(threadId, uids);
			}

			return res.status(201).json({ message: ins.data });
		} catch (err) {
			console.error("[POST .../messages]", err);
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

			const { error: delErr } = await sb.from("prsn_chat_messages").delete().eq("id", messageId);
			if (delErr) throw delErr;

			await deleteChatMiscGenericFilesForMessage(storage, bodyForAssets, senderIdForAssets);

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

	// POST /api/chat/messages/:messageId/reactions  { emoji_key } — toggle; stored on message.reactions jsonb
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

		try {
			const { data: msg, error: msgErr } = await sb
				.from("prsn_chat_messages")
				.select("id, thread_id, reactions")
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

			const bucket = normalizeChatReactionsBucket(msg.reactions);
			const uid = Number(userId);
			let arr = Array.isArray(bucket[emojiKey]) ? [...bucket[emojiKey]].map((x) => Number(x)) : [];
			arr = [...new Set(arr.filter((n) => Number.isFinite(n) && n > 0))];
			const idx = arr.indexOf(uid);
			let added;
			if (idx >= 0) {
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
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	return router;
}
