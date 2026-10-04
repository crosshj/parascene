/**
 * Normalize a hashtag/tag for URLs and storage (explore, chat channels).
 * Strips leading #; lowercase; must match [a-z0-9][a-z0-9_-]{1,31} (2–32 chars total).
 */
export function normalizeTag(input) {
	const raw =
		typeof input === "string" ? input.trim().replace(/^#+/, "").trim().toLowerCase() : "";
	if (!raw) return null;
	if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(raw)) return null;
	return raw;
}
