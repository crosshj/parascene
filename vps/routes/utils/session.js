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
function cookieOptions() {
	return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", ...(process.env.NODE_ENV === "production" ? { domain: ".parascene.com" } : {}), maxAge: SESSION_MS, path: "/" };
}
export function setSessionCookie(res, token) { res.cookie(COOKIE_NAME, token, cookieOptions()); }
export function clearSessionCookie(res) {
	res.clearCookie(COOKIE_NAME, cookieOptions());
	if (process.env.NODE_ENV === "production") res.clearCookie(COOKIE_NAME, { ...cookieOptions(), domain: undefined });
}
