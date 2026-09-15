/** Creation GPU wait: in line (queued/pending) vs generating (processing/running). */

const IN_FLIGHT = new Set(["creating", "queued", "pending", "processing", "running"]);

const WATCH_SVG =
	'<svg class="creation-wait-watch" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><polyline points="12 10 12 12 13.5 13"></polyline><path d="m16.13 7.66-.81-1.41a2 2 0 0 0-1.74-1h-3.16a2 2 0 0 0-1.74 1l-.81 1.41"></path><path d="m16.13 16.34-.81 1.41a2 2 0 0 1-1.74 1h-3.16a2 2 0 0 1-1.74-1l-.81-1.41"></path></svg>';

const COG_PATH =
	'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>';

const GEARS_SVG =
	`<span class="creation-wait-gears" aria-hidden="true"><svg class="creation-wait-gear creation-wait-gear--lg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_PATH}</svg><svg class="creation-wait-gear creation-wait-gear--sm" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${COG_PATH}</svg></span>`;

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

export function creationGpuWaitLabel(status) {
	if (isCreationGenerating(status)) return "Generating…";
	if (isCreationGpuInFlight(status)) return "QUEUED";
	return "";
}

export function creationGpuWaitDetail(status, place) {
	if (isCreationGenerating(status)) return "";
	if (!isCreationGpuInFlight(status)) return "";
	const n = Number(place);
	return Number.isFinite(n) && n > 0 ? `${n} in line` : "";
}

export function isCreationFinishTimedOut(status, meta, now = Date.now()) {
	const s = String(status ?? "").trim().toLowerCase();
	if (s === "queued" || s === "pending") return false;
	if (s !== "processing" && s !== "running" && s !== "creating") return false;
	const raw = meta && typeof meta === "object" ? meta.timeout_at : null;
	const timeoutAt = typeof raw === "string" ? new Date(raw).getTime() : NaN;
	return Number.isFinite(timeoutAt) && now > timeoutAt;
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

export function creationGpuWaitMarkup(status, place, { escapeHtml = escapeHtmlDefault } = {}) {
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
