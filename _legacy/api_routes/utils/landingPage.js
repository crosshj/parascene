/**
 * Logged-out landing page HTML file under pages/.
 * Swap variants here: 'index-video.html' (members-first) | 'index.html' (try funnel).
 */
export const LANDING_PAGE_HTML = "index-video.html";

/** When true, the landing HTML is a complete document — no global.css / entry.js bootstrap. */
export const LANDING_PAGE_STANDALONE = LANDING_PAGE_HTML === "index-video.html";

export function landingVariantFromHtml(htmlFile) {
	if (htmlFile === "index-video.html") return "video";
	if (htmlFile === "index.html") return "try";
	return "unknown";
}

export const LANDING_PAGE_VARIANT = landingVariantFromHtml(LANDING_PAGE_HTML);
