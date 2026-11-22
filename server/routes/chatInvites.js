import crypto from "node:crypto";
import express from "express";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "../services/challenges/realtimeBroadcast.js";
import { getShareBaseUrl } from "../services/create/url.js";

const VERSION = "ci1";
const TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DM_INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const PRIVATE_PREFIX = "enc:v1:";

function inviteSecret() {
	return String(process.env.CHAT_INVITE_SECRET || "").trim() || "parascene-chat-invite-v1";
}

function sign(payload) {
	return crypto.createHmac("sha256", inviteSecret()).update(String(payload)).digest("base64url").slice(0, 20);
}

function mintInvite({ threadId, secretK, inviterUserId, expiresAtMs }) {
	const encoded = Buffer.from(JSON.stringify({ v: VERSION, t: Number(threadId), k: String(secretK || ""), u: Number(inviterUserId), e: Number(expiresAtMs) }), "utf8").toString("base64url");
	return `${encoded}.${sign(encoded)}`;
}

function verifyInvite(raw) {
	const parts = String(raw || "").split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
	const expected = sign(parts[0]);
	const actual = Buffer.from(parts[1], "utf8");
	const wanted = Buffer.from(expected, "utf8");
	if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) return { ok: false };
	let payload;
	try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false }; }
	const threadId = Number(payload?.t);
	const inviterUserId = Number(payload?.u);
	const expiresAtMs = Number(payload?.e);
	const secretK = typeof payload?.k === "string" ? payload.k.trim() : "";
	if (payload?.v !== VERSION || !secretK || Date.now() > expiresAtMs) return { ok: false };
	if (![threadId, inviterUserId].every((value) => Number.isFinite(value) && value > 0)) return { ok: false };
	return { ok: true, threadId, inviterUserId, secretK };
}

function isPrivateChannel(thread) {
	return thread?.type === "channel" && String(thread.meta?.visibility || "").trim().toLowerCase() === "private";
}

async function userMeta(client, userId) {
	const result = await client.from("prsn_users").select("meta").eq("id", userId).maybeSingle();
	if (result.error) throw result.error;
	return result.data?.meta && typeof result.data.meta === "object" && !Array.isArray(result.data.meta) ? { ...result.data.meta } : {};
}

function encryptPrivate(plain, secret) {
	const key = crypto.createHash("sha256").update(String(secret || "")).digest();
	if (!secret) return null;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const payload = Buffer.concat([cipher.update(String(plain || ""), "utf8"), cipher.final(), cipher.getAuthTag()]);
	return `${iv.toString("base64url")}.${payload.toString("base64url")}`;
}

function usernameOf(input) {
	const raw = typeof input === "string" ? input.trim() : "";
	if (!raw) return null;
	const normalized = (raw.startsWith("@") ? raw.slice(1) : raw).trim().toLowerCase();
	return /^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized) ? normalized : null;
}

function pairKey(a, b) {
	const left = Number(a);
	const right = Number(b);
	if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
	return `${Math.min(left, right)}:${Math.max(left, right)}`;
}

async function ensureDm(client, a, b) {
	const key = pairKey(a, b);
	if (!key) throw new Error("Invalid DM user ids");
	let existing = await client.from("prsn_chat_threads").select("id").eq("type", "dm").eq("dm_pair_key", key).maybeSingle();
	if (existing.error) throw existing.error;
	let threadId = existing.data?.id;
	if (!threadId) {
		const inserted = await client.from("prsn_chat_threads").insert({ type: "dm", dm_pair_key: key, channel_slug: null }).select("id").single();
		if (inserted.error) {
			existing = await client.from("prsn_chat_threads").select("id").eq("type", "dm").eq("dm_pair_key", key).maybeSingle();
			threadId = existing.data?.id;
		} else threadId = inserted.data?.id;
	}
	if (!threadId) throw new Error("Could not create DM thread");
	const members = Number(a) === Number(b) ? [{ thread_id: threadId, user_id: a }] : [{ thread_id: threadId, user_id: a }, { thread_id: threadId, user_id: b }];
	const saved = await client.from("prsn_chat_members").upsert(members, { onConflict: "thread_id,user_id", ignoreDuplicates: true });
	if (saved.error) throw saved.error;
	return Number(threadId);
}

async function profileByUser(client, userId) {
	const result = await client.from("prsn_user_profiles").select("user_id,user_name,display_name").eq("user_id", userId).maybeSingle();
	return result.data || null;
}

async function profileByName(client, name) {
	const result = await client.from("prsn_user_profiles").select("user_id,user_name,display_name").eq("user_name", name).maybeSingle();
	return result.data || null;
}

async function member(client, threadId, userId) {
	const result = await client.from("prsn_chat_members").select("user_id").eq("thread_id", threadId).eq("user_id", userId).maybeSingle();
	if (result.error) throw result.error;
	return Boolean(result.data);
}

export function createChatInviteRoutes({ client }) {
	const router = express.Router();

	router.post("/api/chat/invites", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const threadId = Number(req.body?.thread_id ?? req.body?.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) return res.status(400).json({ error: "Bad request", message: "thread_id required" });
		try {
			if (!(await member(client, threadId, req.auth.userId))) return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			const thread = await client.from("prsn_chat_threads").select("id,type,meta").eq("id", threadId).maybeSingle();
			if (thread.error) throw thread.error;
			if (!isPrivateChannel(thread.data)) return res.status(400).json({ error: "Bad request", message: "Invites are only for private channels" });
			const meta = await userMeta(client, req.auth.userId);
			const secretK = String(meta.chat_private_keys?.[String(threadId)]?.k || "").trim();
			if (!secretK) return res.status(400).json({ error: "Bad request", message: "Missing channel key for inviter" });
			const expiresAtMs = Date.now() + TTL_MS;
			const inviteToken = mintInvite({ threadId, secretK, inviterUserId: req.auth.userId, expiresAtMs });
			return res.json({
				invite_token: inviteToken,
				invite_url: `${getShareBaseUrl()}/chat#ci=${encodeURIComponent(inviteToken)}`,
				expires_at: new Date(expiresAtMs).toISOString()
			});
		} catch (error) {
			console.error("[POST /api/chat/invites]", error);
			return res.status(500).json({ error: "Server error", message: error.message || "Failed" });
		}
	});

	router.post("/api/chat/invites/accept", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const inviteToken = typeof req.body?.invite_token === "string" ? req.body.invite_token.trim() : "";
		if (!inviteToken) return res.status(400).json({ error: "Bad request", message: "invite_token required" });
		const parsed = verifyInvite(inviteToken);
		if (!parsed.ok) return res.status(400).json({ error: "Bad request", message: "Invalid or expired invite token" });
		try {
			const thread = await client.from("prsn_chat_threads").select("id,type,meta").eq("id", parsed.threadId).maybeSingle();
			if (thread.error) throw thread.error;
			if (!thread.data) return res.status(404).json({ error: "Not found", message: "Channel not found" });
			if (!isPrivateChannel(thread.data)) return res.status(400).json({ error: "Bad request", message: "Invite is not for a private channel" });
			if (!(await member(client, parsed.threadId, parsed.inviterUserId))) return res.status(403).json({ error: "Forbidden", message: "Invite issuer is no longer a member" });
			const joined = await client.from("prsn_chat_members").upsert({ thread_id: parsed.threadId, user_id: req.auth.userId }, { onConflict: "thread_id,user_id", ignoreDuplicates: true });
			if (joined.error) throw joined.error;
			const meta = await userMeta(client, req.auth.userId);
			const keys = meta.chat_private_keys && typeof meta.chat_private_keys === "object" ? { ...meta.chat_private_keys } : {};
			keys[String(parsed.threadId)] = { k: parsed.secretK, v: 1, added_at: new Date().toISOString() };
			meta.chat_private_keys = keys;
			const saved = await client.from("prsn_users").update({ meta }).eq("id", req.auth.userId);
			if (saved.error) throw saved.error;
			return res.json({ ok: true, thread_id: parsed.threadId });
		} catch (error) {
			console.error("[POST /api/chat/invites/accept]", error);
			return res.status(500).json({ error: "Server error", message: error.message || "Failed" });
		}
	});

	router.post("/api/chat/invites/dm", async (req, res) => {
		if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const userId = Number(req.auth.userId);
		const threadId = Number(req.body?.thread_id ?? req.body?.threadId);
		const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
		if (!Number.isFinite(threadId) || threadId <= 0) return res.status(400).json({ error: "Bad request", message: "thread_id required" });
		if (!recipients.length) return res.status(400).json({ error: "Bad request", message: "recipients required" });
		try {
			if (!(await member(client, threadId, userId))) return res.status(403).json({ error: "Forbidden", message: "Not a member of this thread" });
			const thread = await client.from("prsn_chat_threads").select("id,type,meta").eq("id", threadId).maybeSingle();
			if (thread.error) throw thread.error;
			if (!isPrivateChannel(thread.data)) return res.status(400).json({ error: "Bad request", message: "Only private channels support DM invites" });
			const secretK = String((await userMeta(client, userId)).chat_private_keys?.[String(threadId)]?.k || "").trim();
			if (!secretK) return res.status(400).json({ error: "Bad request", message: "Missing channel key for inviter" });
			const inviterProfile = await profileByUser(client, userId);
			const inviterName = String(inviterProfile?.display_name || "").trim() || (inviterProfile?.user_name ? `@${inviterProfile.user_name.trim()}` : "A member");
			const inviterHandle = inviterProfile?.user_name ? `@${String(inviterProfile.user_name).trim()}` : inviterName;
			const sent = [];
			const alreadyJoined = [];
			const invitedHandles = [];
			const seen = new Set();
			for (const recipient of recipients) {
				let toUserId = Number(recipient?.user_id ?? recipient?.userId);
				let handle = "";
				if (Number.isFinite(toUserId) && toUserId > 0) {
					const profile = await profileByUser(client, toUserId);
					if (profile?.user_name) handle = `@${profile.user_name.trim()}`;
				} else {
					const name = usernameOf(recipient?.user_name ?? recipient?.userName ?? "");
					const profile = name ? await profileByName(client, name) : null;
					toUserId = Number(profile?.user_id);
					if (profile?.user_name) handle = `@${profile.user_name.trim()}`;
				}
				if (!Number.isFinite(toUserId) || toUserId <= 0 || toUserId === userId || seen.has(toUserId)) continue;
				seen.add(toUserId);
				if (await member(client, threadId, toUserId)) {
					alreadyJoined.push(handle || `user ${toUserId}`);
					continue;
				}
				const expiresAtMs = Date.now() + DM_INVITE_TTL_MS;
				const inviteToken = mintInvite({ threadId, secretK, inviterUserId: userId, expiresAtMs });
				const dmThreadId = await ensureDm(client, userId, toUserId);
				const inserted = await client.from("prsn_chat_messages").insert({
					thread_id: dmThreadId,
					sender_id: userId,
					body: `${inviterName} invited you to a private channel.`,
					meta: {
						time_sensitive: {
							kind: "channel_invite",
							expires_at: new Date(expiresAtMs).toISOString(),
							delete_on_expire: true,
							cta: { action: "accept_private_channel_invite", label: "Accept invite", invite_token: inviteToken },
							private_channel_invite: { channel_thread_id: threadId, invitee_user_id: toUserId }
						}
					}
				}).select("id").single();
				if (inserted.error) throw inserted.error;
				const messageId = Number(inserted.data?.id);
				if (messageId > 0) {
					await client.from("prsn_chat_members").update({ last_read_message_id: messageId }).eq("thread_id", dmThreadId).eq("user_id", userId);
					broadcastRoomDirty(dmThreadId, messageId);
					const members = await client.from("prsn_chat_members").select("user_id").eq("thread_id", dmThreadId);
					broadcastUserInboxDirty(dmThreadId, (members.data || []).map((row) => row.user_id));
				}
				if (handle) invitedHandles.push(handle);
				sent.push({ to_user_id: toUserId, dm_thread_id: dmThreadId });
			}
			if (sent.length) {
				const invitedText = invitedHandles.length ? invitedHandles.join(", ") : "someone";
				const cipher = encryptPrivate(`${inviterHandle} invited ${invitedText} to the channel`, secretK);
				if (!cipher) throw new Error("Could not encrypt private channel system event");
				const system = await client.from("prsn_chat_messages").insert({
					thread_id: threadId,
					sender_id: userId,
					body: `${PRIVATE_PREFIX}${cipher}`,
					meta: { system_event: { kind: "channel_invite_sent", inviter_user_id: userId, invited_user_ids: sent.map((item) => item.to_user_id) } }
				}).select("id").single();
				if (!system.error && Number(system.data?.id) > 0) {
					await client.from("prsn_chat_members").update({ last_read_message_id: system.data.id }).eq("thread_id", threadId).eq("user_id", userId);
					broadcastRoomDirty(threadId, Number(system.data.id));
					const members = await client.from("prsn_chat_members").select("user_id").eq("thread_id", threadId);
					broadcastUserInboxDirty(threadId, (members.data || []).map((row) => row.user_id));
				}
			}
			const joined = [...new Set(alreadyJoined)];
			if (!sent.length && joined.length) {
				return res.status(409).json({ error: "Conflict", message: `Already joined: ${joined.join(", ")}`, already_joined: joined, sent_count: 0, sent: [] });
			}
			return res.json({ ok: true, sent_count: sent.length, sent, already_joined: joined });
		} catch (error) {
			console.error("[POST /api/chat/invites/dm]", error);
			return res.status(500).json({ error: "Server error", message: error.message || "Failed" });
		}
	});

	return router;
}
