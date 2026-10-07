function utcDayStart(value = new Date()) {
	return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function claimedOnUtcDay(lastClaimDate, now = new Date()) {
	if (!lastClaimDate) return false;
	const claim = new Date(lastClaimDate);
	if (Number.isNaN(claim.getTime())) return false;
	return utcDayStart(claim) >= utcDayStart(now);
}

// Unknown, failed, admin, and already-claimed states stay quiet.
// A stale canClaim:true cannot bring the indicator back after today's claim.
export function dailyClaimAvailable(record, now = new Date()) {
	return record?.canClaim === true && !claimedOnUtcDay(record.lastClaimDate, now);
}

export function settleCredits(next, previous, now = new Date()) {
	const incoming = next && typeof next === 'object' ? { ...next } : {};
	const prior = previous && typeof previous === 'object' ? previous : null;
	if (prior && claimedOnUtcDay(prior.lastClaimDate, now) && !claimedOnUtcDay(incoming.lastClaimDate, now)) {
		incoming.lastClaimDate = prior.lastClaimDate;
		incoming.canClaim = false;
		const priorBalance = Number(prior.balance);
		const nextBalance = Number(incoming.balance);
		if (Number.isFinite(priorBalance) && (!Number.isFinite(nextBalance) || priorBalance > nextBalance)) incoming.balance = priorBalance;
	}
	if (claimedOnUtcDay(incoming.lastClaimDate, now)) incoming.canClaim = false;
	return incoming;
}

export function msUntilNextUtcDay(now = new Date()) {
	const next = utcDayStart(now) + 24 * 60 * 60 * 1000;
	return Math.max(0, next - now.getTime());
}

export function creditsControlLabel(count, available) {
	if (!count) return 'Credits';
	return available ? `Credits, ${count}. Daily credits ready to claim` : `Credits, ${count}`;
}
