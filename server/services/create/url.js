/** Default production origin. Override with APP_ORIGIN env. Single place to change app domain. */
const DEFAULT_APP_ORIGIN = "https://www.parascene.com";

function configuredHostname(envName, fallback) {
	const value = String(process.env[envName] || "").trim().toLowerCase().replace(/\/$/, "");
	if (!value) return fallback;
	try {
		if (value.includes("://")) return new URL(value).hostname;
	} catch {
		return fallback;
	}
	return value.split("/")[0].split(":")[0];
}

/** Share-link hostname for this deployment. Other paths on that host redirect to the site origin. */
export function getShareHostname() {
	return configuredHostname("SHARE_HOSTNAME", "sh.parascene.com");
}

/** API hostname for this deployment. Callbacks and external API clients use it. */
export function getApiHostname() {
	return configuredHostname("API_HOSTNAME", "api.parascene.com");
}

/** Media hostname this deployment emits for uploads and playback. */
export function getCdnHostname() {
	return configuredHostname("CDN_HOSTNAME", "cdn.parascene.com");
}

export function getCdnOrigin() {
	return `https://${getCdnHostname()}`;
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
	const port = Number(process.env.PORT) || 3000;
	return `http://localhost:${port}`;
}

/** Base URL for share links minted by this deployment. */
export function getShareBaseUrl() {
	return `https://${getShareHostname()}`;
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
