/**
 * @param {unknown} body
 * @returns {object | null}
 */
export function tryParseChallengeJson(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null;
	try {
		const o = JSON.parse(s);
		return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}
