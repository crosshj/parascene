import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.js";
import { getBaseAppUrl } from "./utils/url.js";
import { computeWelcome } from "./utils/welcome.js";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_EXPIRES_SEC = 15 * 60;
const REFRESH_TOKEN_BYTES = 32;

function parseRedirectUris(raw) {
	if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
	if (typeof raw === "string") {
		try {
			const j = JSON.parse(raw);
			return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
		} catch {
			return [];
		}
	}
	return [];
}

function redirectUriAllowed(clientRow, redirectUri) {
	const uris = parseRedirectUris(clientRow.redirect_uris);
	return uris.some((u) => u === redirectUri);
}

function normalizeScope(scopeStr) {
	const s = typeof scopeStr === "string" && scopeStr.trim() ? scopeStr.trim() : "openid profile";
	const parts = new Set(s.split(/\s+/).filter(Boolean));
	parts.add("openid");
	parts.add("profile");
	return [...parts].join(" ");
}

function verifyPkceS256(verifier, challenge) {
	if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
	if (typeof challenge !== "string" || !challenge) return false;
	const digest = crypto.createHash("sha256").update(verifier).digest("base64url");
	const a = Buffer.from(digest);
	const b = Buffer.from(challenge);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

function randomUrlSafe(nBytes) {
	return crypto.randomBytes(nBytes).toString("base64url");
}

function hashTokenHex(token) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(userId, publicClientId, scope) {
	return jwt.sign(
		{ typ: "integration_access", sub: String(userId), cid: publicClientId, scope },
		getJwtSecret(),
		{ expiresIn: ACCESS_TOKEN_EXPIRES_SEC, algorithm: "HS256" }
	);
}

function escapeHtml(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function parseClientMeta(raw) {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
	if (typeof raw === "string") {
		try {
			const j = JSON.parse(raw);
			if (j && typeof j === "object" && !Array.isArray(j)) return { ...j };
		} catch {
			/* ignore */
		}
	}
	return {};
}

/** Public/native clients exchange tokens with PKCE only (no psn_ developer key). */
function isPublicOauthClient(row) {
	const meta = parseClientMeta(row?.meta);
	return meta.client_type === "public" || meta.token_endpoint_auth_method === "none";
}

function clientTypeFromBody(body, fallback = "confidential") {
	if (body?.public_client === true || body?.client_type === "public") return "public";
	if (body?.public_client === false || body?.client_type === "confidential") return "confidential";
	if (typeof body?.client_type === "string") {
		const t = body.client_type.trim().toLowerCase();
		if (t === "public" || t === "confidential") return t;
	}
	return fallback;
}

function clientTypeFromRow(row) {
	return isPublicOauthClient(row) ? "public" : "confidential";
}

function oauthParamsFromQuery(q) {
	const response_type = typeof q.response_type === "string" ? q.response_type.trim() : "";
	const client_id = typeof q.client_id === "string" ? q.client_id.trim() : "";
	const redirect_uri = typeof q.redirect_uri === "string" ? q.redirect_uri.trim() : "";
	const scope = typeof q.scope === "string" ? q.scope.trim() : "";
	const state = typeof q.state === "string" ? q.state : "";
	const code_challenge = typeof q.code_challenge === "string" ? q.code_challenge.trim() : "";
	const code_challenge_method =
		typeof q.code_challenge_method === "string" ? q.code_challenge_method.trim() : "";
	return {
		response_type,
		client_id,
		redirect_uri,
		scope,
		state,
		code_challenge,
		code_challenge_method
	};
}

function renderConsentPage({ appName, actionUrl, hiddenFields }) {
	const inputs = hiddenFields
		.map(
			({ name, value }) =>
				`<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
		)
		.join("\n");
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Authorize app · Parascene</title>
	<style>
		body { font-family: system-ui, sans-serif; background: #0a0a0c; color: #eee; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
		.card { background: #141418; border-radius: 14px; padding: 28px; max-width: 420px; width: 100%; border: 1px solid #2a2a32; }
		h1 { font-size: 1.15rem; margin: 0 0 12px; font-weight: 600; }
		p { color: #a8a8b0; line-height: 1.5; margin: 0 0 20px; font-size: 0.95rem; }
		.app { color: #fff; font-weight: 600; }
		.actions { display: flex; gap: 10px; flex-wrap: wrap; }
		button { border-radius: 6px; padding: 10px 18px; font-size: 0.95rem; cursor: pointer; border: none; font-weight: 500; }
		.allow { background: #e8e8ec; color: #111; }
		.deny { background: transparent; color: #ccc; border: 1px solid #444; }
	</style>
</head>
<body>
	<div class="card">
		<h1>Connect to Parascene</h1>
		<p><span class="app">${escapeHtml(appName)}</span> wants to access your Parascene account (sign in as you and use the API on your behalf).</p>
		<form method="post" action="${escapeHtml(actionUrl)}">
			${inputs}
			<div class="actions">
				<button type="submit" name="decision" value="allow" class="allow">Allow</button>
				<button type="submit" name="decision" value="deny" class="deny">Cancel</button>
			</div>
		</form>
	</div>
</body>
</html>`;
}

export default function createOAuthIntegrationRoutes({ queries }) {
	const router = express.Router();

	function badRequest(res, msg) {
		return res.status(400).type("text/plain").send(String(msg || "Bad request"));
	}

	// ——— Developer: manage OAuth apps (website session) ———

	router.get("/api/integration/apps", async (req, res) => {
		if (!queries.selectOauthClientsByOwner?.all) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		try {
			const rows = await queries.selectOauthClientsByOwner.all(req.auth.userId);
			const out = (rows ?? []).map((r) => ({
				id: r.id,
				client_id: r.client_id,
				name: r.name,
				redirect_uris: parseRedirectUris(r.redirect_uris),
				client_type: clientTypeFromRow(r),
				created_at: r.created_at
			}));
			return res.json({ apps: out });
		} catch (err) {
			console.error("[GET /api/integration/apps]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	router.post("/api/integration/apps", async (req, res) => {
		if (!queries.insertOauthClient?.run) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const name = typeof body.name === "string" ? body.name.trim() : "";
		const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
		const redirectStrings = uris
			.filter((u) => typeof u === "string" && u.trim())
			.map((u) => u.trim());
		if (!name || name.length > 200) {
			return res.status(400).json({ error: "Invalid request", message: "name is required (max 200 chars)." });
		}
		if (redirectStrings.length < 1 || redirectStrings.length > 20) {
			return res
				.status(400)
				.json({ error: "Invalid request", message: "redirect_uris must be a non-empty array (max 20 URIs)." });
		}
		for (const u of redirectStrings) {
			try {
				const parsed = new URL(u);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					return res.status(400).json({ error: "Invalid redirect_uri", message: "Only http(s) URLs allowed." });
				}
			} catch {
				return res.status(400).json({ error: "Invalid redirect_uri", message: `Invalid URL: ${u}` });
			}
		}
		const clientId = crypto.randomUUID();
		const redirectUrisJson = JSON.stringify(redirectStrings);
		const clientType = clientTypeFromBody(body, "confidential");
		const meta = { client_type: clientType };
		if (clientType === "public") {
			meta.token_endpoint_auth_method = "none";
		}
		try {
			await queries.insertOauthClient.run({
				ownerUserId: req.auth.userId,
				clientId,
				name,
				redirectUrisJson,
				meta
			});
			return res.status(201).json({
				ok: true,
				client_id: clientId,
				name,
				redirect_uris: redirectStrings,
				client_type: clientType
			});
		} catch (err) {
			console.error("[POST /api/integration/apps]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	router.patch("/api/integration/apps/:clientId", async (req, res) => {
		if (!queries.selectOauthClientByPublicClientId?.get || !queries.updateOauthClientForOwner?.run) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const publicClientId = typeof req.params.clientId === "string" ? req.params.clientId.trim() : "";
		const row = await queries.selectOauthClientByPublicClientId.get(publicClientId);
		if (!row || Number(row.owner_user_id) !== Number(req.auth.userId)) {
			return res.status(404).json({ error: "Not found" });
		}
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const name = typeof body.name === "string" ? body.name.trim() : row.name;
		let redirectStrings = parseRedirectUris(row.redirect_uris);
		if (Array.isArray(body.redirect_uris)) {
			redirectStrings = body.redirect_uris
				.filter((u) => typeof u === "string" && u.trim())
				.map((u) => u.trim());
		}
		if (!name || name.length > 200) {
			return res.status(400).json({ error: "Invalid request", message: "name invalid." });
		}
		if (redirectStrings.length < 1 || redirectStrings.length > 20) {
			return res.status(400).json({ error: "Invalid request", message: "redirect_uris invalid." });
		}
		for (const u of redirectStrings) {
			try {
				const parsed = new URL(u);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					return res.status(400).json({ error: "Invalid redirect_uri" });
				}
			} catch {
				return res.status(400).json({ error: "Invalid redirect_uri" });
			}
		}
		const prevMeta = parseClientMeta(row.meta);
		const clientType = clientTypeFromBody(body, clientTypeFromRow(row));
		const meta = {
			...prevMeta,
			client_type: clientType
		};
		if (clientType === "public") {
			meta.token_endpoint_auth_method = "none";
		} else {
			delete meta.token_endpoint_auth_method;
		}
		try {
			await queries.updateOauthClientForOwner.run(row.id, req.auth.userId, {
				name,
				redirectUrisJson: JSON.stringify(redirectStrings),
				meta
			});
			return res.json({
				ok: true,
				client_id: publicClientId,
				name,
				redirect_uris: redirectStrings,
				client_type: clientType
			});
		} catch (err) {
			console.error("[PATCH /api/integration/apps/:clientId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	router.delete("/api/integration/apps/:clientId", async (req, res) => {
		if (!queries.selectOauthClientByPublicClientId?.get || !queries.deleteOauthClientForOwner?.run) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const publicClientId = typeof req.params.clientId === "string" ? req.params.clientId.trim() : "";
		const row = await queries.selectOauthClientByPublicClientId.get(publicClientId);
		if (!row || Number(row.owner_user_id) !== Number(req.auth.userId)) {
			return res.status(404).json({ error: "Not found" });
		}
		try {
			await queries.deleteOauthClientForOwner.run(row.id, req.auth.userId);
			return res.json({ ok: true });
		} catch (err) {
			console.error("[DELETE /api/integration/apps/:clientId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	// ——— End-user: connected apps (website session) ———

	router.get("/api/profile/integration-grants", async (req, res) => {
		if (!queries.selectIntegrationGrantsForUser?.all) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		try {
			const rows = await queries.selectIntegrationGrantsForUser.all(req.auth.userId);
			return res.json({ grants: rows ?? [] });
		} catch (err) {
			console.error("[GET /api/profile/integration-grants]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	router.delete("/api/profile/integration-grants/:grantId", async (req, res) => {
		if (!queries.revokeOAuthGrantByIdForUser?.run) {
			return res.status(503).json({ error: "Not available", message: "OAuth integration is not configured." });
		}
		if (!req.auth?.userId || req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const grantId = Number.parseInt(String(req.params.grantId), 10);
		if (!Number.isFinite(grantId) || grantId <= 0) {
			return res.status(400).json({ error: "Invalid grant id" });
		}
		try {
			const result = await queries.revokeOAuthGrantByIdForUser.run(grantId, req.auth.userId);
			if (!result?.changes) {
				return res.status(404).json({ error: "Not found" });
			}
			return res.json({ ok: true });
		} catch (err) {
			console.error("[DELETE /api/profile/integration-grants/:grantId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message });
		}
	});

	// ——— OAuth authorize (browser + cookie session) ———

	router.get("/oauth/authorize", async (req, res) => {
		if (!queries.selectOauthClientByPublicClientId?.get || !queries.insertOAuthAuthorizationCode?.run) {
			return badRequest(res, "OAuth integration is not configured.");
		}
		const q = oauthParamsFromQuery(req.query);
		if (q.response_type !== "code") {
			return badRequest(res, "response_type must be code");
		}
		if (!q.client_id || !q.redirect_uri || !q.state?.trim()) {
			return badRequest(res, "client_id, redirect_uri, and state are required");
		}
		if (q.code_challenge_method !== "S256" || !q.code_challenge) {
			return badRequest(res, "PKCE required: code_challenge_method=S256 and code_challenge");
		}
		const clientRow = await queries.selectOauthClientByPublicClientId.get(q.client_id);
		if (!clientRow) {
			return badRequest(res, "Unknown client_id");
		}
		if (!redirectUriAllowed(clientRow, q.redirect_uri)) {
			return badRequest(res, "redirect_uri not registered for this client");
		}
		let redirectUrl;
		try {
			redirectUrl = new URL(q.redirect_uri);
		} catch {
			return badRequest(res, "Invalid redirect_uri");
		}
		if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
			return badRequest(res, "Invalid redirect_uri protocol");
		}

		if (!req.auth?.userId) {
			const base = getBaseAppUrl();
			// Path + query only. Full URLs break auth.html and POST /login: `returnUrl` must be
			// a same-site path (no `://`) for hidden fields and sanitizeReturnUrl to accept it.
			const afterLogin =
				typeof req.originalUrl === "string" && req.originalUrl.startsWith("/")
					? req.originalUrl
					: "/oauth/authorize";
			return res.redirect(302, `${base}/auth.html?returnUrl=${encodeURIComponent(afterLogin)}`);
		}
		if (req.auth.apiKeyAuth || req.auth.integrationAccess) {
			return badRequest(res, "Use a website session to authorize OAuth");
		}

		const profileRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
		const welcome = computeWelcome({ profileRow });
		if (welcome.required) {
			const resumeOAuth =
				typeof req.originalUrl === "string" && req.originalUrl.startsWith("/")
					? req.originalUrl
					: "/oauth/authorize";
			return res.redirect(
				302,
				`/welcome?${new URLSearchParams({ returnUrl: resumeOAuth }).toString()}`
			);
		}

		const scopeNorm = normalizeScope(q.scope);
		const hidden = [
			{ name: "client_id", value: q.client_id },
			{ name: "redirect_uri", value: q.redirect_uri },
			{ name: "state", value: q.state },
			{ name: "scope", value: scopeNorm },
			{ name: "code_challenge", value: q.code_challenge },
			{ name: "code_challenge_method", value: "S256" }
		];
		const html = renderConsentPage({
			appName: clientRow.name || "Application",
			actionUrl: `${getBaseAppUrl()}/oauth/authorize/continue`,
			hiddenFields: hidden
		});
		return res.status(200).type("text/html; charset=utf-8").send(html);
	});

	router.post("/oauth/authorize/continue", async (req, res) => {
		if (!queries.selectOauthClientByPublicClientId?.get || !queries.insertOAuthAuthorizationCode?.run) {
			return badRequest(res, "OAuth integration is not configured.");
		}
		if (!req.auth?.userId || req.auth.apiKeyAuth || req.auth.integrationAccess) {
			return badRequest(res, "Unauthorized");
		}
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const decision = typeof body.decision === "string" ? body.decision.trim() : "";
		const client_id = typeof body.client_id === "string" ? body.client_id.trim() : "";
		const redirect_uri = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
		const state = typeof body.state === "string" ? body.state : "";
		const scope = typeof body.scope === "string" ? body.scope.trim() : "openid profile";
		const code_challenge = typeof body.code_challenge === "string" ? body.code_challenge.trim() : "";
		const code_challenge_method =
			typeof body.code_challenge_method === "string" ? body.code_challenge_method.trim() : "";

		const clientRow = await queries.selectOauthClientByPublicClientId.get(client_id);
		if (!clientRow || !redirectUriAllowed(clientRow, redirect_uri)) {
			return badRequest(res, "Invalid client or redirect_uri");
		}
		if (code_challenge_method !== "S256" || !code_challenge) {
			return badRequest(res, "PKCE parameters missing");
		}

		let dest;
		try {
			dest = new URL(redirect_uri);
		} catch {
			return badRequest(res, "Invalid redirect_uri");
		}

		if (decision !== "allow") {
			dest.searchParams.set("error", "access_denied");
			dest.searchParams.set("state", state);
			return res.redirect(302, dest.toString());
		}

		const profileRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
		const welcome = computeWelcome({ profileRow });
		if (welcome.required) {
			const resume = new URLSearchParams({
				response_type: "code",
				client_id,
				redirect_uri,
				state,
				scope,
				code_challenge,
				code_challenge_method: "S256"
			});
			const resumeOAuth = `/oauth/authorize?${resume.toString()}`;
			return res.redirect(
				302,
				`/welcome?${new URLSearchParams({ returnUrl: resumeOAuth }).toString()}`
			);
		}

		const rawCode = randomUrlSafe(32);
		const codeHash = hashTokenHex(rawCode);
		const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString();
		try {
			await queries.insertOAuthAuthorizationCode.run({
				codeHash,
				userId: req.auth.userId,
				oauthClientInternalId: clientRow.id,
				redirectUri: redirect_uri,
				codeChallenge: code_challenge,
				expiresAtIso: expiresAt
			});
		} catch (err) {
			console.error("[insertOAuthAuthorizationCode]", err);
			return badRequest(res, "Could not create authorization code");
		}

		dest.searchParams.set("code", rawCode);
		dest.searchParams.set("state", state);
		return res.redirect(302, dest.toString());
	});

	// ——— Token endpoint ———
	// Confidential apps: Authorization Bearer psn_… (developer API key)
	// Public/native apps: PKCE only (client_id + code_verifier / refresh_token)

	router.post("/oauth/token", async (req, res) => {
		if (
			!queries.consumeOAuthAuthorizationCode?.get ||
			!queries.selectOauthClientByPublicClientId?.get ||
			!queries.revokeOAuthGrantsForUserClient?.run ||
			!queries.insertOAuthGrant?.run ||
			!queries.selectOAuthGrantByRefreshTokenHash?.get ||
			!queries.updateOAuthGrantRefreshToken?.run
		) {
			return res.status(503).json({ error: "server_error", error_description: "OAuth not configured" });
		}

		const body = req.body && typeof req.body === "object" ? req.body : {};
		const grant_type = typeof body.grant_type === "string" ? body.grant_type.trim() : "";
		const client_id = typeof body.client_id === "string" ? body.client_id.trim() : "";

		if (!client_id) {
			return res.status(400).json({
				error: "invalid_request",
				error_description: "client_id is required"
			});
		}

		const appRow = await queries.selectOauthClientByPublicClientId.get(client_id);
		if (!appRow) {
			return res.status(401).json({
				error: "invalid_client",
				error_description: "Unknown client_id"
			});
		}

		const isPublic = isPublicOauthClient(appRow);
		if (!isPublic) {
			if (!req.auth?.userId || !req.auth?.apiKeyAuth) {
				return res.status(401).json({
					error: "invalid_client",
					error_description: "Use Authorization: Bearer with your Parascene API key (psn_…)."
				});
			}
			if (Number(appRow.owner_user_id) !== Number(req.auth.userId)) {
				return res.status(401).json({
					error: "invalid_client",
					error_description: "client_id does not match API key owner"
				});
			}
		}

		if (grant_type === "authorization_code") {
			const code = typeof body.code === "string" ? body.code.trim() : "";
			const redirect_uri = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
			const code_verifier = typeof body.code_verifier === "string" ? body.code_verifier.trim() : "";
			if (!code || !redirect_uri || !code_verifier) {
				return res.status(400).json({
					error: "invalid_request",
					error_description: "code, redirect_uri, and code_verifier are required"
				});
			}
			const codeHash = hashTokenHex(code);
			let consumed;
			try {
				consumed = await queries.consumeOAuthAuthorizationCode.get(codeHash);
			} catch (err) {
				console.error("[consumeOAuthAuthorizationCode]", err);
				return res.status(500).json({ error: "server_error" });
			}
			if (!consumed) {
				return res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
			}
			if (Number(consumed.oauth_client_id) !== Number(appRow.id)) {
				return res.status(400).json({ error: "invalid_grant", error_description: "Code client mismatch" });
			}
			if (consumed.redirect_uri !== redirect_uri) {
				return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
			}
			if (!verifyPkceS256(code_verifier, consumed.code_challenge)) {
				return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
			}

			const userId = consumed.user_id;
			const scopeNorm = normalizeScope("openid profile");

			try {
				await queries.revokeOAuthGrantsForUserClient.run(userId, appRow.id);
			} catch (err) {
				console.error("[revokeOAuthGrantsForUserClient]", err);
			}

			const refreshRaw = `prt_${randomUrlSafe(REFRESH_TOKEN_BYTES)}`;
			const refreshHash = hashTokenHex(refreshRaw);
			try {
				await queries.insertOAuthGrant.run({
					userId,
					oauthClientInternalId: appRow.id,
					refreshTokenHash: refreshHash,
					scopes: scopeNorm
				});
			} catch (err) {
				console.error("[insertOAuthGrant]", err);
				return res.status(500).json({ error: "server_error" });
			}

			const access_token = signAccessToken(userId, appRow.client_id, scopeNorm);
			return res.json({
				access_token,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_EXPIRES_SEC,
				refresh_token: refreshRaw,
				scope: scopeNorm
			});
		}

		if (grant_type === "refresh_token") {
			const refresh_token = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
			if (!refresh_token || !refresh_token.startsWith("prt_")) {
				return res.status(400).json({ error: "invalid_request", error_description: "refresh_token required" });
			}
			const refreshHash = hashTokenHex(refresh_token);
			let grant;
			try {
				grant = await queries.selectOAuthGrantByRefreshTokenHash.get(refreshHash);
			} catch (err) {
				console.error("[selectOAuthGrantByRefreshTokenHash]", err);
				return res.status(500).json({ error: "server_error" });
			}
			if (!grant || Number(grant.oauth_client_id) !== Number(appRow.id)) {
				return res.status(400).json({ error: "invalid_grant", error_description: "Invalid refresh token" });
			}
			if (grant.public_client_id !== appRow.client_id) {
				return res.status(400).json({ error: "invalid_grant" });
			}

			const scopeNorm = typeof grant.scopes === "string" ? grant.scopes : normalizeScope("openid profile");
			const newRefresh = `prt_${randomUrlSafe(REFRESH_TOKEN_BYTES)}`;
			const newHash = hashTokenHex(newRefresh);
			try {
				await queries.updateOAuthGrantRefreshToken.run(grant.id, newHash);
			} catch (err) {
				console.error("[updateOAuthGrantRefreshToken]", err);
				return res.status(500).json({ error: "server_error" });
			}

			const access_token = signAccessToken(grant.user_id, appRow.client_id, scopeNorm);
			return res.json({
				access_token,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_EXPIRES_SEC,
				refresh_token: newRefresh,
				scope: scopeNorm
			});
		}

		return res.status(400).json({ error: "unsupported_grant_type" });
	});

	// ——— Userinfo (delegated access token) ———

	router.get("/oauth/userinfo", async (req, res) => {
		if (!req.auth?.userId || !req.auth?.integrationAccess) {
			return res.status(401).json({ error: "invalid_token", error_description: "Bearer access token required" });
		}
		const uid = req.auth.userId;
		try {
			const profile = await queries.selectUserProfileByUserId?.get(uid);
			const row = await queries.selectUserById?.get(uid);
			const email = row?.email && typeof row.email === "string" ? row.email : null;
			const sub = String(uid);
			const preferred_username =
				profile?.user_name && typeof profile.user_name === "string" ? profile.user_name : null;
			const name =
				profile?.display_name && typeof profile.display_name === "string"
					? profile.display_name
					: preferred_username;
			const picture =
				profile?.avatar_url && typeof profile.avatar_url === "string" ? profile.avatar_url : null;
			const scopeParts = String(req.auth.oauthScopes || "")
				.split(/\s+/)
				.filter(Boolean);
			const out = {
				sub,
				preferred_username,
				name,
				picture
			};
			if (email && scopeParts.includes("email")) {
				out.email = email;
			}
			return res.json(out);
		} catch (err) {
			console.error("[GET /oauth/userinfo]", err);
			return res.status(500).json({ error: "server_error" });
		}
	});

	return router;
}
