const CLIENT_ID_COOKIE = "prsn_cid";
const CLIENT_ID_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function generateClientId() {
	if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
	// Fallback for environments without randomUUID.
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function clientIdMiddleware(req, res, next) {
	const fromCookie = typeof req.cookies?.[CLIENT_ID_COOKIE] === "string" ? req.cookies[CLIENT_ID_COOKIE].trim() : "";
	let clientId = fromCookie;
	let issuedNew = false;
	if (!clientId) {
		clientId = generateClientId();
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

