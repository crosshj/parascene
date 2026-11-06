import express from "express";
import { createVynlyClient, VynlyApiError } from "./utils/vynlyClient.js";
import { getVynlyBearerToken, isVynlyConfiguredForUser } from "./utils/vynlyAuth.js";
import { shareCreationToVynly } from "./utils/vynlyShareFromCreation.js";

/**
 * @param {{ queries: object, storage: object }} deps
 */
export default function createVynlyRoutes({ queries, storage }) {
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
					tags: req.body?.tags,
					declaredSource: req.body?.declaredSource,
					width: req.body?.width,
					height: req.body?.height
				},
				client,
				token
			});

			let openUrl = "https://vynly.co/";
			if (result && typeof result === "object") {
				if (typeof result.url === "string" && result.url.trim()) {
					openUrl = result.url.trim();
				} else if (result.id != null) {
					openUrl = `https://vynly.co/?post=${encodeURIComponent(String(result.id))}`;
				}
			}

			return res.json({ ...(typeof result === "object" && result ? result : {}), openUrl });
		} catch (err) {
			return sendRouteError(res, err);
		}
	});

	return router;
}
