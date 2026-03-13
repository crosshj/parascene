import { buildProviderHeaders } from "./providerAuth.js";
import { scheduleProviderPollJob } from "./scheduleCreationJob.js";
import sharp from "sharp";

const PROVIDER_TIMEOUT_MS = 50_000;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const MAX_PROVIDER_POLL_ATTEMPTS = 60;
const DEFAULT_PROVIDER_POLL_DELAY_SECONDS = 10;

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

function logCreationWarn(...args) {
	console.warn("[Creation]", ...args);
}

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

function isRemoteAsyncEnv() {
	return !!process.env.VERCEL && !!process.env.UPSTASH_QSTASH_TOKEN;
}

function isAsyncAckBody(body, fallbackMethod) {
	if (!body || typeof body !== "object") return false;
	if (body.async !== true) return false;
	if (typeof body.job_id !== "string" || !body.job_id) return false;
	if (typeof body.status !== "string" || !body.status) return false;
	const status = body.status.toLowerCase();
	// Treat any non-terminal async status as an ack; only reject obviously
	// terminal statuses so providers can use custom progress strings like "starting".
	if (["failed", "error"].includes(status)) return false;
	if (body.method && typeof body.method !== "string") return false;
	// If provided, method should match or at least not contradict the requested method.
	if (typeof body.method === "string" && fallbackMethod && body.method !== fallbackMethod) {
		return false;
	}
	return true;
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

function isPng(buffer) {
	return (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	);
}

async function ensurePngBuffer(buffer) {
	if (isPng(buffer)) return buffer;
	try {
		return await sharp(buffer, { failOn: "none" }).png().toBuffer();
	} catch (err) {
		const msg = safeErrorMessage(err);
		const e = new Error(`Failed to convert image to PNG: ${msg}`);
		e.code = "IMAGE_ENCODE_FAILED";
		throw e;
	}
}


async function readProviderErrorPayload(response) {
	if (!response) return { ok: false, body: null, contentType: "" };
	const contentType = response.headers?.get?.("content-type") || "";
	let text = "";
	try {
		text = await response.text();
	} catch {
		text = "";
	}
	if (typeof text === "string" && text.length > 20_000) {
		text = `${text.slice(0, 20_000)}…`;
	}
	if (contentType.includes("application/json")) {
		try {
			return { ok: true, body: JSON.parse(text || "null"), contentType };
		} catch {
			return { ok: true, body: text, contentType };
		}
	}
	return { ok: true, body: text, contentType };
}

function providerBodyToMessage(body) {
	if (body == null) return "";
	if (typeof body === "string") return body.trim();
	if (typeof body === "object") {
		const err = typeof body.error === "string" ? body.error.trim() : "";
		if (err) return err;
		const msg = typeof body.message === "string" ? body.message.trim() : "";
		if (msg) return msg;
		try {
			return JSON.stringify(body);
		} catch {
			return "[provider_error]";
		}
	}
	return String(body);
}

async function fetchImageBufferFromUrl(imageUrl) {
	if (!imageUrl || typeof imageUrl !== "string") {
		const err = new Error("Missing image_url for video thumbnail");
		err.code = "MISSING_IMAGE_URL";
		throw err;
	}
	let response;
	try {
		response = await fetch(imageUrl, {
			method: "GET",
			headers: { Accept: "image/*" },
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
		});
	} catch (err) {
		const e = new Error(`Failed to fetch source image for video: ${safeErrorMessage(err)}`);
		e.code = "SOURCE_IMAGE_FETCH_FAILED";
		throw e;
	}
	if (!response.ok) {
		const e = new Error(`Failed to fetch source image for video: ${response.status} ${response.statusText}`);
		e.code = "SOURCE_IMAGE_FETCH_FAILED";
		throw e;
	}
	const arrayBuffer = await response.arrayBuffer();
	const rawBuffer = Buffer.from(arrayBuffer);
	return ensurePngBuffer(rawBuffer);
}

async function createPlaceholderImageBuffer(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
	return await createPlaceholderImageBufferInternal(width, height);
}

async function createPlaceholderImageBufferInternal(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
	try {
		return await sharp({
			create: { width, height, channels: 4, background: { r: 24, g: 24, b: 32, alpha: 1 } },
		})
			.png()
			.toBuffer();
	} catch (err) {
		const e = new Error(`Failed to generate placeholder image: ${safeErrorMessage(err)}`);
		e.code = "PLACEHOLDER_IMAGE_FAILED";
		throw e;
	}
}

async function finalizeCreationJob({
	queries,
	storage,
	imageId,
	userId,
	server,
	existingMeta,
	credit_cost,
	imageBuffer,
	color,
	width,
	height,
	isVideo,
	videoBuffer,
	videoContentType,
	sourceImageUrlForMeta,
}) {
	// Upload and finalize.
	logCreation("Uploading image to storage");
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${userId}_${imageId}_${timestamp}_${random}.png`;

	const uploadStartTime = Date.now();
	const imageUrl = await storage.uploadImage(imageBuffer, filename);
	const uploadDuration = Date.now() - uploadStartTime;
	logCreation(`Image uploaded in ${uploadDuration}ms`, { filename, url: imageUrl });

	let videoFilename = null;
	let videoUrl = null;
	if (isVideo && videoBuffer && typeof storage.uploadVideo === "function") {
		try {
			const baseExt =
				typeof videoContentType === "string" && videoContentType.startsWith("video/") && videoContentType.split("/")[1]
					? videoContentType.split("/")[1]
					: "mp4";
			const safeExt = baseExt.split("+")[0].split(";")[0].trim() || "mp4";
			videoFilename = `video/${userId}_${imageId}_${timestamp}_${random}.${safeExt}`;
			videoUrl = await storage.uploadVideo(videoBuffer, videoFilename, {
				contentType: videoContentType || "video/mp4",
			});
			logCreation("Video uploaded for creation", { imageId, videoFilename, videoUrl, contentType: videoContentType });
		} catch (err) {
			logCreationWarn("Failed to upload video for creation; continuing with image only", safeErrorMessage(err));
			videoFilename = null;
			videoUrl = null;
		}
	}

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
		media_type: isVideo ? "video" : "image",
		...(isVideo && videoUrl
			? {
					video: {
						filename: videoFilename,
						file_path: videoUrl,
						content_type: videoContentType || "video/mp4",
					},
					source_image_url: sourceImageUrlForMeta,
			  }
			: {}),
	});

	logCreation(`Updating database - marking job as completed`, {
		imageId,
		filename,
		duration_ms: durationMs,
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
			logCreation(`Crediting server owner ${server.user_id} with ${ownerCredits} credits`);
			let ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			if (!ownerCreditsRecord) {
				await queries.insertUserCredits.run(server.user_id, 0, null);
				ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			}
			if (ownerCreditsRecord) {
				await queries.updateUserCreditsBalance.run(server.user_id, ownerCredits);
			}
		} catch (e) {
			logCreationWarn("Failed to credit server owner:", e?.message || e);
		}
	}

	logCreation(`Job completed successfully`, {
		imageId,
		filename,
		width,
		height,
		color,
		total_duration_ms: durationMs,
	});

	return { ok: true, id: imageId, filename, url: imageUrl, width, height, color };
}

export async function runCreationJob({ queries, storage, payload }) {
	const {
		created_image_id,
		user_id,
		server_id,
		method,
		args,
		credit_cost,
		async: asyncRequestedFlag,
	} = payload || {};

	logCreation("runCreationJob started", {
		created_image_id,
		user_id,
		server_id,
		method,
		credit_cost,
		args_keys: args ? Object.keys(args) : []
	});

	if (!created_image_id || !user_id || !server_id || !method) {
		const error = new Error("runCreationJob: missing required payload fields");
		logCreationError("Missing required fields", { created_image_id, user_id, server_id, method });
		throw error;
	}

	const userId = Number(user_id);
	const imageId = Number(created_image_id);

	logCreation(`Fetching image ${imageId} for user ${userId}`);
	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) {
		logCreationWarn(`Image ${imageId} not found for user ${userId} - may have been deleted`);
		// Nothing to do (deleted / wrong user).
		return { ok: false, reason: "not_found" };
	}

	logCreation(`Image ${imageId} found, status: ${image.status || "null"}`);

	// Idempotency: only transition when still creating.
	if (image.status && image.status !== "creating") {
		logCreation(`Skipping job - image ${imageId} already ${image.status}`);
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta);

	logCreation(`Fetching server ${server_id}`);
	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logCreationError(`Server validation failed: ${errorMsg}`, {
			server_id,
			server_found: !!server,
			server_status: server?.status
		});

		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: errorMsg,
		});
		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMeta });

		// Refund if needed.
		if (credit_cost && !(nextMeta && nextMeta.credits_refunded)) {
			logCreation(`Refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMeta, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "invalid_server" };
	}

	logCreation(`Server ${server_id} validated`, {
		server_url: server.server_url,
		server_status: server.status,
		has_auth_token: !!server.auth_token
	});

	let imageBuffer;
	let color = null;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;
	let providerError = null;
	let isVideo = false;
	let videoBuffer = null;
	let videoContentType = null;
	let sourceImageUrlForMeta = null;

	const argsForProvider = args || {};
	const asyncRequested = asyncRequestedFlag === true;
	const providerPayload = asyncRequested
		? { method, args: argsForProvider, async: true }
		: { method, args: argsForProvider };
	console.log("[Creation] Sending to provider:", JSON.stringify(providerPayload, null, 2));

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
			body: JSON.stringify(providerPayload),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		const providerContentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();

		if (!providerResponse.ok) {
			const payload = await readProviderErrorPayload(providerResponse);
			const providerMessage = providerBodyToMessage(payload.body);
			const err = new Error(providerMessage || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: payload.contentType,
				body: payload.body
			};
			throw err;
		}

		// Async JSON path: provider acknowledges async job instead of returning bytes.
		if (providerContentType.includes("application/json")) {
			let body = null;
			try {
				body = await providerResponse.json().catch(() => null);
			} catch {
				body = null;
			}

			const asyncEnv = isRemoteAsyncEnv();
			if (asyncEnv && asyncRequested && isAsyncAckBody(body, method)) {
				const asyncBody = body || {};
				const jobId = asyncBody.job_id;
				const status = asyncBody.status || "processing";
				const startedAtMs = existingMeta && existingMeta.started_at ? Date.parse(existingMeta.started_at) : NaN;
				const ackAtIso = new Date().toISOString();
				const ackAtMs = Date.parse(ackAtIso);
				const durationMs =
					Number.isFinite(startedAtMs) && Number.isFinite(ackAtMs) && ackAtMs >= startedAtMs
						? ackAtMs - startedAtMs
						: null;

				const priorAttempts = Number(existingMeta?.provider_poll_attempts ?? 0);
				const delaySeconds = DEFAULT_PROVIDER_POLL_DELAY_SECONDS;
				const nextPollAtIso = new Date(Date.now() + delaySeconds * 1000).toISOString();

				const nextMeta = mergeMeta(existingMeta, {
					provider_async: true,
					provider_method: asyncBody.method || method,
					provider_job_id: jobId,
					provider_status: status,
					provider_poll_attempts: priorAttempts,
					provider_next_poll_at: nextPollAtIso,
					provider_last_payload: asyncBody,
					...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
				});

				logCreation("Async provider ack received; scheduling first poll", {
					imageId,
					userId,
					job_id: jobId,
					status,
				});

				if (queries.updateCreatedImageMeta?.run) {
					await queries.updateCreatedImageMeta.run(imageId, userId, nextMeta);
				}

				await scheduleProviderPollJob({
					payload: {
						job_type: "poll_provider",
						created_image_id: imageId,
						user_id: userId,
						server_id,
						credit_cost,
					},
					delaySeconds,
					log: console,
				});

				return { ok: true, reason: "async_queued" };
			}

			// JSON but not async-ack: treat as provider error in the same shape as non-2xx.
			const providerMessage = providerBodyToMessage(body);
			const err = new Error(providerMessage || "Provider returned JSON instead of image/video.");
			err.code = "PROVIDER_UNEXPECTED_JSON";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: providerContentType,
				body,
			};
			throw err;
		}

		if (providerContentType.startsWith("video/")) {
			isVideo = true;
			videoContentType = providerContentType || "video/mp4";
			const arrayBuffer = await providerResponse.arrayBuffer();
			videoBuffer = Buffer.from(arrayBuffer);

			let sourceImageUrl =
				(typeof argsForProvider.image_url === "string" && argsForProvider.image_url) ||
				(typeof argsForProvider.image === "string" && argsForProvider.image) ||
				null;
			sourceImageUrlForMeta = sourceImageUrl || null;

			if (sourceImageUrl) {
				try {
					imageBuffer = await fetchImageBufferFromUrl(sourceImageUrl);
				} catch (thumbnailErr) {
					logCreationWarn("Failed to fetch source image for video thumbnail; using placeholder instead", safeErrorMessage(thumbnailErr));
					imageBuffer = await createPlaceholderImageBufferInternal();
				}
			} else {
				logCreationWarn("No image_url or image provided for video; using placeholder thumbnail");
				imageBuffer = await createPlaceholderImageBufferInternal();
			}

			try {
				const meta = await sharp(imageBuffer, { failOn: "none" }).metadata();
				if (typeof meta.width === "number" && meta.width > 0) {
					width = meta.width;
				}
				if (typeof meta.height === "number" && meta.height > 0) {
					height = meta.height;
				}
			} catch {
				// If dimension extraction fails, fall back to defaults.
			}
		} else {
			if (providerContentType && !providerContentType.includes("image/png")) {
				logCreationWarn("Provider returned non-PNG; converting to PNG", { providerContentType });
			}

			const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
			imageBuffer = await ensurePngBuffer(rawBuffer);

			const headerColor = providerResponse.headers.get("X-Image-Color");
			const headerWidth = providerResponse.headers.get("X-Image-Width");
			const headerHeight = providerResponse.headers.get("X-Image-Height");

			if (headerColor) color = headerColor;
			if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
			if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
		}
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

		const errorCode = inferErrorCode(providerError);
		const providerDetails =
			providerError && typeof providerError === "object" && providerError.provider && typeof providerError.provider === "object"
				? providerError.provider
				: null;
		const errorMsg = safeErrorMessage(providerError);
		const providerMsg = providerDetails ? providerBodyToMessage(providerDetails.body) : "";

		logCreationError(`Marking job as failed`, {
			imageId,
			error_code: errorCode,
			error: errorMsg,
			duration_ms: durationMs
		});

		const nextMetaBase = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: errorCode,
			error: providerMsg || errorMsg,
			...(providerDetails ? { provider_error: providerDetails } : {}),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
		});

		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMetaBase });

		// Refund once.
		if (credit_cost && !(nextMetaBase && nextMetaBase.credits_refunded)) {
			logCreation(`Refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMetaBase, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "provider_failed" };
	}

	return await finalizeCreationJob({
		queries,
		storage,
		imageId,
		userId,
		server,
		existingMeta,
		credit_cost,
		imageBuffer,
		color,
		width,
		height,
		isVideo,
		videoBuffer,
		videoContentType,
		sourceImageUrlForMeta,
	});
}

/** Anonymous (try) creation job: same provider flow, anon table + anon storage, no credits. */
export async function runAnonCreationJob({ queries, storage, payload }) {
	const { created_image_anon_id, server_id, method, args } = payload || {};

	logCreation("runAnonCreationJob started", {
		created_image_anon_id,
		server_id,
		method,
		args_keys: args ? Object.keys(args) : []
	});

	if (!created_image_anon_id || !server_id || !method) {
		const error = new Error("runAnonCreationJob: missing required payload fields");
		logCreationError("Missing required fields", {
			created_image_anon_id,
			server_id,
			method
		});
		throw error;
	}

	const imageId = Number(created_image_anon_id);

	const image = await queries.selectCreatedImageAnonById.get(imageId);
	if (!image) {
		logCreationWarn(`Anon image ${imageId} not found`);
		return { ok: false, reason: "not_found" };
	}
	if (image.status && image.status !== "creating") {
		logCreation(`Skipping anon job - image ${imageId} already ${image.status}`);
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta);

	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logCreationError(`Anon server validation failed: ${errorMsg}`, { server_id });
		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: errorMsg
		});
		await queries.updateCreatedImageAnonJobFailed.run(imageId, { meta: nextMeta });
		return { ok: false, reason: "invalid_server" };
	}

	let imageBuffer;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{ "Content-Type": "application/json", Accept: "image/png" },
				server.auth_token
			),
			body: JSON.stringify({ method, args: args || {} }),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		if (!providerResponse.ok) {
			const payloadErr = await readProviderErrorPayload(providerResponse);
			const providerMessage = providerBodyToMessage(payloadErr.body);
			const err = new Error(providerMessage || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: payloadErr.contentType,
				body: payloadErr.body
			};
			throw err;
		}

		const providerContentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
		if (providerContentType && !providerContentType.includes("image/png")) {
			logCreationWarn("Provider returned non-PNG; converting to PNG", { providerContentType });
		}
		const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
		imageBuffer = await ensurePngBuffer(rawBuffer);

		const headerWidth = providerResponse.headers.get("X-Image-Width");
		const headerHeight = providerResponse.headers.get("X-Image-Height");
		if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
		if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
	} catch (err) {
		const startedAtMs = existingMeta?.started_at ? Date.parse(existingMeta.started_at) : NaN;
		const failedAtIso = new Date().toISOString();
		const failedAtMs = Date.parse(failedAtIso);
		const durationMs =
			Number.isFinite(startedAtMs) && Number.isFinite(failedAtMs) && failedAtMs >= startedAtMs
				? failedAtMs - startedAtMs
				: null;
		const errorCode = inferErrorCode(err);
		const providerDetails =
			err && typeof err === "object" && err.provider && typeof err.provider === "object" ? err.provider : null;
		const errorMsg = safeErrorMessage(err);
		const providerMsg = providerDetails ? providerBodyToMessage(providerDetails.body) : "";
		const nextMeta = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: errorCode,
			error: providerMsg || errorMsg,
			...(providerDetails ? { provider_error: providerDetails } : {}),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
		});
		await queries.updateCreatedImageAnonJobFailed.run(imageId, { meta: nextMeta });
		return { ok: false, reason: "provider_failed" };
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `anon_${imageId}_${timestamp}_${random}.png`;

	const imageUrl = await storage.uploadImageAnon(imageBuffer, filename);
	const completedAtIso = new Date().toISOString();
	const startedAtMs = existingMeta?.started_at ? Date.parse(existingMeta.started_at) : NaN;
	const completedAtMs = Date.parse(completedAtIso);
	const durationMs =
		Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs
			? completedAtMs - startedAtMs
			: null;
	const completedMeta = mergeMeta(existingMeta, {
		completed_at: completedAtIso,
		...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
	});

	await queries.updateCreatedImageAnonJobCompleted.run(imageId, {
		filename,
		file_path: imageUrl,
		width,
		height,
		meta: completedMeta,
	});

	await queries.updateTryRequestFulfilledByCreatedImageAnonId?.run?.(imageId, completedAtIso);

	logCreation("Anon job completed", { imageId, filename, width, height });
	return { ok: true, id: imageId, filename, url: imageUrl, width, height };
}

export async function runProviderPollJob({ queries, storage, payload }) {
	const { created_image_id, user_id, server_id, credit_cost } = payload || {};

	logCreation("runProviderPollJob started", {
		created_image_id,
		user_id,
		server_id,
		credit_cost,
	});

	if (!created_image_id || !user_id || !server_id) {
		const error = new Error("runProviderPollJob: missing required payload fields");
		logCreationError("Missing required fields (poll)", { created_image_id, user_id, server_id });
		throw error;
	}

	const userId = Number(user_id);
	const imageId = Number(created_image_id);

	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) {
		logCreationWarn(`Poll: image ${imageId} not found for user ${userId} - may have been deleted`);
		return { ok: false, reason: "not_found" };
	}

	if (image.status && image.status !== "creating") {
		logCreation(`Poll: skipping job - image ${imageId} already ${image.status}`);
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta) || {};
	if (!existingMeta.provider_async || !existingMeta.provider_last_payload) {
		logCreationWarn("Poll: provider_async meta missing; nothing to do", { imageId });
		return { ok: false, reason: "not_async" };
	}

	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logCreationError(`Poll: server validation failed: ${errorMsg}`, {
			server_id,
			server_found: !!server,
			server_status: server?.status,
		});

		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: errorMsg,
			provider_status: "failed",
		});
		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMeta });

		if (credit_cost && !(nextMeta && nextMeta.credits_refunded)) {
			logCreation(`Poll: refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMeta, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "invalid_server" };
	}

	const argsPayload = existingMeta.provider_last_payload;
	let imageBuffer;
	let color = null;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;
	let providerError = null;
	let isVideo = false;
	let videoBuffer = null;
	let videoContentType = null;
	let sourceImageUrlForMeta = null;

	const pollAttempts = Number(existingMeta.provider_poll_attempts ?? 0) + 1;

	try {
		const pollMethod = existingMeta.provider_method || existingMeta.method || payload?.method;
		const pollJobId =
			(argsPayload && typeof argsPayload.job_id === "string" && argsPayload.job_id) ||
			(existingMeta && typeof existingMeta.provider_job_id === "string" && existingMeta.provider_job_id) ||
			null;

		const pollBody = {
			method: pollMethod,
			async: true,
			args: pollJobId ? { job_id: pollJobId } : {},
		};

		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token,
			),
			body: JSON.stringify(pollBody),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		const providerContentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();

		if (!providerResponse.ok) {
			const payloadErr = await readProviderErrorPayload(providerResponse);
			const providerMessage = providerBodyToMessage(payloadErr.body);
			const err = new Error(providerMessage || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: payloadErr.contentType,
				body: payloadErr.body,
			};
			throw err;
		}

		if (providerContentType.includes("application/json")) {
			let body = null;
			try {
				body = await providerResponse.json().catch(() => null);
			} catch {
				body = null;
			}

			if (isAsyncAckBody(body, existingMeta.method)) {
				const asyncBody = body || {};
				const jobId = asyncBody.job_id;
				const status = asyncBody.status || "processing";
				const delaySeconds = DEFAULT_PROVIDER_POLL_DELAY_SECONDS;
				const nextPollAtIso = new Date(Date.now() + delaySeconds * 1000).toISOString();

				const nextMeta = mergeMeta(existingMeta, {
					provider_job_id: jobId,
					provider_status: status,
					provider_poll_attempts: pollAttempts,
					provider_next_poll_at: nextPollAtIso,
					provider_last_payload: asyncBody,
				});

				logCreation("Poll: async provider still processing; scheduling another poll", {
					imageId,
					userId,
					job_id: jobId,
					status,
					poll_attempts: pollAttempts,
				});

				if (queries.updateCreatedImageMeta?.run) {
					await queries.updateCreatedImageMeta.run(imageId, userId, nextMeta);
				}

				if (pollAttempts < MAX_PROVIDER_POLL_ATTEMPTS) {
					await scheduleProviderPollJob({
						payload: {
							job_type: "poll_provider",
							created_image_id: imageId,
							user_id: userId,
							server_id,
							credit_cost,
						},
						delaySeconds,
						log: console,
					});
				} else {
					logCreationWarn("Poll: reached max poll attempts without completion", {
						imageId,
						poll_attempts: pollAttempts,
					});
				}

				return { ok: true, reason: "async_poll_scheduled" };
			}

			const providerMessage = providerBodyToMessage(body);
			const err = new Error(providerMessage || "Provider returned unexpected JSON during poll.");
			err.code = "PROVIDER_UNEXPECTED_JSON";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: providerContentType,
				body,
			};
			throw err;
		}

		if (providerContentType.startsWith("video/")) {
			isVideo = true;
			videoContentType = providerContentType || "video/mp4";
			const arrayBuffer = await providerResponse.arrayBuffer();
			videoBuffer = Buffer.from(arrayBuffer);

			// Use original request args (existingMeta.args) for thumbnail; argsPayload is the provider ack (job_id, status), not the request.
			const originalArgs = existingMeta.args && typeof existingMeta.args === "object" ? existingMeta.args : {};
			let sourceImageUrl =
				(typeof originalArgs.image_url === "string" && originalArgs.image_url) ||
				(typeof originalArgs.image === "string" && originalArgs.image) ||
				(typeof argsPayload.image_url === "string" && argsPayload.image_url) ||
				(typeof argsPayload.image === "string" && argsPayload.image) ||
				null;
			sourceImageUrlForMeta = sourceImageUrl || null;

			if (sourceImageUrl) {
				try {
					imageBuffer = await fetchImageBufferFromUrl(sourceImageUrl);
				} catch (thumbnailErr) {
					logCreationWarn(
						"Poll: failed to fetch source image for video thumbnail; using placeholder instead",
						safeErrorMessage(thumbnailErr),
					);
					imageBuffer = await createPlaceholderImageBufferInternal();
				}
			} else {
				logCreationWarn("Poll: no image_url or image provided for video; using placeholder thumbnail");
				imageBuffer = await createPlaceholderImageBufferInternal();
			}

			try {
				const meta = await sharp(imageBuffer, { failOn: "none" }).metadata();
				if (typeof meta.width === "number" && meta.width > 0) {
					width = meta.width;
				}
				if (typeof meta.height === "number" && meta.height > 0) {
					height = meta.height;
				}
			} catch {
				// If dimension extraction fails, fall back to defaults.
			}
		} else {
			if (providerContentType && !providerContentType.includes("image/png")) {
				logCreationWarn("Poll: provider returned non-PNG; converting to PNG", { providerContentType });
			}

			const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
			imageBuffer = await ensurePngBuffer(rawBuffer);

			const headerColor = providerResponse.headers.get("X-Image-Color");
			const headerWidth = providerResponse.headers.get("X-Image-Width");
			const headerHeight = providerResponse.headers.get("X-Image-Height");

			if (headerColor) color = headerColor;
			if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
			if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
		}
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

		const errorCode = inferErrorCode(providerError);
		const providerDetails =
			providerError && typeof providerError === "object" && providerError.provider && typeof providerError.provider === "object"
				? providerError.provider
				: null;
		const errorMsg = safeErrorMessage(providerError);
		const providerMsg = providerDetails ? providerBodyToMessage(providerDetails.body) : "";

		logCreationError(`Poll: marking job as failed`, {
			imageId,
			error_code: errorCode,
			error: errorMsg,
			duration_ms: durationMs,
		});

		const nextMetaBase = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: errorCode,
			error: providerMsg || errorMsg,
			...(providerDetails ? { provider_error: providerDetails } : {}),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
			provider_status: "failed",
		});

		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMetaBase });

		if (credit_cost && !(nextMetaBase && nextMetaBase.credits_refunded)) {
			logCreation(`Poll: refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMetaBase, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "provider_failed" };
	}

	return await finalizeCreationJob({
		queries,
		storage,
		imageId,
		userId,
		server,
		existingMeta,
		credit_cost,
		imageBuffer,
		color,
		width,
		height,
		isVideo,
		videoBuffer,
		videoContentType,
		sourceImageUrlForMeta,
	});
}

export { PROVIDER_TIMEOUT_MS, fetchImageBufferFromUrl, createPlaceholderImageBuffer };

