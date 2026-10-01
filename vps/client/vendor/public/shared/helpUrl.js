/**
 * Append asset-version query param to /help URLs so HTML navigations cache-bust like static assets.
 */
export function getHelpHref(path) {
	const v = document.querySelector("meta[name=\"asset-version\"]")?.getAttribute("content")?.trim() || "";
	if (!v || typeof path !== "string" || path.length === 0) return path;
	if (!path.includes("/help")) return path;
	const hashIdx = path.indexOf("#");
	const beforeHash = hashIdx === -1 ? path : path.slice(0, hashIdx);
	const hash = hashIdx === -1 ? "" : path.slice(hashIdx);
	const sep = beforeHash.includes("?") ? "&" : "?";
	return `${beforeHash}${sep}v=${encodeURIComponent(v)}${hash}`;
}
