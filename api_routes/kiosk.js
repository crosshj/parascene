import express from "express";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";
import { mintKioskToken, verifyKioskToken } from "./utils/kioskToken.js";
import { verifyShareToken, ACTIVE_SHARE_VERSION } from "./utils/shareLink.js";
import { SHARE_HOSTNAME } from "./utils/url.js";

/** Same online window as api_routes/presence.js */
const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

const PSEUDO_CHANNEL_SLUGS = new Set(["comments", "feed", "explore", "creations"]);

/** How many recent messages to scan for a share URL. */
const LATEST_SHARE_SCAN_LIMIT = 100;

const SHARE_URL_RE = new RegExp(
	`https?://${SHARE_HOSTNAME.replace(/\./g, "\\.")}/s/([^/\\s]+)/([^/\\s]+)(?:/[^\\s]*)?`,
	"gi"
);

function threadIsPublic(meta) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return true;
	const raw = typeof meta.visibility === "string" ? meta.visibility.trim().toLowerCase() : "";
	return raw !== "private";
}

/**
 * Resolve an existing public hashtag channel by slug (does not create).
 * @returns {Promise<{ id: number, channel_slug: string } | null>}
 */
export async function findPublicChannelBySlug(slugInput) {
	const slug = normalizeTag(slugInput);
	if (!slug || PSEUDO_CHANNEL_SLUGS.has(slug)) return null;

	const sb = getSupabaseServiceClient();
	if (!sb) return null;

	const { data, error } = await sb
		.from("prsn_chat_threads")
		.select("id, channel_slug, meta")
		.eq("type", "channel")
		.eq("channel_slug", slug)
		.maybeSingle();

	if (error || !data?.id) return null;
	if (!threadIsPublic(data.meta)) return null;

	return {
		id: Number(data.id),
		channel_slug: String(data.channel_slug || slug).toLowerCase()
	};
}

export { mintKioskToken };

/**
 * @param {string} body
 * @returns {{ version: string, token: string } | null} last valid share in the body
 */
function findLastShareInBody(body) {
	const text = typeof body === "string" ? body : "";
	if (!text) return null;
	SHARE_URL_RE.lastIndex = 0;
	let last = null;
	let m;
	while ((m = SHARE_URL_RE.exec(text)) !== null) {
		const version = String(m[1] || "").trim();
		const token = String(m[2] || "").trim();
		if (!version || !token) continue;
		const verified = verifyShareToken({ version, token });
		if (!verified.ok) continue;
		last = { version, token, imageId: verified.imageId };
	}
	return last;
}

function parseImageMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function readKioskToken(req) {
	if (typeof req.query?.token === "string" && req.query.token.trim()) {
		return req.query.token.trim();
	}
	const auth = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
	if (auth.toLowerCase().startsWith("bearer ")) {
		return auth.slice(7).trim();
	}
	return "";
}

/**
 * @returns {{ ok: true, slug: string, channel: { id: number, channel_slug: string } } | { ok: false, status: number, body: object }}
 */
async function requireKioskChannel(req) {
	const slug = normalizeTag(req.params?.slug);
	if (!slug) {
		return { ok: false, status: 400, body: { error: "Invalid slug" } };
	}

	const verified = verifyKioskToken(readKioskToken(req));
	if (!verified.ok) {
		return { ok: false, status: 401, body: { error: "Unauthorized", code: verified.error } };
	}
	if (verified.slug !== slug) {
		return { ok: false, status: 401, body: { error: "Unauthorized", code: "SLUG_MISMATCH" } };
	}

	const channel = await findPublicChannelBySlug(slug);
	if (!channel || channel.id !== verified.threadId) {
		return { ok: false, status: 404, body: { error: "Not found" } };
	}

	return { ok: true, slug, channel };
}

export default function createKioskRoutes({ queries }) {
	const router = express.Router();

	/**
	 * GET /api/kiosk/:slug/viewers?token=...
	 * Requires scoped kiosk token. Returns channel members who are presence-online.
	 */
	router.get("/api/kiosk/:slug/viewers", async (req, res) => {
		const gate = await requireKioskChannel(req);
		if (!gate.ok) return res.status(gate.status).json(gate.body);

		try {
			const sb = getSupabaseServiceClient();
			if (!sb) {
				return res.status(503).json({ error: "Unavailable" });
			}

			const { data: memRows, error: memErr } = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", gate.channel.id);
			if (memErr) throw memErr;

			const memberIds = [
				...new Set(
					(memRows || [])
						.map((r) => Number(r.user_id))
						.filter((n) => Number.isFinite(n) && n > 0)
				)
			];
			if (memberIds.length === 0) {
				return res.json({ users: [], windowMs: PRESENCE_ONLINE_WINDOW_MS });
			}

			const sinceIso = new Date(Date.now() - PRESENCE_ONLINE_WINDOW_MS).toISOString();

			const [usersById, profilesById] = await Promise.all([
				typeof queries.selectUsersByIds === "function"
					? queries.selectUsersByIds(memberIds)
					: Promise.resolve(new Map()),
				typeof queries.selectUserProfilesByUserIds === "function"
					? queries.selectUserProfilesByUserIds(memberIds)
					: Promise.resolve(new Map())
			]);

			const users = [];
			for (const id of memberIds) {
				const row = usersById?.get?.(id);
				if (!row) continue;
				const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
				if (meta.appear_offline === true) continue;
				if (meta.suspended === true || row.suspended === true) continue;
				const seen =
					typeof meta.presence_last_seen_at === "string" ? meta.presence_last_seen_at.trim() : "";
				if (!seen || seen < sinceIso) continue;

				const profile = profilesById?.get?.(id);
				users.push({
					user_id: id,
					user_name: profile?.user_name != null ? String(profile.user_name) : null,
					avatar_url:
						typeof profile?.avatar_url === "string" && profile.avatar_url.trim()
							? profile.avatar_url.trim()
							: null
				});
			}

			users.sort((a, b) => String(a.user_name || "").localeCompare(String(b.user_name || "")));

			return res.json({ users, windowMs: PRESENCE_ONLINE_WINDOW_MS });
		} catch (err) {
			console.warn("[kiosk] viewers", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	/**
	 * GET /api/kiosk/:slug/latest-share?token=...
	 * Latest share link in recent channel messages (newest message wins).
	 */
	router.get("/api/kiosk/:slug/latest-share", async (req, res) => {
		const gate = await requireKioskChannel(req);
		if (!gate.ok) return res.status(gate.status).json(gate.body);

		try {
			const sb = getSupabaseServiceClient();
			if (!sb) {
				return res.status(503).json({ error: "Unavailable" });
			}

			const { data: rows, error } = await sb
				.from("prsn_chat_messages")
				.select("id, body, created_at")
				.eq("thread_id", gate.channel.id)
				.order("id", { ascending: false })
				.limit(LATEST_SHARE_SCAN_LIMIT);
			if (error) throw error;

			let found = null;
			for (const row of rows || []) {
				const share = findLastShareInBody(row?.body);
				if (!share) continue;
				found = {
					message_id: Number(row.id),
					version: share.version,
					token: share.token,
					image_id: share.imageId
				};
				break;
			}

			if (!found) {
				return res.json({ share: null });
			}

			let mediaType = "image";
			const image = await queries.selectCreatedImageByIdAnyUser?.get(found.image_id);
			if (image) {
				const meta = parseImageMeta(image.meta);
				const mt = typeof meta?.media_type === "string" ? meta.media_type.trim().toLowerCase() : "";
				if (mt === "video" && meta?.video) {
					mediaType = "video";
				}
			}

			const version = found.version || ACTIVE_SHARE_VERSION;
			const token = found.token;
			const imageUrl = `/api/share/${encodeURIComponent(version)}/${encodeURIComponent(token)}/image`;
			const videoUrl =
				mediaType === "video"
					? `/api/share/${encodeURIComponent(version)}/${encodeURIComponent(token)}/video`
					: null;

			return res.json({
				share: {
					message_id: found.message_id,
					media_type: mediaType,
					image_url: imageUrl,
					video_url: videoUrl
				}
			});
		} catch (err) {
			console.warn("[kiosk] latest-share", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
