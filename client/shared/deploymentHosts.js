function metaContent(name) {
	if (typeof document === "undefined") return "";
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
}

/** Public site origin for this deployment. */
export function deploymentSiteOrigin() {
	return (metaContent("site-origin") || "https://www.parascene.com").replace(/\/$/, "");
}

/** Media origin this deployment uses for uploads and playback. */
export function deploymentCdnOrigin() {
	return (metaContent("cdn-origin") || "https://cdn.parascene.com").replace(/\/$/, "");
}

export function deploymentCdnHost() {
	try {
		return new URL(deploymentCdnOrigin()).hostname.toLowerCase();
	} catch {
		return "cdn.parascene.com";
	}
}

/** Share-link hostname this deployment mints. */
export function deploymentShareHost() {
	return (metaContent("share-host") || "sh.parascene.com").toLowerCase();
}

/** API origin for this deployment. */
export function deploymentApiOrigin() {
	return (metaContent("api-origin") || "https://api.parascene.com").replace(/\/$/, "");
}
