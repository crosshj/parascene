/**
 * @param {unknown} body
 * @returns {object | null}
 */
function tryParseChallengeJson(body) {
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

/**
 * @param {object[]} messages chronological
 * @returns {{ configs: { msg: object, payload: object }[], submissions: { msg: object, payload: object }[] }}
 */
export function extractChallengeEvents(messages) {
	const configs = [];
	const submissions = [];

	for (const m of messages) {
		const payload = tryParseChallengeJson(m?.body);
		if (!payload) continue;
		const kind = typeof payload.kind === 'string' ? payload.kind.trim() : '';
		if (kind === 'challenge_config') {
			configs.push({ msg: m, payload });
			continue;
		}
		if (kind === 'challenge_submission') {
			submissions.push({ msg: m, payload });
		}
	}

	return { configs, submissions };
}
