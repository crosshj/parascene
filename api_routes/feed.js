/**
 * Feed API routes (`GET /api/feed`, `GET /api/feed/doom`, `GET /api/feed/version`).
 *
 * `/api/feed` — chat feed (followed, slot-pack, cursor tail). `./feed/pullCreationFeedRows.js`, `./feed/pullMobileChatSlotPackFeed.js`
 * `/api/feed/doom` — site-wide video timeline for doom scroll. `./feed/pullDoomFeedRows.js`
 * `/api/feed/doom` items are transformed in `pullDoomFeedRows` / `assembleFeedItems` (not re-mapped here).
 */
import express from "express";
import { pullCreationFeedRows } from "./feed/pullCreationFeedRows.js";
import {
	pullCreationFeedRowsAfterImageCursor,
	pullMobileChatSlotPackFeedPageOne
} from "./feed/pullMobileChatSlotPackFeed.js";
import { pullDoomFeedRows } from "./feed/pullDoomFeedRows.js";
import { pullChallengeFeedSnapshot } from "./feed/pullChallengeFeedSnapshot.js";
import { assembleFeedItems } from "./feed/assembleFeedItems.js";
import { resolveFeedAssembleOptions } from "./feed/resolveFeedAssemble.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { removeJoinedPrivateChannelInviteDmMessages } from "./utils/chatInviteCleanup.js";
import { canAccessFeedBeta } from "./feedBeta/access.js";
import { pullFeedBetaRows } from "./feedBeta/pullFeedBetaRows.js";
import { parseFeedBetaAckFromQuery } from "./feedBeta/continuation.js";

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
		const afterAt = req.query?.feed_after_image_created_at;
		const afterId = req.query?.feed_after_image_id;
		const afterIdNum = Number.parseInt(String(afterId ?? ""), 10);
		/* Chat load-more after slot-pack page one: cursor without `slot_pack` (plain feed older than boundary). */
		const hasImageCursor =
			afterAt != null &&
			String(afterAt).length > 0 &&
			Number.isFinite(afterIdNum) &&
			afterIdNum > 0;

		const useFeedBeta = canAccessFeedBeta(user);
		const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
		const feedBetaAck = useFeedBeta ? parseFeedBetaAckFromQuery(req.query) : null;

		let creationPull;
		if (useFeedBeta) {
			const refreshBeta =
				String(req.query?.refresh ?? '').trim() === '1' ||
				(offset === 0 && !hasImageCursor && (!slotPack || offset === 0) && !feedBetaAck);
			creationPull = await pullFeedBetaRows({
				queries,
				user,
				limit,
				offset,
				slotPack,
				afterAt: afterAt != null ? String(afterAt) : undefined,
				afterIdNum,
				enableNsfw,
				showOwnPosts: showOwnPostsInFeed,
				refresh: refreshBeta,
				feedBetaAck
			});
			const servedIds = creationPull?.feedBetaServedIds;
			if (Array.isArray(servedIds) && servedIds.length > 0 && queries.updateUserFeedBetaSeen?.run) {
				try {
					await queries.updateUserFeedBetaSeen.run(user.id, servedIds);
				} catch (err) {
					console.warn('[feed] feedBeta seen', err?.message || err);
				}
			}
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
				enableNsfw
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

		const assembleOpts = resolveFeedAssembleOptions({
			useFeedBeta,
			offset,
			hasImageCursor,
			feedBetaAck,
			afterAt: afterAt != null ? String(afterAt) : undefined,
			afterIdNum,
			creationPull
		});

		let challengeSnapshot = { ok: false };
		if (assembleOpts.fetchChallengeSnapshot) {
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
			feedSurface,
			includeBlogMerge: assembleOpts.includeBlogMerge,
			includeChallengeEngagement:
				assembleOpts.includeChallengeEngagement &&
				challengeSnapshot?.ok &&
				challengeSnapshot.active,
			includeEditorialPin: assembleOpts.includeEditorialPin
		});

		const body = { items, hasMore };
		const betaCursor = creationPull?.feedBetaPageCursor ?? creationPull?.slotPackFeedCursor;
		if (betaCursor) {
			body.feed_cursor = {
				after_image_created_at: betaCursor.created_at,
				after_image_id: String(betaCursor.created_image_id)
			};
		}
		if (creationPull?.feedBetaContinuation) {
			body.feed_beta = creationPull.feedBetaContinuation;
		}
		return res.json(body);
	});

	router.get("/api/feed/doom", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		const limit = Math.min(Math.max(1, Number(req.query?.limit) || 20), 100);
		const startCreationId = Number.parseInt(String(req.query?.start ?? ""), 10);
		const afterCreatedImageId = Number.parseInt(String(req.query?.after_created_image_id ?? ""), 10);
		const mode = Number.isFinite(startCreationId) && startCreationId > 0
			? "from_anchor"
			: Number.isFinite(afterCreatedImageId) && afterCreatedImageId > 0
				? "older_than"
				: "head";
		const showOwnPostsInFeed = Boolean(user.meta && user.meta.showOwnPostsInFeed === true);
		const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
		const pull = await pullDoomFeedRows({
			queries,
			viewerId: user.id,
			user,
			limit,
			mode,
			startCreationId,
			afterCreatedImageId,
			enableNsfw,
			showOwnPosts: showOwnPostsInFeed
		});
		const items = (pull.rows ?? []).filter((item) => (enableNsfw ? true : !item.nsfw));
		return res.json({
			items,
			hasMore: Boolean(pull.hasMore),
			cursor: pull.cursor ?? null
		});
	});

	return router;
}
