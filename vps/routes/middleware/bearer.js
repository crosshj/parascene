import crypto from 'node:crypto';import jwt from 'jsonwebtoken';import {getSecret as getJwtSecret} from '../utils/session.js';
export function apiKeyBearerMiddleware(queries) {
	return async function apiKeyBearer(req, res, next) {
		if (req.auth?.userId) return next();
		const authz = req.headers.authorization || "";
		const m = /^Bearer\s+(\S+)/i.exec(authz);
		if (!m) return next();
		const token = m[1];
		if (!token.startsWith("psn_")) return next();
		if (!queries.selectUserIdByApiKeyHash?.get) return next();
		try {
			const digest = crypto.createHash("sha256").update(token).digest("hex");
			const row = await queries.selectUserIdByApiKeyHash.get(digest);
			if (!row?.id) {
				return res.status(401).json({ error: "Unauthorized", message: "Invalid API key" });
			}
			req.auth = { userId: row.id, apiKeyAuth: true };
			return next();
		} catch (err) {
			return next(err);
		}
	};
}
export function integrationBearerMiddleware() {
	return function integrationBearer(req, res, next) {
		const authz = req.headers.authorization || "";
		const m = /^Bearer\s+(\S+)/i.exec(authz);
		if (!m) return next();
		const token = m[1];
		if (token.startsWith("psn_")) return next();
		const parts = token.split(".");
		if (parts.length !== 3) return next();
		try {
			const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
			if (payload.typ !== "integration_access") return next();
			const sub = Number(payload.sub);
			if (!Number.isFinite(sub) || sub <= 0) return next();
			req.auth = {
				userId: sub,
				integrationAccess: true,
				oauthClientId: typeof payload.cid === "string" ? payload.cid : "",
				oauthScopes: typeof payload.scope === "string" ? payload.scope : ""
			};
			return next();
		} catch {
			return next();
		}
	};
}
