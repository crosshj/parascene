/**
 * Feed API routes (`GET /api/feed`, `GET /api/feed/version`).
 *
 * Pipeline overview:
 *   1. Pull creation rows (followed → explore → newbie fallback), or slot-pack / cursor pulls — `./feed/pullCreationFeedRows.js`, `./feed/pullMobileChatSlotPackFeed.js`
 *   2. On first page: optional challenge snapshot for engagement card — `./feed/pullChallengeFeedSnapshot.js`
 *   3. Assemble JSON (`transform`, NSFW, blog merge, engagement merge, newbie tips) — `./feed/assembleFeedItems.js`
 */
import express from "express";
import { pullCreationFeedRows } from "./feed/pullCreationFeedRows.js";
import {
	pullCreationFeedRowsAfterImageCursor,
	pullMobileChatSlotPackFeedPageOne
} from "./feed/pullMobileChatSlotPackFeed.js";
import { pullVideoFeedRows } from "./feed/pullVideoFeedRows.js";
import { pullChallengeFeedSnapshot } from "./feed/pullChallengeFeedSnapshot.js";
import { assembleFeedItems } from "./feed/assembleFeedItems.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { removeJoinedPrivateChannelInviteDmMessages } from "./utils/chatInviteCleanup.js";

export default function createFeedRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/feed/version", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (!queries.selectPolicyByKey?.get) {
			return res.json({ key: "version_feed", version: 0, updated_at: null });
		}
		try {
			const row = await queries.selectPolicyByKey.get("version_feed");
			const parsed = Number.parseInt(String(row?.value ?? "0"), 10);
			const version = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
			return res.json({
				key: "version_feed",
				version,
				updated_at: row?.updated_at || null
			});
		} catch (err) {
			console.warn("[feed] version", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/feed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		try {
			const sb = getSupabaseServiceClient();
			if (sb) {
				await removeJoinedPrivateChannelInviteDmMessages({ sb, userId: user.id });
			}
		} catch (cleanupErr) {
			console.warn("[GET /api/feed] invite DM cleanup", cleanupErr?.message || cleanupErr);
		}

		const limit = Math.min(Math.max(1, Number(req.query?.limit) || 20), 100);
		const offset = Math.max(0, Number(req.query?.offset) || 0);
		const showOwnPostsInFeed = Boolean(user.meta && user.meta.showOwnPostsInFeed === true);
		const slotPack = String(req.query?.slot_pack || "").trim() === "mobile_chat_v1";
		const videosOnly = String(req.query?.creation_media || "").trim() === "video";
		const afterAt = req.query?.feed_after_image_created_at;
		const afterId = req.query?.feed_after_image_id;
		const afterIdNum = Number.parseInt(String(afterId ?? ""), 10);
		/* Chat load-more after slot-pack page one: cursor without `slot_pack` (plain feed older than boundary). */
		const hasImageCursor =
			afterAt != null &&
			String(afterAt).length > 0 &&
			Number.isFinite(afterIdNum) &&
			afterIdNum > 0;

		let creationPull;
		if (videosOnly) {
			creationPull = await pullVideoFeedRows({
				queries,
				userId: user.id,
				limit,
				offset,
				showOwnPosts: showOwnPostsInFeed
			});
		} else if (hasImageCursor) {
			creationPull = await pullCreationFeedRowsAfterImageCursor({
				queries,
				userId: user.id,
				limit,
				showOwnPosts: showOwnPostsInFeed,
				afterCreatedAt: String(afterAt),
				afterCreatedImageId: afterIdNum
			});
		} else if (slotPack && offset === 0) {
			creationPull = await pullMobileChatSlotPackFeedPageOne({
				queries,
				userId: user.id,
				limit,
				showOwnPosts: showOwnPostsInFeed,
				enableNsfw: Boolean(user.meta && user.meta.enableNsfw === true)
			});
		} else {
			creationPull = await pullCreationFeedRows({
				queries,
				userId: user.id,
				limit,
				offset,
				showOwnPosts: showOwnPostsInFeed
			});
		}

		let challengeSnapshot = { ok: false };
		if (offset === 0) {
			try {
				challengeSnapshot = await pullChallengeFeedSnapshot({
					viewerUserId: user.id,
					queries
				});
			} catch {
				challengeSnapshot = { ok: false };
			}
		}

		const feedSurface = String(req.query?.feed_surface || "").trim();

		const { items, hasMore } = await assembleFeedItems({
			queries,
			user,
			limit,
			offset,
			creationPull,
			challengeSnapshot,
			feedSurface
		});

		const body = { items, hasMore };
		if (creationPull?.slotPackFeedCursor) {
			const c = creationPull.slotPackFeedCursor;
			body.feed_cursor = {
				after_image_created_at: c.created_at,
				after_image_id: String(c.created_image_id)
			};
		}
		return res.json(body);
	});

	return router;
}
