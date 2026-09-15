/** Creation GPU wait: in line (queued/pending) vs generating (processing/running). */

const IN_FLIGHT = new Set(["creating", "queued", "pending", "processing", "running"]);

const WATCH_SVG =
	'<svg class="creation-wait-watch" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><polyline points="12 10 12 12 13.5 13"></polyline><path d="m16.13 7.66-.81-1.41a2 2 0 0 0-1.74-1h-3.16a2 2 0 0 0-1.74 1l-.81 1.41"></path><path d="m16.13 16.34-.81 1.41a2 2 0 0 1-1.74 1h-3.16a2 2 0 0 1-1.74-1l-.81-1.41"></path></svg>';

const COG_PATH =
	'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>';

const GEARS_SVG =
	`<span class="creation-wait-gears" aria-hidden="true"><svg class="creation-wait-gear creation-wait-gear--lg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_PATH}</svg><svg class="creation-wait-gear creation-wait-gear--sm" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_PATH}</svg></span>`;

const TIMEOUT_SVG =
	'<svg class="creation-wait-timeout" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4"></path><path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7"></path><path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1-1 10.3"></path><path d="m2 2 20 20"></path><path d="M12 12v-2"></path></svg>';

export function isCreationGpuInFlight(status) {
	return IN_FLIGHT.has(String(status ?? "").trim().toLowerCase());
}

export function isCreationInLine(status) {
	const s = String(status ?? "").trim().toLowerCase();
	return s === "creating" || s === "queued" || s === "pending";
}

export function isCreationGenerating(status) {
	const s = String(status ?? "").trim().toLowerCase();
	return s === "processing" || s === "running";
}

export function creationGpuWaitLabel(status, place, opts = {}) {
	if (opts.timedOut || isCreationTimedOutDisplay(status, opts.meta)) return "TIMED OUT";
	if (isCreationGenerating(status)) return "Generating…";
	if (isCreationGpuInFlight(status)) return "QUEUED";
	return "";
}

export function creationGpuWaitDetail(status, place, opts = {}) {
	if (opts.timedOut || isCreationTimedOutDisplay(status, opts.meta)) {
		return "Check again to see if it finished.";
	}
	if (isCreationGenerating(status)) return "";
	if (!isCreationGpuInFlight(status)) return "";
	const n = Number(place);
	return Number.isFinite(n) && n > 0 ? `${n} in line` : "";
}

export function isCreationFinishTimedOut(status, meta, now = Date.now()) {
	const s = String(status ?? "").trim().toLowerCase();
	if (s === "creating" || s === "queued" || s === "pending") return false;
	if (s !== "processing" && s !== "running") return false;
	const raw = meta && typeof meta === "object" ? meta.timeout_at : null;
	const timeoutAt = typeof raw === "string" ? new Date(raw).getTime() : NaN;
	return Number.isFinite(timeoutAt) && now > timeoutAt;
}

export function isCreationTimedOutDisplay(status, meta) {
	const s = String(status ?? "").trim().toLowerCase();
	if (s === "timed_out" || s === "timeout") return true;
	if (String(meta?.error_code ?? "").trim().toLowerCase() === "timeout") return true;
	return isCreationFinishTimedOut(status, meta);
}

export function creationLinePlace(meta) {
	const n = Number(meta?.line_place ?? meta?.provider_last_payload?.place);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function escapeHtmlDefault(str) {
	return String(str ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function creationGpuWaitMarkup(status, place, { escapeHtml = escapeHtmlDefault, timedOut = false, meta = null } = {}) {
	const expired = timedOut || isCreationTimedOutDisplay(status, meta);
	if (expired) {
		const label = creationGpuWaitLabel(status, place, { timedOut: true, meta });
		return `<span class="route-media-wait is-timeout" data-creation-gpu-wait>${TIMEOUT_SVG}<span class="route-media-wait-label">${escapeHtml(label)}</span></span>`;
	}
	const label = creationGpuWaitLabel(status);
	const generating = isCreationGenerating(status);
	const kind = generating ? "generating" : "queued";
	const n = Number(place);
	const badge =
		!generating && Number.isFinite(n) && n > 0
			? `<span class="creation-wait-place">${escapeHtml(String(n))}</span>`
			: "";
	const icon = generating ? GEARS_SVG : `<span class="creation-wait-icon">${WATCH_SVG}${badge}</span>`;
	return `<span class="route-media-wait is-${kind}" data-creation-gpu-wait>${icon}<span class="route-media-wait-label">${escapeHtml(label)}</span></span>`;
}

export function creationCanRecheckAfterTimeout(status, meta) {
	if (String(status ?? "").trim().toLowerCase() !== "failed") return false;
	if (String(meta?.error_code ?? "").trim().toLowerCase() !== "timeout") return false;
	const jobId =
		(typeof meta?.provider_job_id === "string" && meta.provider_job_id.trim()) ||
		(typeof meta?.provider_last_payload?.job_id === "string" &&
			meta.provider_last_payload.job_id.trim());
	return Boolean(jobId);
}
