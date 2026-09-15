/** Creation GPU wait: in line (queued/pending) vs generating (processing/running). */

const IN_FLIGHT = new Set(["creating", "queued", "pending", "processing", "running"]);

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

export function creationGpuWaitLabel(status, place) {
	if (isCreationGenerating(status)) return "Generating…";
	if (isCreationGpuInFlight(status)) {
		const n = Number(place);
		return Number.isFinite(n) && n > 0 ? `In line · ${n}` : "In line";
	}
	return "";
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
	const n = Number(meta?.line_place);
	return Number.isFinite(n) && n > 0 ? n : null;
}
