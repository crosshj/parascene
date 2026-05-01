/**
 * @param {unknown} ms
 * @returns {number | null}
 */
export function parseIso(ms) {
	if (ms == null) return null;
	const t = Date.parse(String(ms));
	return Number.isFinite(t) ? t : null;
}
