/**
 * /challenges/details/:challengeId routing helpers.
 */

/**
 * @param {string | null | undefined} challengeId
 * @returns {string}
 */
export function challengesDetailsHref(challengeId) {
	const cid = String(challengeId || '').trim();
	if (!cid) return '/challenges/details';
	return `/challenges/details/${encodeURIComponent(cid)}`;
}

/**
 * @param {string | null | undefined} pathname
 * @returns {{ challengeId: string } | null}
 */
export function parseChallengesDetailsPath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	if (p === '/challenges/details') return { challengeId: '' };
	const prefix = '/challenges/details/';
	if (!p.startsWith(prefix)) return null;
	let rest = p.slice(prefix.length);
	try {
		rest = decodeURIComponent(rest);
	} catch {
		// keep raw
	}
	const challengeId = String(rest.split('/').filter(Boolean)[0] || '').trim();
	return { challengeId };
}

/**
 * @param {string | null | undefined} pathname
 * @returns {boolean}
 */
export function isChallengesDetailsPathname(pathname) {
	return parseChallengesDetailsPath(pathname) != null;
}
