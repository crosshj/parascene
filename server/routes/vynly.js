import express from "express";
import { createVynlyClient, VynlyApiError } from "../services/vynly/vynlyClient.js";
import { getVynlyBearerToken, isVynlyConfiguredForUser } from "../services/vynly/vynlyAuth.js";
import { shareCreationToVynly } from "../services/vynly/vynlyShareFromCreation.js";

export function vynlyPostUrl(result) {
	if (!result || typeof result !== "object") return null;
	const id = result.id == null ? "" : String(result.id).trim();
	if (id) return `https://vynly.co/p/${encodeURIComponent(id)}`;
	try {
		const url = new URL(String(result.url || ""));
		if (url.protocol === "https:" && url.hostname === "vynly.co" && /^\/p\/[^/]+\/?$/.test(url.pathname)) return url.href;
	} catch { /* no direct post URL */ }
	return null;
}

/**
 * @param {{ queries: object, storage: object }} deps
 */
export default function createVynlyRoutes({ queries, storage, watermarkedVideoCache, comments }) {
	const router = express.Router();
	const client = createVynlyClient();

	async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		return user;
	}

	function requireVynlyToken(req, res, user) {
		const token = getVynlyBearerToken({ user });
		if (!token) {
			res.status(503).json({
				error: "Vynly is not configured",
				message: "Add your Vynly agent token in Profile to enable sharing to Vynly."
			});
			return null;
		}
		return token;
	}

	/**
	 * @param {import("express").Response} res
	 * @param {unknown} err
	 */
	function sendRouteError(res, err) {
		if (err instanceof VynlyApiError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			return res.status(status).json({
				error: err.message,
				detail: err.bodySnippet || undefined
			});
		}
		const statusFromErr =
			err && typeof err === "object" && "status" in err && typeof /** @type {{ status?: unknown }} */ (err).status === "number"
				? /** @type {{ status: number, message?: string }} */ (err).status
				: null;
		if (statusFromErr != null && statusFromErr >= 400 && statusFromErr < 600) {
			const msg =
				err instanceof Error
					? err.message
					: typeof /** @type {{ message?: string }} */ (err).message === "string"
						? /** @type {{ message: string }} */ (err).message
						: "Request failed";
			return res.status(statusFromErr).json({ error: msg });
		}
		return res.status(500).json({ error: "Unexpected error" });
	}

	router.get("/api/vynly/status", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		return res.json({ configured: isVynlyConfiguredForUser(user) });
	});

	router.get("/api/vynly/posts", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		try {
			const data = await client.getPosts(token, {
				before: req.query?.before,
				limit: req.query?.limit
			});
			return res.json(data);
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	router.get("/api/vynly/sparks", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		try {
			const data = await client.getSparks(token);
			return res.json(data);
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	router.get("/api/vynly/search", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		const q = typeof req.query?.q === "string" ? req.query.q : "";
		if (!q.trim()) {
			return res.status(400).json({ error: "Missing q" });
		}

		const extra = {};
		for (const key of Object.keys(req.query || {})) {
			if (key === "q") continue;
			const v = req.query[key];
			if (typeof v === "string") extra[key] = v;
		}

		try {
			const data = await client.getSearch(token, q, extra);
			return res.json(data);
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	router.post("/api/vynly/sparks", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		try {
			const data = await client.postSpark(token, req.body);
			return res.json(data);
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	router.post("/api/vynly/posts", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		try {
			const data = await client.postImageJson(token, req.body);
			return res.json(data);
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	router.delete("/api/vynly/creations/:creationId/posts", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const creationId = Number(req.params.creationId);
		if (!Number.isSafeInteger(creationId) || creationId <= 0) return res.status(400).json({ error: "Invalid creationId" });
		const rawUrl = typeof req.body?.url === "string" ? req.body.url : "";
		let postUrl;
		try {
			const url = new URL(rawUrl);
			if (url.protocol !== "https:" || url.hostname !== "vynly.co" || !/^\/p\/[^/]+\/?$/.test(url.pathname)) throw new Error("invalid");
			postUrl = url.href;
		} catch {
			return res.status(400).json({ error: "Invalid Vynly post URL" });
		}
		try {
			const image = await queries.selectCreatedImageById?.get(creationId, user.id);
			if (!image) return res.status(404).json({ error: "Creation not found" });
			const meta = image.meta && typeof image.meta === "object" && !Array.isArray(image.meta)
				? { ...image.meta }
				: typeof image.meta === "string" ? (() => { try { const value = JSON.parse(image.meta); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } })() : {};
			const vynly = meta.vynly && typeof meta.vynly === "object" && !Array.isArray(meta.vynly) ? { ...meta.vynly } : {};
			const posts = Array.isArray(vynly.posts) ? vynly.posts.filter((post) => post && post.url !== postUrl) : [];
			if (posts.length) vynly.posts = posts;
			else delete vynly.posts;
			if (Object.keys(vynly).length) meta.vynly = vynly;
			else delete meta.vynly;
			if (typeof queries.updateCreatedImageMeta?.run !== "function") return res.status(503).json({ error: "Creation metadata is unavailable" });
			await queries.updateCreatedImageMeta.run(creationId, user.id, meta);
			return res.json({ ok: true });
		} catch (err) {
			return sendRouteError(res, err);
		}
	});


	router.post("/api/vynly/share-from-creation", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const token = requireVynlyToken(req, res, user);
		if (!token) return;

		const creationId = Number(req.body?.creationId);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creationId" });
		}

		try {
			const result = await shareCreationToVynly({
				queries,
				storage,
				user,
				creationId,
				options: {
					caption: req.body?.caption,
					preparedVideoId: req.body?.preparedVideoId,
					tags: req.body?.tags,
					declaredSource: req.body?.declaredSource,
					width: req.body?.width,
					height: req.body?.height
				},
				client,
				videoCache: watermarkedVideoCache,
				comments,
				token
			});

			return res.json({ ...(typeof result === "object" && result ? result : {}), openUrl: vynlyPostUrl(result) });
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	return router;
}
