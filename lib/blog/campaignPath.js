/**
 * Campaign prefix in /blog/{maybeCampaign}/{slug…}: first segment is a campaign token
 * only if it matches this pattern (lowercase alphanumeric, short).
 */
export const BLOG_CAMPAIGN_TOKEN_RE = /^[a-z0-9]{1,12}$/;

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
