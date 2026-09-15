/** Blue pending vs running, mapped onto Creation status. */

const IN_LINE = new Set(["pending", "queued", "waiting", "created", ""]);
const GENERATING = new Set(["running", "processing", "in_progress", "starting"]);
const IN_FLIGHT = new Set(["creating", "queued", "pending", "processing", "running"]);

export function gpuWaitFromProviderStatus(status) {
	const s = String(status ?? "").trim().toLowerCase();
	if (GENERATING.has(s)) {
		return { phase: "generating", creationStatus: "processing" };
	}
	if (IN_LINE.has(s)) {
		return { phase: "in_line", creationStatus: "queued" };
	}
	return null;
}

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

export function creationFinishTimeoutMs(method) {
	const m = String(method || "").toLowerCase();
	if (m.includes("video") || m.includes("i2v") || m.includes("ltx")) {
		return 20 * 60_000;
	}
	return 10 * 60_000;
}

export function isCreationFinishTimedOut(status, meta, now = Date.now()) {
	const s = String(status ?? "").trim().toLowerCase();
	if (s === "queued" || s === "pending") return false;
	if (s !== "processing" && s !== "running" && s !== "creating") return false;
	const timeoutAt = meta?.timeout_at ? Date.parse(meta.timeout_at) : NaN;
	return Number.isFinite(timeoutAt) && now > timeoutAt;
}

export function gpuWaitMetaPatch(existingMeta, providerStatus, method, extra = {}) {
	const mapped = gpuWaitFromProviderStatus(providerStatus);
	if (!mapped) return null;
	const patch = {
		provider_status: providerStatus,
		...extra,
	};
	if (mapped.phase === "generating" && !existingMeta?.running_at) {
		const now = Date.now();
		patch.running_at = new Date(now).toISOString();
		patch.timeout_at = new Date(now + creationFinishTimeoutMs(method)).toISOString();
	}
	return { mapped, patch };
}
