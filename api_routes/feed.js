/**
 * Feed API routes (`GET /api/feed`, `GET /api/feed/challenge-engagement`, `POST /api/feed/impressions`, `POST /api/feed/impression`, `GET /api/feed/doom`, `GET /api/feed/version`).
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
import { loadFeedBetaSeenSetForUser } from "./feedBeta/seen.js";
import { addFeedBetaSeenIdsToRedis } from "./feedBeta/seenRedis.js";
import { parseFeedImpressionBody, parseFeedImpressionsBatchBody } from "./feedBeta/userCreationSeen.js";
import { createFeedTiming, wrapTimedPromise } from "./feed/feedTiming.js";
import { buildChallengeEngagementFeedItemForViewer } from "./feed/challengeEngagementItem.js";
import { primeFeedBetaRedisFromPipeline } from "./feedBeta/feedBetaRedisBundle.js";

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

		const requestT0 = Number(req._feedRequestT0) || performance.now();
		const userLoadStart = performance.now();
		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const useFeedBeta = canAccessFeedBeta(user);
		const timing = useFeedBeta ? createFeedTiming(requestT0) : null;
		timing?.add("pre_handler", userLoadStart - requestT0);
		timing?.add("user", performance.now() - userLoadStart);
		try {
			const sb = getSupabaseServiceClient();
			if (sb) {
				void removeJoinedPrivateChannelInviteDmMessages({ sb, userId: user.id }).catch(
					(cleanupErr) => {
						console.warn(
							'[GET /api/feed] invite DM cleanup',
							cleanupErr?.message || cleanupErr
						);
					}
				);
			}
		} catch (cleanupErr) {
			console.warn('[GET /api/feed] invite DM cleanup', cleanupErr?.message || cleanupErr);
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

		const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
		const feedBetaAck = useFeedBeta ? parseFeedBetaAckFromQuery(req.query) : null;
		const feedSurface = String(req.query?.feed_surface || '').trim();
		const isChatSurface = feedSurface.toLowerCase() === 'chat';

		let creationPull;
		let challengeSnapshot = { ok: false };
		if (useFeedBeta) {
			await primeFeedBetaRedisFromPipeline(user.id, timing, {
				includeChallenge: !isChatSurface
			});
			const refreshBeta =
				String(req.query?.refresh ?? '').trim() === '1' ||
				(offset === 0 && !hasImageCursor && (!slotPack || offset === 0) && !feedBetaAck);
			const likelyAssemblyPageOne =
				offset === 0 && !hasImageCursor && !feedBetaAck;
			const pullChallengePromise =
				likelyAssemblyPageOne && !isChatSurface
					? wrapTimedPromise(
							timing,
							'challenge_snapshot',
							pullChallengeFeedSnapshot({ viewerUserId: user.id, queries }).catch(() => ({
								ok: false
							}))
						)
					: Promise.resolve({ ok: false });
			const pullRowsPromise = wrapTimedPromise(
				timing,
				'pull.rows_total',
				pullFeedBetaRows({
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
					feedBetaAck,
					timing
				})
			);
			const parallelWallStart = performance.now();
			const [pull, challenge] = await Promise.all([pullRowsPromise, pullChallengePromise]);
			const parallelWallKey =
				likelyAssemblyPageOne && !isChatSurface
					? 'pull.rows_and_challenge_wall'
					: 'pull.rows_wall';
			timing?.add(parallelWallKey, performance.now() - parallelWallStart);
			creationPull = pull;
			challengeSnapshot = challenge;
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
			creationPull,
			feedSurface
		});

		if (!useFeedBeta && assembleOpts.fetchChallengeSnapshot) {
			try {
				challengeSnapshot = await pullChallengeFeedSnapshot({
					viewerUserId: user.id,
					queries
				});
			} catch {
				challengeSnapshot = { ok: false };
			}
		}

		const { items, hasMore } = await (timing
			? timing.timeAsync('assemble.total', () =>
					assembleFeedItems({
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
						includeEditorialPin: assembleOpts.includeEditorialPin,
						timing
					})
				)
			: assembleFeedItems({
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
				}));

		const body = timing
			? timing.time("handler.finalize", () => {
					const out = { items, hasMore };
					const betaCursor = creationPull?.feedBetaPageCursor ?? creationPull?.slotPackFeedCursor;
					if (betaCursor) {
						out.feed_cursor = {
							after_image_created_at: betaCursor.created_at,
							after_image_id: String(betaCursor.created_image_id)
						};
					}
					if (creationPull?.feedBetaContinuation) {
						out.feed_beta = creationPull.feedBetaContinuation;
					}
					return out;
				})
			: (() => {
					const out = { items, hasMore };
					const betaCursor = creationPull?.feedBetaPageCursor ?? creationPull?.slotPackFeedCursor;
					if (betaCursor) {
						out.feed_cursor = {
							after_image_created_at: betaCursor.created_at,
							after_image_id: String(betaCursor.created_image_id)
						};
					}
					if (creationPull?.feedBetaContinuation) {
						out.feed_beta = creationPull.feedBetaContinuation;
					}
					return out;
				})();

		if (timing) {
			const meta = creationPull?.feedBetaTimingMeta ?? {};
			timing.time("handler.json_stringify", () =>
				JSON.stringify({
					...body,
					feed_timing: {
						total_ms: 0,
						server_handler_ms: 0,
						segments: {}
					}
				})
			);
			const feedTiming = timing.finish({
				page_index: meta.pageIndex ?? null,
				slot_pack_page_one: meta.slotPackPageOne === true,
				catalog_from_snapshot: meta.fromSnapshot === true,
				catalog_size: meta.catalogSize ?? null,
				row_count: meta.rowCount ?? items.length,
				pre_handler_includes:
					"session lookup, rate limits, and other middleware before the feed route handler",
				client_network_hint:
					"Browser Network duration also includes TLS/RTT and downloading the response body; compare Network time minus server_handler_ms."
			});
			body.feed_timing = feedTiming;
			feedTiming.response_bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
			res.setHeader("Server-Timing", `feed;dur=${feedTiming.total_ms}`);
		}
		return res.json(body);
	});

	router.get("/api/feed/challenge-engagement", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		try {
			await primeFeedBetaRedisFromPipeline(user.id, null, { includeChallenge: true });
			const item = await buildChallengeEngagementFeedItemForViewer(queries, user.id);
			return res.json({ item: item ?? null });
		} catch (err) {
			console.warn("[GET /api/feed/challenge-engagement]", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/feed/impressions", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		if (!canAccessFeedBeta(user)) {
			return res.status(403).json({ error: "Feed beta not enabled" });
		}
		const items = parseFeedImpressionsBatchBody(req.body);
		if (items.length === 0) {
			return res.status(400).json({ error: "Invalid or empty items" });
		}
		try {
			const added = await addFeedBetaSeenIdsToRedis(
				user.id,
				items.map((item) => item.creationId)
			);
			return res.json({ ok: true, processed: items.length, added });
		} catch (err) {
			console.warn("[POST /api/feed/impressions]", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/feed/impression", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		if (!canAccessFeedBeta(user)) {
			return res.status(403).json({ error: "Feed beta not enabled" });
		}
		const parsed = parseFeedImpressionBody(req.body);
		if (!parsed) {
			return res.status(400).json({ error: "Invalid creation_id" });
		}
		try {
			const added = await addFeedBetaSeenIdsToRedis(user.id, [parsed.creationId]);
			return res.json({ ok: true, added: added > 0 });
		} catch (err) {
			console.warn("[POST /api/feed/impression]", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
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
