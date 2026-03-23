/**
 * Campaign prefix in /blog/{maybeCampaign}/{slug…}: first segment is a campaign token
 * only if it matches this pattern (lowercase alphanumeric, short).
 */
export const BLOG_CAMPAIGN_TOKEN_RE = /^[a-z0-9]{1,12}$/;

/** In-app / first-party surfaces (feed card, future nav, etc.) — tracked as campaign `n`. */
export const BLOG_CAMPAIGN_INTERNAL = "n";

/** Blog index post list (`/blog` markdown list / index links) — tracked as campaign `i`. */
export const BLOG_CAMPAIGN_INDEX = "i";

/** Ids reserved for first-party link builders; must not be registered as custom campaigns. */
export function isSystemReservedBlogCampaignId(id) {
	const s = typeof id === "string" ? id.trim().toLowerCase() : String(id ?? "").trim().toLowerCase();
	return s === BLOG_CAMPAIGN_INTERNAL || s === BLOG_CAMPAIGN_INDEX;
}

/**
 * Client-relative path for a public blog post. With a valid campaign token, path is
 * `/blog/{campaign}/{slug…}` for view attribution; otherwise `/blog/{slug…}` (canonical shape).
 * @param {string} slug
 * @param {string} [campaignId]
 * @returns {string}
 */
export function buildBlogPostPublicPath(slug, campaignId) {
	const s = typeof slug === "string" ? slug.trim() : String(slug ?? "").trim();
	if (!s) return "/blog";
	const encPath = s
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
	const c = campaignId != null && String(campaignId).trim() !== "" ? String(campaignId).trim() : "";
	if (c && isBlogCampaignToken(c)) {
		return `/blog/${encodeURIComponent(c)}/${encPath}`;
	}
	return `/blog/${encPath}`;
}

export function isBlogCampaignToken(segment) {
	return typeof segment === "string" && BLOG_CAMPAIGN_TOKEN_RE.test(segment);
}

/**
 * @param {string[]} segments Path after /blog/, split on /, no empty parts
 * @returns {{ slug: string, campaign: string | null, tryCampaignFallback: boolean }}
 */
export function parseBlogPathSegments(segments) {
	const seg = Array.isArray(segments) ? segments.filter(Boolean) : [];
	if (seg.length === 0) {
		return { slug: "", campaign: null, tryCampaignFallback: false };
	}
	if (seg.length === 1) {
		return { slug: seg[0], campaign: null, tryCampaignFallback: false };
	}
	const head = seg[0];
	const tail = seg.slice(1).join("/");
	if (!isBlogCampaignToken(head)) {
		return { slug: seg.join("/"), campaign: null, tryCampaignFallback: false };
	}
	return { slug: tail, campaign: head, tryCampaignFallback: true };
}
