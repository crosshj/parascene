/** Credits Boost price shared by the create API and the client occupancy dialog. */

export const PRODUCT_MAX_CAP = 50;
export const PRODUCT_BOOST_STEP = 0.5;

function listCost(cost) {
	return Number.isFinite(cost) && cost > 0 ? cost : 0.1;
}

function snapToHalf(n) {
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 2) / 2;
}

export function productSliderRange(cost) {
	const min = listCost(cost);
	return { min, max: Math.max(PRODUCT_MAX_CAP, min) };
}

/** Credits Boost slider: 0 at list, +0.5 steps, total clamped at the cap. */
export function productBoostRange(cost) {
	const { min: list, max: cap } = productSliderRange(cost);
	const max = Math.max(0, Math.floor((cap - list) / PRODUCT_BOOST_STEP) * PRODUCT_BOOST_STEP);
	return { min: 0, max, step: PRODUCT_BOOST_STEP };
}

export function namedPriceFromBoost(cost, boost) {
	const { min: list, max: cap } = productSliderRange(cost);
	const { max: maxBoost } = productBoostRange(list);
	const raw = Number(boost);
	const b = Number.isFinite(raw) ? Math.min(maxBoost, Math.max(0, snapToHalf(raw))) : 0;
	return Math.min(cap, Math.round((list + b) * 10) / 10);
}

export function boostFromNamedPrice(cost, named) {
	const { min: list } = productSliderRange(cost);
	const { max: maxBoost } = productBoostRange(list);
	const raw = Number(named);
	if (!Number.isFinite(raw)) return 0;
	return Math.min(maxBoost, Math.max(0, snapToHalf(raw - list)));
}

export function formatCreditsBoost(boost) {
	const snapped = snapToHalf(Number.isFinite(boost) ? boost : 0);
	if (snapped <= 0) return '0';
	return snapped % 1 === 0 ? `+${snapped}` : `+${snapped.toFixed(1)}`;
}

export function clampProductBoost(raw, cost) {
	const { max } = productBoostRange(cost);
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(max, Math.max(0, snapToHalf(n)));
}

export function clampProductMaxBid(raw, cost) {
	return namedPriceFromBoost(cost, clampProductBoost(raw, cost));
}

/** Charge list + boost. `rawMaxBid` is Credits Boost, not the job total. */
export function resolveProductNamedPrice(rawMaxBid, list) {
	const boost = clampProductBoost(rawMaxBid, list);
	return {
		ok: true,
		cost: namedPriceFromBoost(list, boost),
		max_bid: boost
	};
}
