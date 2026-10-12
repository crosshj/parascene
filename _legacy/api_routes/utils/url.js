/** Default production origin. Override with APP_ORIGIN env. Single place to change app domain. */
const DEFAULT_APP_ORIGIN = "https://www.parascene.com";

/** Hostname for the share subdomain. Share links use this; only /s/* is served there, rest redirects to www. */
export const SHARE_HOSTNAME = "sh.parascene.com";

/** Hostname for the API subdomain. Used for QStash callbacks and to restrict api subdomain to /api paths only. */
const API_HOSTNAME = "api.parascene.com";

export function getApiHostname() {
	return API_HOSTNAME;
}

/** Normalized hostname from the request (no port, lowercase). Use in host-based middleware. */
export function getRequestHost(req) {
	return (req.hostname || req.get("host") || "").split(":")[0].toLowerCase();
}

/** Base URL for QStash callbacks (where QStash POSTs when a job runs). */
export function getQStashCallbackBaseUrl() {
	return `https://${getApiHostname()}`;
}

export function getBaseAppUrl() {
	if (process.env.APP_ORIGIN) {
		return process.env.APP_ORIGIN.replace(/\/$/, "");
	}
	if (process.env.VERCEL_ENV === "production") {
		return DEFAULT_APP_ORIGIN;
	}
	if (process.env.VERCEL_URL) {
		return `https://${process.env.VERCEL_URL}`;
	}
	const port = Number(process.env.PORT) || 2367;
	return `http://localhost:${port}`;
}

/** Base URL for share links (e.g. https://sh.parascene.com). All share URLs use this so they look like sh.parascene.com/s/... */
export function getShareBaseUrl() {
	return `https://${SHARE_HOSTNAME}`;
}

/**
 * Canonical URL for the current request (path only, no query). Use for <link rel="canonical"> and og:url.
 * Single source of truth so all pages use the same origin (www) and path normalization.
 */
export function getCanonicalUrlForRequest(req) {
	const pathOnly = (req.originalUrl || req.path || "/").split("?")[0].replace(/^(?!\/)/, "/");
	const base = getBaseAppUrl().replace(/\/$/, "");
	return pathOnly === "/" ? `${base}/` : `${base}${pathOnly}`;
}

/** Base URL for links in emails. Never returns localhost; use APP_ORIGIN or DEFAULT_APP_ORIGIN. */
export function getBaseAppUrlForEmail() {
	const base = getBaseAppUrl();
	try {
		const u = new URL(base);
		if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
			return process.env.APP_ORIGIN ? process.env.APP_ORIGIN.replace(/\/$/, "") : DEFAULT_APP_ORIGIN;
		}
		return base;
	} catch {
		return DEFAULT_APP_ORIGIN;
	}
}

export function getThumbnailUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, "http://localhost");
    parsed.searchParams.set("variant", "thumbnail");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}variant=thumbnail`;
  }
}

/** Native-aspect alt thumb for desktop / non-square boards (`?variant=fit`). */
export function getFitThumbnailUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, "http://localhost");
    parsed.searchParams.set("variant", "fit");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}variant=fit`;
  }
}

/** True when client requests the downscaled variant (`?variant=thumbnail`). */
export function isCreatedMediaThumbnailRequest(variant) {
	return String(variant ?? "").trim().toLowerCase() === "thumbnail";
}

/** True when client requests the native-aspect fit thumb (`?variant=fit`). */
export function isCreatedMediaFitThumbnailRequest(variant) {
	return String(variant ?? "").trim().toLowerCase() === "fit";
}

export function appendCreationIdToMediaUrl(url, creationId) {
	if (!url) return url;
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return url;
	const s = String(url);
	if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return url;
	try {
		const parsed = new URL(s, "http://localhost");
		parsed.searchParams.set("creation_id", String(id));
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		const sep = s.includes("?") ? "&" : "?";
		return `${s}${sep}creation_id=${encodeURIComponent(String(id))}`;
	}
}

/** Append share token query params so `<img src>` can load unpublished group sources via share links. */
export function appendShareAccessToMediaUrl(url, shareAccess) {
	if (!url || !shareAccess) return url;
	const s = String(url);
	if (/[?&]share_version=/.test(s.split("#")[0])) return url;
	const version =
		typeof shareAccess.version === "string" ? shareAccess.version.trim() : "";
	const token = typeof shareAccess.token === "string" ? shareAccess.token.trim() : "";
	if (!version || !token) return url;
	if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return url;
	try {
		const parsed = new URL(s, "http://localhost");
		parsed.searchParams.set("share_version", version);
		parsed.searchParams.set("share_token", token);
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		const sep = s.includes("?") ? "&" : "?";
		return `${s}${sep}share_version=${encodeURIComponent(version)}&share_token=${encodeURIComponent(token)}`;
	}
}
