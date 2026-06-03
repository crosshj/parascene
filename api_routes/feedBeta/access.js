/**
 * Feed [beta] opt-in gate. When true, GET /api/feed uses pullFeedBetaRows.
 */

export function canAccessFeedBeta(user) {
	if (!user || typeof user !== "object") return false;
	return user.meta?.feedBetaEnabled === true;
}

export function feedBetaEnabledForClient(user) {
	return canAccessFeedBeta(user);
}
