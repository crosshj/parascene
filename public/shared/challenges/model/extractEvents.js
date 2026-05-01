import { tryParseChallengeJson } from './parseJson.js';

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
