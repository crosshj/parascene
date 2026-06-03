/**
 * Feed [beta] opt-in gate (chat SPA). Legacy `/api/feed` unchanged.
 */

export function canAccessFeedBeta(user) {
	if (!user || typeof user !== "object") return false;
	return user.meta?.feedBetaEnabled === true;
}

export function feedBetaEnabledForClient(user) {
	return canAccessFeedBeta(user);
}
