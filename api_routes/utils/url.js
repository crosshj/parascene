/** Default production origin. Override with APP_ORIGIN env. Single place to change app domain. */
const DEFAULT_APP_ORIGIN = "https://www.parascene.com";

/** Hostname for the share subdomain. Share links use this; only /s/* is served there, rest redirects to www. */
export const SHARE_HOSTNAME = "sh.parascene.com";

/** Hostname for the API subdomain. Used for QStash callbacks and to restrict api subdomain to /api paths only. */
const API_HOSTNAME = "api.parascene.com";

export function getApiHostname() {
	return API_HOSTNAME;
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
	if (process.env.VERCEL_ENV === "production") {
		return `https://${SHARE_HOSTNAME}`;
	}
	return getBaseAppUrl();
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
