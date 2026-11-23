import { getRequestHost } from "../create/url.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_TOKEN = /^[A-Za-z0-9_-]{32,}$/;

export function currentAppVersion() {
	if (process.env.APP_VERSION) return String(process.env.APP_VERSION).slice(0, 40);
	return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** True for paths the API host is allowed to serve. Other misses are ordinary site 404s. */
export function isTrackedApiPath(pathname) {
	const path = String(pathname || "").split("?")[0];
	return path === "/api" || path.startsWith("/api/") || path === "/oauth" || path.startsWith("/oauth/");
}

/** Group `/api/creations/42/summary` with `/api/creations/99/summary` without keeping ids or tokens. */
export function unhandledPathKey(pathname) {
	const raw = String(pathname || "/").split("?")[0];
	const parts = raw.split("/").map((segment) => {
		if (!segment) return segment;
		let decoded = segment;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			decoded = segment;
		}
		if (NUMERIC.test(decoded) || UUID.test(decoded) || LONG_TOKEN.test(decoded)) return ":id";
		return decoded.slice(0, 80);
	});
	const key = parts.join("/") || "/";
	return key.slice(0, 240);
}

function clip(value, max) {
	return String(value || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

function queryKeyList(req) {
	const source = req.query && typeof req.query === "object" ? req.query : {};
	return Object.keys(source)
		.map((key) => clip(key, 40))
		.filter(Boolean)
		.sort()
		.join(",")
		.slice(0, 200);
}

/**
 * A route miss worth keeping. Returns null for ordinary page and asset 404s.
 * Query values, cookies, and bodies are never included.
 */
export function describeUnhandledRequest(req, appVersion = currentAppVersion()) {
	const path = String(req.path || "/").split("?")[0];
	if (!isTrackedApiPath(path)) return null;
	const method = String(req.method || "GET").toUpperCase();
	return {
		method: /^[A-Z]{1,12}$/.test(method) ? method : "UNKNOWN",
		path_key: unhandledPathKey(path),
		host: clip(getRequestHost(req), 120) || "unknown",
		app_version: clip(appVersion, 40) || "unknown",
		query_keys: queryKeyList(req),
		user_agent: clip(req.get?.("user-agent") || req.headers?.["user-agent"], 180)
	};
}
