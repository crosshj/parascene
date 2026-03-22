import express from "express";
import { Redis } from "@upstash/redis";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "./utils/realtimeBroadcast.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";
import { getNotificationDisplayName } from "./utils/displayName.js";
import { REACTION_ORDER } from "./comments.js";

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

export default function createChatRoutes({ queries }) {
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
				const lastMessage =
					row.last_message_at && row.last_message_body != null
						? {
								body: String(row.last_message_body),
								created_at: row.last_message_at,
								sender_id: Number(row.last_sender_id)
							}
						: null;

				if (type === "channel") {
					const slug = row.channel_slug ? String(row.channel_slug) : "";
					return {
						id,
						type: "channel",
						channel_slug: slug,
						title: slug ? `#${slug}` : "Channel",
						last_message: lastMessage
					};
				}

				const otherId = otherUserIdFromDmPair(row.dm_pair_key, userId);
				const profile = otherId != null ? profileMap.get(otherId) : null;
				const title = getNotificationDisplayName(null, profile || undefined);
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
					last_message: lastMessage
				};
			});

			return res.status(200).json({ viewer_id: userId, threads });
		} catch (err) {
			console.error("[GET /api/chat/threads]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
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
		if (otherId === userId) {
			return res.status(400).json({ error: "Bad request", message: "Cannot open DM with yourself" });
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

			const members = [
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

			return res.status(200).json({ thread });
		} catch (err) {
			console.error("[GET /api/chat/threads/:threadId]", err);
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
			if (!(await isMember(sb, threadId, userId))) {
				return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			}

			if (!(await rateLimitSend(userId))) {
				return res.status(429).json({ error: "Too many requests", message: "Rate limit exceeded" });
			}

			const ins = await sb
				.from("prsn_chat_messages")
				.insert({ thread_id: threadId, sender_id: userId, body })
				.select("id, thread_id, sender_id, body, created_at")
				.single();

			if (ins.error) throw ins.error;

			if (ins.data?.id != null) {
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
