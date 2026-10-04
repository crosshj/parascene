/**
 * Stable browser client id (prsn_cid cookie) linkage for registered users.
 * Profile meta field: meta.prsn_cids — unique string[], server-maintained.
 */

/** Max client ids stored per user (oldest dropped first). */
const MAX_PRSN_CIDS = 64;

/**
 * @param {import("express").Request} req
 * @returns {string|null}
 */
export function getClientIdFromRequest(req) {
	const a = typeof req?.clientId === "string" ? req.clientId.trim() : "";
	const b = typeof req?.cookies?.prsn_cid === "string" ? req.cookies.prsn_cid.trim() : "";
	return a || b || null;
}

/**
 * @param {Record<string, unknown>|null|undefined} meta — try/share row meta
 * @returns {string|null}
 */
export function prsnCidFromMeta(meta) {
	if (meta == null || typeof meta !== "object") return null;
	const a = typeof meta.prsn_cid === "string" ? meta.prsn_cid.trim() : "";
	const b = typeof meta.client_id === "string" ? meta.client_id.trim() : "";
	return a || b || null;
}

/**
 * Merge one or more client ids into profile meta, preserving order, uniqueness, and cap.
 * @param {Record<string, unknown>|null|undefined} meta
 * @param {string|string[]|null|undefined} prsnCidOrList
 * @returns {Record<string, unknown>}
 */
export function mergePrsnCidsIntoProfileMeta(meta, prsnCidOrList) {
	const next = meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
	const raw = prsnCidOrList == null ? [] : Array.isArray(prsnCidOrList) ? prsnCidOrList : [prsnCidOrList];
	const existing = Array.isArray(next.prsn_cids) ? [...next.prsn_cids] : [];
	const seen = new Set(
		existing.map((x) => (typeof x === "string" ? x.trim() : String(x))).filter(Boolean)
	);
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const t = item.trim();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		existing.push(t);
	}
	while (existing.length > MAX_PRSN_CIDS) existing.shift();
	next.prsn_cids = existing;
	return next;
}
