import express from "express";
import { Redis } from "@upstash/redis";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";

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

	// POST /api/chat/dm  { other_user_id }
	router.post("/api/chat/dm", async (req, res) => {
		const userId = requireUser(req, res);
		if (userId == null) return;
		const sb = getSb(res);
		if (!sb) return;

		const otherRaw = req.body?.other_user_id ?? req.body?.otherUserId;
		const otherId = Number(otherRaw);
		if (!Number.isFinite(otherId) || otherId <= 0) {
			return res.status(400).json({ error: "Bad request", message: "other_user_id required" });
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

			let nextBefore = null;
			if (page.length > 0) {
				const oldest = page[0];
				nextBefore = encodeCursor(oldest.created_at, oldest.id);
			}

			return res.status(200).json({
				messages: page,
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

			return res.status(201).json({ message: ins.data });
		} catch (err) {
			console.error("[POST .../messages]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	return router;
}
