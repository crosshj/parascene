import express from "express";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { normalizeTag } from "./utils/tag.js";
import { mintKioskToken, verifyKioskToken } from "./utils/kioskToken.js";

/** Same online window as api_routes/presence.js */
const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

const PSEUDO_CHANNEL_SLUGS = new Set(["comments", "feed", "explore", "creations"]);

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

export default function createKioskRoutes({ queries }) {
	const router = express.Router();

	/**
	 * GET /api/kiosk/:slug/viewers?token=...
	 * Requires scoped kiosk token. Returns channel members who are presence-online.
	 */
	router.get("/api/kiosk/:slug/viewers", async (req, res) => {
		const slug = normalizeTag(req.params?.slug);
		if (!slug) {
			return res.status(400).json({ error: "Invalid slug" });
		}

		const tokenRaw =
			typeof req.query?.token === "string"
				? req.query.token.trim()
				: typeof req.headers?.authorization === "string" &&
					  req.headers.authorization.toLowerCase().startsWith("bearer ")
					? req.headers.authorization.slice(7).trim()
					: "";

		const verified = verifyKioskToken(tokenRaw);
		if (!verified.ok) {
			return res.status(401).json({ error: "Unauthorized", code: verified.error });
		}
		if (verified.slug !== slug) {
			return res.status(401).json({ error: "Unauthorized", code: "SLUG_MISMATCH" });
		}

		try {
			const channel = await findPublicChannelBySlug(slug);
			if (!channel || channel.id !== verified.threadId) {
				return res.status(404).json({ error: "Not found" });
			}

			const sb = getSupabaseServiceClient();
			if (!sb) {
				return res.status(503).json({ error: "Unavailable" });
			}

			const { data: memRows, error: memErr } = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", channel.id);
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

	return router;
}
