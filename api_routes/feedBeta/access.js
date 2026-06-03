/**
 * Feed [beta] opt-in gate. When true, GET /api/feed uses pullFeedBetaRows.
 * Users opted into beta may set meta.forceLegacyFeed to use the classic follow feed.
 */

export function isFeedBetaOptedIn(user) {
	if (!user || typeof user !== "object") return false;
	return user.meta?.feedBetaEnabled === true;
}

export function canAccessFeedBeta(user) {
	if (!isFeedBetaOptedIn(user)) return false;
	return user.meta?.forceLegacyFeed !== true;
}

export function feedBetaEnabledForClient(user) {
	return canAccessFeedBeta(user);
}
