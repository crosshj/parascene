/**
 * Feed API routes (`GET /api/feed`, `GET /api/feed/version`).
 *
 * Pipeline overview:
 *   1. Pull creation rows (followed → explore → newbie fallback) — `./feed/pullCreationFeedRows.js`
 *   2. On first page: optional challenge snapshot for engagement card — `./feed/pullChallengeFeedSnapshot.js`
 *   3. Assemble JSON (`transform`, NSFW, blog merge, engagement merge, newbie tips) — `./feed/assembleFeedItems.js`
 */
import express from "express";
import { pullCreationFeedRows } from "./feed/pullCreationFeedRows.js";
import { pullChallengeFeedSnapshot } from "./feed/pullChallengeFeedSnapshot.js";
import { assembleFeedItems } from "./feed/assembleFeedItems.js";

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

		const limit = Math.min(Math.max(1, Number(req.query?.limit) || 20), 100);
		const offset = Math.max(0, Number(req.query?.offset) || 0);
		const showOwnPostsInFeed = Boolean(user.meta && user.meta.showOwnPostsInFeed === true);

		const creationPull = await pullCreationFeedRows({
			queries,
			userId: user.id,
			limit,
			offset,
			showOwnPosts: showOwnPostsInFeed
		});

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

		const { items, hasMore } = await assembleFeedItems({
			queries,
			user,
			limit,
			offset,
			creationPull,
			challengeSnapshot
		});

		return res.json({ items, hasMore });
	});

	return router;
}
