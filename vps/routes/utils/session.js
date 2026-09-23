import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const COOKIE_NAME = "ps_session";
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
	const value = String(process.env.SESSION_SECRET || "").trim();
	if (!value) throw new Error("SESSION_SECRET is required");
	return value;
}

export function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
export function issueToken(userId) { return jwt.sign({ userId: Number(userId) }, getSecret(), { expiresIn: "7d" }); }
export function readToken(token) {
	try {
		const payload = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
		const userId = Number(payload?.userId);
		return Number.isInteger(userId) && userId > 0 ? userId : null;
	} catch { return null; }
}
function cookieOptions(req) {
	const hostname = String(req?.hostname || req?.get?.("host") || "").split(":")[0].toLowerCase();
	const productionHost = hostname === "parascene.com" || hostname.endsWith(".parascene.com");
	const production = process.env.NODE_ENV === "production" || productionHost;
	return { httpOnly: true, secure: production, sameSite: production ? "none" : "lax", ...(productionHost ? { domain: ".parascene.com" } : {}), maxAge: SESSION_MS, path: "/" };
}
export function setSessionCookie(res, token, req) {
	const options = cookieOptions(req);
	if (options.domain) res.clearCookie(COOKIE_NAME, { ...options, domain: undefined });
	res.cookie(COOKIE_NAME, token, options);
}
export function clearSessionCookie(res, req) {
	res.clearCookie(COOKIE_NAME, cookieOptions(req));
	if (process.env.NODE_ENV === "production" || String(req?.hostname || "").endsWith(".parascene.com")) res.clearCookie(COOKIE_NAME, { ...cookieOptions(req), domain: undefined });
}
