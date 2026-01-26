import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";

export default function createAdminRoutes({ queries }) {
	const router = express.Router();

	async function requireAdmin(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		if (user.role !== 'admin') {
			res.status(403).json({ error: "Forbidden: Admin role required" });
			return null;
		}

		return user;
	}

	router.get("/admin/users", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const users = await queries.selectUsers.all();

		// Fetch credits for each user
		const usersWithCredits = await Promise.all(
			users.map(async (user) => {
				const credits = await queries.selectUserCredits.get(user.id);
				return {
					...user,
					credits: credits?.balance ?? 0
				};
			})
		);

		res.json({ users: usersWithCredits });
	});

	router.get("/admin/moderation", async (req, res) => {
		const items = await queries.selectModerationQueue.all();
		res.json({ items });
	});

	router.get("/admin/providers", async (req, res) => {
		const providers = await queries.selectProviders.all();
		res.json({ providers });
	});

	router.get("/admin/policies", async (req, res) => {
		const policies = await queries.selectPolicies.all();
		res.json({ policies });
	});

	router.get("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		res.json({ server });
	});

	router.put("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const payload = req.body || {};

		const nextServer = {
			...server
		};

		if (payload.user_id !== undefined) {
			const nextUserId = Number(payload.user_id);
			if (!Number.isFinite(nextUserId) || nextUserId <= 0) {
				return res.status(400).json({ error: "user_id must be a positive number when provided" });
			}
			nextServer.user_id = nextUserId;
		}

		if (payload.name !== undefined) {
			const nextName = String(payload.name || "").trim();
			if (!nextName) {
				return res.status(400).json({ error: "name must be a non-empty string when provided" });
			}
			nextServer.name = nextName;
		}

		if (payload.status !== undefined) {
			const nextStatus = String(payload.status || "").trim();
			if (!nextStatus) {
				return res.status(400).json({ error: "status must be a non-empty string when provided" });
			}
			nextServer.status = nextStatus;
		}

		if (payload.server_url !== undefined) {
			if (typeof payload.server_url !== "string" || payload.server_url.trim() === "") {
				return res.status(400).json({ error: "server_url must be a non-empty string when provided" });
			}
			let providerUrl;
			try {
				providerUrl = new URL(payload.server_url.trim());
				if (!['http:', 'https:'].includes(providerUrl.protocol)) {
					return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
				}
			} catch (urlError) {
				return res.status(400).json({ error: "server_url must be a valid URL" });
			}
			nextServer.server_url = providerUrl.toString().replace(/\/$/, '');
		}

		if (payload.auth_token !== undefined) {
			if (payload.auth_token !== null && typeof payload.auth_token !== "string") {
				return res.status(400).json({ error: "auth_token must be a string when provided" });
			}
			nextServer.auth_token = resolveProviderAuthToken(payload.auth_token);
		}

		if (payload.status_date !== undefined) {
			nextServer.status_date = payload.status_date || null;
		}

		if (payload.description !== undefined) {
			nextServer.description = payload.description || null;
		}

		if (payload.members_count !== undefined) {
			const nextMembersCount = Number(payload.members_count);
			if (!Number.isFinite(nextMembersCount) || nextMembersCount < 0) {
				return res.status(400).json({ error: "members_count must be a non-negative number when provided" });
			}
			nextServer.members_count = Math.floor(nextMembersCount);
		}

		if (payload.server_config !== undefined) {
			nextServer.server_config = payload.server_config || null;
		}

		const updateResult = await queries.updateServer.run(serverId, nextServer);
		if (updateResult.changes === 0) {
			return res.status(500).json({ error: "Failed to update server" });
		}

		return res.status(200).json({
			success: true,
			server: nextServer
		});
	});

	router.post("/admin/servers/:id/test", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			return res.status(200).json({
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	router.post("/admin/servers/:id/refresh", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			// Update server config in database
			const updateResult = await queries.updateServerConfig.run(serverId, capabilities);

			if (updateResult.changes === 0) {
				return res.status(500).json({
					error: "Failed to update server configuration"
				});
			}

			return res.status(200).json({
				success: true,
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	return router;
}
