/**
 * Normalize header value: can be string or array (e.g. on Vercel).
 * @param {string|string[]|undefined} raw
 * @returns {string}
 */
function headerValue(raw) {
	if (Array.isArray(raw)) return (raw[0] ?? "").trim();
	return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Get the client IP and its source from the request. When the app is behind
 * Cloudflare → Vercel, req.ip / req.socket.remoteAddress are the proxy. Prefer
 * cf-connecting-ip (Cloudflare’s original client IP), then X-Forwarded-For,
 * then X-Real-IP. Source is stored so you can always know where the IP came from.
 * @param {import("express").Request} req
 * @returns {{ ip: string|null, source: string|null }} source is one of 'cf-connecting-ip' | 'x-forwarded-for' | 'x-real-ip' | 'req.ip' | 'socket'
 */
export function getClientIp(req) {
	const headers = req.headers ?? {};
	// Cloudflare (when first proxy): most reliable for original client IP
	const cfConnectingIp = headerValue(headers["cf-connecting-ip"] ?? req.get?.("cf-connecting-ip"));
	if (cfConnectingIp) return { ip: cfConnectingIp, source: "cf-connecting-ip" };
	const forwardedFor = headerValue(headers["x-forwarded-for"] ?? req.get?.("x-forwarded-for"));
	if (forwardedFor) {
		// "client, cloudflareIP, ..." — leftmost is the original client
		const first = forwardedFor.split(",")[0]?.trim();
		if (first) return { ip: first, source: "x-forwarded-for" };
	}
	const realIp = headerValue(headers["x-real-ip"] ?? req.get?.("x-real-ip"));
	if (realIp) return { ip: realIp, source: "x-real-ip" };
	const expressIp = typeof req.ip === "string" ? req.ip.trim() : "";
	if (expressIp) return { ip: expressIp, source: "req.ip" };
	const remote = req.socket?.remoteAddress;
	const socketIp = typeof remote === "string" ? remote.trim() || null : null;
	return socketIp ? { ip: socketIp, source: "socket" } : { ip: null, source: null };
}

/**
 * Get Cloudflare request ID (Cf-Ray) when present. Storing this in your DB lets you
 * correlate in-house records with Cloudflare Logs / Log Explorer (search by Ray ID).
 * @param {import("express").Request} req
 * @returns {string|null}
 */
export function getCloudflareRay(req) {
	const headers = req.headers ?? {};
	const ray = headerValue(headers["cf-ray"] ?? req.get?.("cf-ray"));
	return ray || null;
}

/**
 * Get Vercel geo headers when present (country, region, city). Only includes
 * non-empty values. Useful for share view attribution without a separate geo lookup.
 * @param {import("express").Request} req
 * @returns {{ country?: string, region?: string, city?: string }}
 */
export function getVercelGeo(req) {
	const headers = req.headers ?? {};
	const country = headerValue(headers["x-vercel-ip-country"]);
	const region = headerValue(headers["x-vercel-ip-region"]);
	const city = headerValue(headers["x-vercel-ip-city"]);
	const out = {};
	if (country) out.country = country;
	if (region) out.region = region;
	if (city) out.city = city;
	return out;
}
