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

export function isProviderJobInFlight(meta) {
	const s = String(meta?.provider_status ?? "").trim().toLowerCase();
	return (
		s === "pending" ||
		s === "queued" ||
		s === "waiting" ||
		s === "created" ||
		s === "running" ||
		s === "processing" ||
		s === "in_progress" ||
		s === "starting"
	);
}

export function providerJobIdFromMeta(meta) {
	const fromMeta = typeof meta?.provider_job_id === "string" ? meta.provider_job_id.trim() : "";
	if (fromMeta) return fromMeta;
	const fromPayload =
		typeof meta?.provider_last_payload?.job_id === "string"
			? meta.provider_last_payload.job_id.trim()
			: "";
	return fromPayload || null;
}

/** Failed timeout that still has a Blue job — GET should resume the poller. */
export function isRecoverableTimedOutCreation(status, meta, now = Date.now(), opts = {}) {
	if (String(status ?? "").trim().toLowerCase() !== "failed") return false;
	if (String(meta?.error_code ?? "").trim().toLowerCase() !== "timeout") return false;
	if (!meta?.provider_async) return false;
	if (!providerJobIdFromMeta(meta)) return false;
	if (opts.force) return true;
	const revivedAt = meta?.revived_from_timeout_at ? Date.parse(meta.revived_from_timeout_at) : NaN;
	return !(Number.isFinite(revivedAt) && now - revivedAt < 120_000);
}

export function isCreationFinishTimedOut(status, meta, now = Date.now()) {
	if (isCreationInLine(status)) return false;
	const s = String(status ?? "").trim().toLowerCase();
	if (s !== "processing" && s !== "running") return false;
	const timeoutAt = meta?.timeout_at ? Date.parse(meta.timeout_at) : NaN;
	return Number.isFinite(timeoutAt) && now > timeoutAt;
}

export function isTerminalCompletedProviderStatus(status) {
	const s = String(status ?? "").trim().toLowerCase();
	return s === "completed" || s === "succeeded" || s === "done";
}

/** Keep polls going while Blue still has the job, even past the finish clock. */
export function shouldKeepProviderPoll(status, meta, now = Date.now()) {
	if (isProviderJobInFlight(meta)) return true;
	if (!isCreationGpuInFlight(status)) return false;
	if (isCreationInLine(status)) return true;
	return !isCreationFinishTimedOut(status, meta, now);
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
