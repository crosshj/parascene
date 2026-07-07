/**
 * Shared helpers for landing funnel blocks on visit pulse reports.
 * Data: prsn_visit_pulse_days.details.landing_funnel.by_variant
 */

export const LANDING_FUNNEL_EVENTS = ["view", "video_play", "video_complete", "cta_click"];

/** @param {object|null|undefined} landingFunnel */
export function mergeLandingFunnelVariants(landingFunnel) {
	const by = landingFunnel?.by_variant;
	if (!by || typeof by !== "object" || !Object.keys(by).length) return null;

	const merged = { variants: by };
	for (const event of LANDING_FUNNEL_EVENTS) {
		merged[`${event}_total`] = 0;
		merged[`${event}_unique`] = 0;
	}
	for (const snap of Object.values(by)) {
		if (!snap || typeof snap !== "object") continue;
		for (const event of LANDING_FUNNEL_EVENTS) {
			merged[`${event}_total`] += Number(snap[`${event}_total`]) || 0;
			merged[`${event}_unique`] += Number(snap[`${event}_unique`]) || 0;
		}
	}
	return merged;
}

/** @param {object|null|undefined} landingFunnel */
export function landingFunnelHasData(landingFunnel) {
	const merged = mergeLandingFunnelVariants(landingFunnel);
	return Boolean(merged && merged.view_total > 0);
}

/** @param {object|null|undefined} row pulse day row */
export function landingMetricsFromPulseRow(row) {
	const merged = mergeLandingFunnelVariants(row?.details?.landing_funnel);
	if (!merged || !merged.view_total) return null;
	return {
		landing_view_unique: merged.view_unique,
		landing_view_total: merged.view_total,
		landing_play_unique: merged.video_play_unique,
		landing_play_total: merged.video_play_total,
		landing_complete_unique: merged.video_complete_unique,
		landing_complete_total: merged.video_complete_total,
		landing_cta_unique: merged.cta_click_unique,
		landing_cta_total: merged.cta_click_total
	};
}

function funnelPct(num, denom) {
	const n = Number(num) || 0;
	const d = Number(denom) || 0;
	if (d <= 0) return null;
	return `${Math.round((n / d) * 100)}%`;
}

/**
 * @param {object|null|undefined} landingFunnel
 * @param {(s: unknown) => string} esc
 */
export function buildLandingFunnelSectionHtml(landingFunnel, esc) {
	const merged = mergeLandingFunnelVariants(landingFunnel);
	if (!merged || !merged.view_total) {
		return '<p class="small">No landing funnel recorded for this day.</p>';
	}

	const variantKeys = Object.keys(merged.variants || {});
	const variantNote =
		variantKeys.length === 1
			? `Variant: ${esc(variantKeys[0])}.`
			: `Variants: ${esc(variantKeys.join(", "))}.`;

	const playRate = funnelPct(merged.video_play_unique, merged.view_unique);
	const completeRate = funnelPct(merged.video_complete_unique, merged.video_play_unique);
	const ctaRate = funnelPct(merged.cta_click_unique, merged.view_unique);

	const ratesLine = [
		playRate && `play ${playRate} of views`,
		completeRate && `complete ${completeRate} of plays`,
		ctaRate && `CTA ${ctaRate} of views`
	]
		.filter(Boolean)
		.join(" · ");

	return `<div class="grid">
		<div class="card">
			<div class="small">Landing views</div>
			<div>${esc(String(merged.view_unique))} <span class="small">(${esc(String(merged.view_total))} total)</span></div>
		</div>
		<div class="card">
			<div class="small">Video play</div>
			<div>${esc(String(merged.video_play_unique))} <span class="small">(${esc(String(merged.video_play_total))} total)</span></div>
		</div>
		<div class="card">
			<div class="small">Video complete</div>
			<div>${esc(String(merged.video_complete_unique))} <span class="small">(${esc(String(merged.video_complete_total))} total)</span></div>
		</div>
		<div class="card">
			<div class="small">CTA click</div>
			<div>${esc(String(merged.cta_click_unique))} <span class="small">(${esc(String(merged.cta_click_total))} total)</span></div>
		</div>
	</div>
	<p class="small">${variantNote} Logged-out GET / and client beacons (play, complete, CTA), flushed with visit pulse.${ratesLine ? ` Unique funnel: ${esc(ratesLine)}.` : ""}</p>`;
}
