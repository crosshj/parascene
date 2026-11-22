import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "../services/create/providerAuth.js";

async function loadUser(client, req, res) {
	if (!req.auth?.userId) {
		res.status(401).json({ error: "Unauthorized" });
		return null;
	}
	const result = await client.from("prsn_users").select("id,email,role").eq("id", req.auth.userId).maybeSingle();
	if (result.error || !result.data) {
		res.status(result.data ? 500 : 404).json({ error: result.data ? "Failed to load user" : "User not found" });
		return null;
	}
	return result.data;
}

function providerUrl(raw, res) {
	if (typeof raw !== "string" || !raw.trim()) {
		res.status(400).json({ error: "server_url is required and must be a non-empty string" });
		return null;
	}
	try {
		const url = new URL(raw.trim());
		if (!["http:", "https:"].includes(url.protocol)) {
			res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
			return null;
		}
		return url.toString().replace(/\/$/, "");
	} catch {
		res.status(400).json({ error: "server_url must be a valid URL" });
		return null;
	}
}

async function readCapabilities(url, token, res) {
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: buildProviderHeaders({ Accept: "application/json" }, token),
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) {
			res.status(400).json({ error: `Provider server returned error: ${response.status} ${response.statusText}`, server_url: url });
			return null;
		}
		const capabilities = await response.json();
		if (!capabilities?.methods || typeof capabilities.methods !== "object") {
			res.status(400).json({ error: "Provider server response missing or invalid 'methods' field", server_url: url });
			return null;
		}
		return capabilities;
	} catch (error) {
		res.status(400).json({
			error: error?.name === "AbortError" ? "Provider server did not respond within 10 seconds" : `Failed to connect to provider server: ${error.message}`,
			server_url: url
		});
		return null;
	}
}

export function createProviderRoutes({ client }) {
	const router = express.Router();
	for (const [path, key] of [["/api/provider/status", "statuses"], ["/api/provider/metrics", "metrics"], ["/api/provider/grants", "grants"], ["/api/provider/templates-hosted", "templates"]]) {
		router.get(path, async (req, res) => {
			if (!(await loadUser(client, req, res))) return;
			return res.json({ [key]: [] });
		});
	}

	router.post("/api/provider/register", async (req, res) => {
		const user = await loadUser(client, req, res);
		if (!user) return;
		if (user.role !== "admin" && user.role !== "provider") return res.status(403).json({ error: "Forbidden: Admin or Provider role required" });
		const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
		if (!name) return res.status(400).json({ error: "name is required and must be a non-empty string" });
		if (req.body?.auth_token != null && typeof req.body.auth_token !== "string") return res.status(400).json({ error: "auth_token must be a string when provided" });
		const url = providerUrl(req.body?.server_url, res);
		if (!url) return;
		const token = resolveProviderAuthToken(req.body?.auth_token);
		const capabilities = await readCapabilities(url, token, res);
		if (!capabilities) return;
		const inserted = await client.from("prsn_servers").insert({
			user_id: user.id,
			name,
			status: "pending",
			server_url: url,
			server_config: capabilities,
			auth_token: token
		}).select("id,created_at").single();
		if (inserted.error) return res.status(500).json({ error: "Failed to register provider", message: inserted.error.message });
		return res.status(201).json({
			provider: {
				id: inserted.data.id,
				user_id: user.id,
				name,
				status: "pending",
				server_url: url,
				owner_email: user.email,
				server_config: capabilities,
				created_at: inserted.data.created_at
			}
		});
	});

	router.post("/api/provider/test", async (req, res) => {
		const user = await loadUser(client, req, res);
		if (!user) return;
		if (user.role !== "admin" && user.role !== "provider") return res.status(403).json({ error: "Forbidden: Admin or Provider role required" });
		if (req.body?.auth_token != null && typeof req.body.auth_token !== "string") return res.status(400).json({ error: "auth_token must be a string when provided" });
		const url = providerUrl(req.body?.server_url, res);
		if (!url) return;
		const capabilities = await readCapabilities(url, resolveProviderAuthToken(req.body?.auth_token), res);
		if (!capabilities) return;
		return res.json({ capabilities, server_url: url });
	});

	return router;
}
