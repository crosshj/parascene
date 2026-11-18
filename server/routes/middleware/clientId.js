import { randomUUID } from "node:crypto";

const CLIENT_ID_COOKIE = "prsn_cid";
const CLIENT_ID_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function clientIdMiddleware(req, res, next) {
	const fromCookie = typeof req.cookies?.[CLIENT_ID_COOKIE] === "string" ? req.cookies[CLIENT_ID_COOKIE].trim() : "";
	let clientId = fromCookie;
	let issuedNew = false;
	if (!clientId) {
		clientId = randomUUID();
		issuedNew = true;
		const secureCookie = process.env.NODE_ENV === "production" || req.secure === true;
		res.cookie(CLIENT_ID_COOKIE, clientId, {
			httpOnly: true,
			secure: secureCookie,
			sameSite: "lax",
			path: "/",
			maxAge: CLIENT_ID_MAX_AGE_MS
		});
	}
	req.clientId = clientId;
	req.clientIdNew = issuedNew;
	next();
}
