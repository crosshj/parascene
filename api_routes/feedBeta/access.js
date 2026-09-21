/** Feed algorithm gate. Everyone gets the ranked feed unless they explicitly opt out. */
export function canAccessFeedBeta(user) {
	if (!user || typeof user !== "object") return false;
	return user.meta?.forceLegacyFeed !== true;
}
