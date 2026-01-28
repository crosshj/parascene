import { buildProviderHeaders } from "./providerAuth.js";

const PROVIDER_TIMEOUT_MS = 50_000;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function mergeMeta(existing, patch) {
	const base = existing && typeof existing === "object" ? existing : {};
	const next = { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
	return next;
}

function inferErrorCode(err) {
	if (!err) return "unknown";
	if (err.name === "AbortError") return "timeout";
	return "provider_error";
}

function safeErrorMessage(err) {
	if (!err) return "Unknown error";
	if (typeof err === "string") return err;
	if (err instanceof Error) return err.message || "Error";
	try {
		return JSON.stringify(err);
	} catch {
		return "Error";
	}
}

export async function runCreationJob({ queries, storage, payload }) {

	console.log("runCreationJob", payload);

	const {
		created_image_id,
		user_id,
		server_id,
		method,
		args,
		credit_cost,
	} = payload || {};

	if (!created_image_id || !user_id || !server_id || !method) {
		throw new Error("runCreationJob: missing required payload fields");
	}

	const userId = Number(user_id);
	const imageId = Number(created_image_id);

	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) {
		// Nothing to do (deleted / wrong user).
		return { ok: false, reason: "not_found" };
	}

	// Idempotency: only transition when still creating.
	if (image.status && image.status !== "creating") {
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta);

	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: !server ? "Server not found" : "Server is not active",
		});
		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMeta });

		// Refund if needed.
		if (credit_cost && !(nextMeta && nextMeta.credits_refunded)) {
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMeta, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "invalid_server" };
	}

	let imageBuffer;
	let color = null;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;
	let providerError = null;

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token
			),
			body: JSON.stringify({ method, args: args || {} }),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		if (!providerResponse.ok) {
			const err = new Error(`Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			throw err;
		}

		imageBuffer = Buffer.from(await providerResponse.arrayBuffer());

		const headerColor = providerResponse.headers.get("X-Image-Color");
		const headerWidth = providerResponse.headers.get("X-Image-Width");
		const headerHeight = providerResponse.headers.get("X-Image-Height");

		if (headerColor) color = headerColor;
		if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
		if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
	} catch (err) {
		providerError = err;
	}

	if (providerError) {
		const startedAtMs = existingMeta && existingMeta.started_at ? Date.parse(existingMeta.started_at) : NaN;
		const failedAtIso = new Date().toISOString();
		const failedAtMs = Date.parse(failedAtIso);
		const durationMs =
			Number.isFinite(startedAtMs) && Number.isFinite(failedAtMs) && failedAtMs >= startedAtMs
				? failedAtMs - startedAtMs
				: null;

		const nextMetaBase = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: inferErrorCode(providerError),
			error: safeErrorMessage(providerError),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
		});

		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMetaBase });

		// Refund once.
		if (credit_cost && !(nextMetaBase && nextMetaBase.credits_refunded)) {
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMetaBase, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "provider_failed" };
	}

	// Upload and finalize.
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${userId}_${imageId}_${timestamp}_${random}.png`;
	const imageUrl = await storage.uploadImage(imageBuffer, filename);

	const completedAtIso = new Date().toISOString();
	const startedAtMs = existingMeta && existingMeta.started_at ? Date.parse(existingMeta.started_at) : NaN;
	const completedAtMs = Date.parse(completedAtIso);
	const durationMs =
		Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs
			? completedAtMs - startedAtMs
			: null;

	const completedMeta = mergeMeta(existingMeta, {
		completed_at: completedAtIso,
		...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
	});

	await queries.updateCreatedImageJobCompleted.run(imageId, userId, {
		filename,
		file_path: imageUrl,
		width,
		height,
		color,
		meta: completedMeta,
	});

	// Credit server owner (30% of what user was charged), best-effort.
	const ownerCredits = Number(credit_cost || 0) * 0.3;
	if (server.user_id && ownerCredits > 0) {
		try {
			let ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			if (!ownerCreditsRecord) {
				await queries.insertUserCredits.run(server.user_id, 0, null);
				ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			}
			if (ownerCreditsRecord) {
				await queries.updateUserCreditsBalance.run(server.user_id, ownerCredits);
			}
		} catch (e) {
			console.warn("Failed to credit server owner:", e?.message || e);
		}
	}

	return { ok: true, id: imageId, filename, url: imageUrl, width, height, color };
}

export { PROVIDER_TIMEOUT_MS };

