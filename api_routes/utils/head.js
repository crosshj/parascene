import { getCanonicalUrlForRequest } from "./url.js";

const html = String.raw;

/** Cache-bust: BUILD_ID, ASSET_VERSION, or Vercel git SHA. Used so {{V}} in HTML becomes ?v=xxx. */
function getAssetVersion() {
	return process.env.BUILD_ID || process.env.ASSET_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_PREVIOUS_COMMIT_SHA || "";
}

function escapeHtmlUrl(url) {
	return String(url ?? "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Tokens for replacePageTokens.
 * - V: "?v=xxx" when asset version is set, else "".
 * - V_PARAM: raw version for JS cache-busting.
 * - PAGE_META_DESCRIPTION: meta description content for the page (defaults to site-wide description).
 * - Optional req: when provided, includes CANONICAL_LINK and OG_URL_TAG (canonical www) for the request.
 */
export function getPageTokens(req) {
	const v = getAssetVersion();
	const defaultDescription =
		"parascene is a community that uses AI, ML, and algorithms to support creation. Join us for creativity, entertainment, and involvement.";
	const tokens = {
		V: v ? `?v=${v}` : "",
		V_PARAM: v,
		OG_URL_TAG: "",
		PAGE_META_DESCRIPTION: defaultDescription
	};
	if (req) {
		tokens.CANONICAL_LINK = getCanonicalLinkForRequest(req);
		const canonicalUrl = getCanonicalUrlForRequest(req);
		if (canonicalUrl) {
			tokens.OG_URL_TAG = `<meta property="og:url" content="${escapeHtmlUrl(canonicalUrl)}" />\n\t\t<meta property="og:type" content="website" />`;
		}
	}
	const authed = !!(req?.auth?.userId);
	tokens.PRSN_SUPABASE_BOOT = authed ? getSupabaseBootHtml() : "";
	return tokens;
}

/**
 * Inline import map + window config for logged-in shell (no bundler). Empty when env missing.
 */
function getSupabaseBootHtml() {
	const url = process.env.SUPABASE_URL?.trim();
	const anon = process.env.SUPABASE_ANON_KEY?.trim();
	if (!url || !anon) {
		return "";
	}
	const cfg = JSON.stringify({ url, anonKey: anon }).replace(/</g, "\\u003c");
	const importMapJson = JSON.stringify({
		imports: {
			"@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2.39.0"
		}
	}).replace(/</g, "\\u003c");
	return (
		`<script type="importmap">${importMapJson}</script>` +
		`\n\t\t<script>window.__PRSN_SUPABASE__=${cfg};</script>`
	);
}

function getCommonHead() {
	return html`
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark" />
		<meta name="supported-color-schemes" content="light dark" />
		<meta name="description" content="parascene is a community that uses AI, ML, and algorithms to support creation. Join us for creativity, entertainment, and involvement." />
		<meta name="theme-color" content="#242131" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-title" content="Parascene" />
		<meta name="description" content="{{PAGE_META_DESCRIPTION}}" />

		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<link rel="apple-touch-icon" href="/icons/icon-180.png" />

		<link rel="preconnect" href="https://fonts.googleapis.com">
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
		<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
		<link rel="stylesheet" href="/global.css{{V}}" />
		<meta name="asset-version" content="{{V_PARAM}}" />
		{{PRSN_SUPABASE_BOOT}}
		<script type="module" src="/entry.js{{V}}"></script>
		{{CANONICAL_LINK}}
		{{OG_URL_TAG}}
	`.trimEnd();
}

/** Build canonical link tag for a given URL. */
export function getCanonicalLinkHtml(canonicalUrl) {
	if (!canonicalUrl) return "";
	const u = String(canonicalUrl);
	const escaped = u
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return `<link rel="canonical" href="${escaped}" />`;
}

/** Self-referencing canonical link tag for the current request. Composes getCanonicalUrlForRequest + getCanonicalLinkHtml. */
export function getCanonicalLinkForRequest(req) {
	return getCanonicalLinkHtml(getCanonicalUrlForRequest(req));
}

/**
 * Replace {{TOKEN}} placeholders in HTML. Use short token names (e.g. {{V}}) so if
 * replacement is ever skipped, the raw placeholder is less obvious in the output.
 * extraTokens: { TOKEN_NAME: "value" }.
 */
function replacePageTokens(htmlContent, extraTokens) {
	if (!extraTokens || typeof extraTokens !== "object") return htmlContent;
	let out = String(htmlContent ?? "");
	for (const [key, value] of Object.entries(extraTokens)) {
		out = out.split(`{{${key}}}`).join(String(value ?? ""));
	}
	return out;
}

export function injectCommonHead(htmlContent, extraTokens) {
	// Inject common head elements before existing head content
	const headMatch = htmlContent.match(/<head>([\s\S]*?)<\/head>/i);
	if (!headMatch) {
		return replacePageTokens(htmlContent, extraTokens);
	}

	const commonHead = getCommonHead();
	const existingHeadContent = headMatch[1];
	const tokens = { CANONICAL_LINK: "", PRSN_SUPABASE_BOOT: "", ...extraTokens };
	const withHead = htmlContent.replace(/<head>[\s\S]*?<\/head>/i, `<head>\n${commonHead}${existingHeadContent}</head>`);
	return replacePageTokens(withHead, tokens);
}
