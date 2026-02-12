/** Default production origin. Override with APP_ORIGIN env. Single place to change app domain. */
const DEFAULT_APP_ORIGIN = "https://www.parascene.com";

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
