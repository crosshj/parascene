import express from "express";
import { normalizeTag } from "../services/account/tag.js";
import { verifyKioskToken } from "../services/kiosk/kioskToken.js";
import { getShareHostname } from "../services/create/url.js";
import { ACTIVE_SHARE_VERSION, verifyShareToken } from "./utils/shareLink.js";

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const PSEUDO = new Set(["comments", "feed", "explore", "creations"]);
const SCAN = 100;

function sharePattern() {
	return new RegExp(`https?://${getShareHostname().replace(/\./g, "\\.")}/s/([^/\\s]+)/([^/\\s]+)(?:/[^\\s]*)?`, "gi");
}

function sharesIn(body) {
	const text = typeof body === "string" ? body : "";
	const pattern = sharePattern();
	const out = [];
	let match;
	while ((match = pattern.exec(text)) !== null) {
		const verified = verifyShareToken({ version: match[1], token: match[2] });
		if (verified.ok) out.push({ version: match[1], token: match[2], imageId: verified.imageId });
	}
	return out;
}

function readToken(req) {
	if (typeof req.query?.token === "string" && req.query.token.trim()) return req.query.token.trim();
	const auth = String(req.headers?.authorization || "");
	return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

async function channel(client, req) {
	const slug = normalizeTag(req.params?.slug);
	if (!slug || PSEUDO.has(slug)) return { ok: false, status: 400, body: { error: "Invalid slug" } };
	const verified = verifyKioskToken(readToken(req));
	if (!verified.ok) return { ok: false, status: 401, body: { error: "Unauthorized", code: verified.error } };
	if (verified.slug !== slug) return { ok: false, status: 401, body: { error: "Unauthorized", code: "SLUG_MISMATCH" } };
	const row = await client.from("prsn_chat_threads").select("id,channel_slug,meta").eq("type", "channel").eq("channel_slug", slug).maybeSingle();
	if (row.error || !row.data?.id) return { ok: false, status: 404, body: { error: "Not found" } };
	const visibility = typeof row.data.meta?.visibility === "string" ? row.data.meta.visibility.trim().toLowerCase() : "";
	if (visibility === "private" || Number(row.data.id) !== verified.threadId) return { ok: false, status: 404, body: { error: "Not found" } };
	return { ok: true, channel: { id: Number(row.data.id) } };
}

function mediaType(meta) {
	const value = meta && typeof meta === "object" ? meta : {};
	return value.media_type === "video" && value.video ? "video" : "image";
}

export function createKioskRoutes({ client }) {
	const router = express.Router();

	router.get("/api/kiosk/:slug/viewers", async (req, res) => {
		const gate = await channel(client, req);
		if (!gate.ok) return res.status(gate.status).json(gate.body);
		try {
			const members = await client.from("prsn_chat_members").select("user_id").eq("thread_id", gate.channel.id);
			if (members.error) throw members.error;
			const ids = [...new Set((members.data || []).map((row) => Number(row.user_id)).filter((id) => id > 0))];
			if (!ids.length) return res.json({ users: [], windowMs: ONLINE_WINDOW_MS });
			const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
			const [users, profiles] = await Promise.all([
				client.from("prsn_users").select("id,meta").in("id", ids),
				client.from("prsn_user_profiles").select("user_id,user_name,avatar_url").in("user_id", ids)
			]);
			if (users.error) throw users.error;
			if (profiles.error) throw profiles.error;
			const profileById = new Map((profiles.data || []).map((row) => [Number(row.user_id), row]));
			const online = (users.data || []).filter((row) => {
				const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
				return meta.appear_offline !== true && meta.suspended !== true && typeof meta.presence_last_seen_at === "string" && meta.presence_last_seen_at >= since;
			}).map((row) => {
				const profile = profileById.get(Number(row.id));
				return {
					user_id: Number(row.id),
					user_name: profile?.user_name != null ? String(profile.user_name) : null,
					avatar_url: typeof profile?.avatar_url === "string" && profile.avatar_url.trim() ? profile.avatar_url.trim() : null
				};
			}).sort((a, b) => String(a.user_name || "").localeCompare(String(b.user_name || "")));
			return res.json({ users: online, windowMs: ONLINE_WINDOW_MS });
		} catch (error) {
			console.warn("[kiosk] viewers", error?.message || error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/kiosk/:slug/shares", async (req, res) => {
		const gate = await channel(client, req);
		if (!gate.ok) return res.status(gate.status).json(gate.body);
		try {
			const messages = await client.from("prsn_chat_messages").select("id,body").eq("thread_id", gate.channel.id).order("id", { ascending: false }).limit(SCAN);
			if (messages.error) throw messages.error;
			const found = [];
			const seen = new Set();
			for (const row of messages.data || []) {
				for (const share of sharesIn(row.body).reverse()) {
					if (seen.has(share.imageId)) continue;
					seen.add(share.imageId);
					found.push({ message_id: Number(row.id), ...share });
				}
			}
			const images = found.length ? await client.from("prsn_created_images").select("id,meta").in("id", found.map((item) => item.imageId)) : { data: [], error: null };
			if (images.error) throw images.error;
			const typeById = new Map((images.data || []).map((row) => [Number(row.id), mediaType(row.meta)]));
			return res.json({
				shares: found.map((item) => {
					const version = item.version || ACTIVE_SHARE_VERSION;
					const type = typeById.get(item.imageId) || "image";
					const imageUrl = `/api/share/${encodeURIComponent(version)}/${encodeURIComponent(item.token)}/image`;
					return { id: `${version}:${item.token}`, message_id: item.message_id, image_id: item.imageId, media_type: type, image_url: imageUrl, video_url: type === "video" ? imageUrl.replace(/\/image$/, "/video") : null };
				})
			});
		} catch (error) {
			console.warn("[kiosk] shares", error?.message || error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/kiosk/:slug/latest-share", async (req, res) => {
		const gate = await channel(client, req);
		if (!gate.ok) return res.status(gate.status).json(gate.body);
		try {
			const messages = await client.from("prsn_chat_messages").select("id,body").eq("thread_id", gate.channel.id).order("id", { ascending: false }).limit(SCAN);
			if (messages.error) throw messages.error;
			let found = null;
			for (const row of messages.data || []) {
				const share = sharesIn(row.body).at(-1);
				if (!share) continue;
				found = { message_id: Number(row.id), ...share };
				break;
			}
			if (!found) return res.json({ share: null });
			const image = await client.from("prsn_created_images").select("meta").eq("id", found.imageId).maybeSingle();
			const type = mediaType(image.data?.meta);
			const version = found.version || ACTIVE_SHARE_VERSION;
			const imageUrl = `/api/share/${encodeURIComponent(version)}/${encodeURIComponent(found.token)}/image`;
			return res.json({ share: { id: `${version}:${found.token}`, message_id: found.message_id, media_type: type, image_url: imageUrl, video_url: type === "video" ? imageUrl.replace(/\/image$/, "/video") : null } });
		} catch (error) {
			console.warn("[kiosk] latest-share", error?.message || error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
