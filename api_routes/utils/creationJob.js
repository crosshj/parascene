import { buildProviderHeaders } from "./providerAuth.js";
import { scheduleProviderPollJob } from "./scheduleCreationJob.js";
import sharp from "sharp";

const PROVIDER_TIMEOUT_MS = 50_000;
/** When the provider returns finished video bytes (sync or async poll), allow long downloads. Override with CREATION_PROVIDER_VIDEO_FETCH_TIMEOUT_MS (ms, min 10000). */
const PROVIDER_VIDEO_FETCH_TIMEOUT_MS = (() => {
	const n = Number(process.env.CREATION_PROVIDER_VIDEO_FETCH_TIMEOUT_MS);
	return Number.isFinite(n) && n >= 10_000 ? n : 600_000;
})();
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

function creationMethodMayReturnVideoBytes(method) {
	const m = String(method || "").toLowerCase();
	return m.includes("video") || m.includes("i2v") || m.includes("ltx");
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
			logCreationError(
				`Failed to upload video for creation; refusing to mark job complete without meta.video (${videoBuffer?.length ?? 0} bytes from provider)`,
				safeErrorMessage(err),
			);
			videoFilename = null;
			videoUrl = null;
		}
	}

	if (isVideo && !videoUrl) {
		const detail =
			!videoBuffer
				? "Video completion requested but no video bytes were available to store."
				: typeof storage.uploadVideo !== "function"
					? "Video bytes were returned but storage.uploadVideo is not configured."
					: "Video bytes could not be uploaded to storage.";
		const err = new Error(`${detail} Refusing to mark creation ${imageId} completed as video.`);
		err.code = "VIDEO_STORAGE_FAILED";
		throw err;
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
	const providerFetchTimeoutMs =
		asyncRequested ? PROVIDER_TIMEOUT_MS : creationMethodMayReturnVideoBytes(method) ? PROVIDER_VIDEO_FETCH_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
	console.log("[Creation] Sending to provider:", JSON.stringify(providerPayload, null, 2));

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token,
				server.server_config?.custom_headers
			),
			body: JSON.stringify(providerPayload),
			signal: AbortSignal.timeout(providerFetchTimeoutMs),
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

			if (asyncRequested && isAsyncAckBody(body, method)) {
				const asyncEnv = isRemoteAsyncEnv();
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

				if (asyncEnv) {
					// Cloud: schedule polling via QStash worker.
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

				// Local: run the same polling state machine in-process so dev
				// mirrors cloud behavior without requiring QStash.

				// Fire-and-forget first poll; subsequent polls schedule themselves.
				queueMicrotask(() => {
					Promise.resolve(
						runProviderPollJob({
							queries,
							storage,
							payload: {
								created_image_id: imageId,
								user_id: userId,
								server_id,
								credit_cost,
							},
						}),
					).catch((err) => {
						void err;
					});
				});

				return { ok: true, reason: "async_queued_local" };
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
				(Array.isArray(argsForProvider.input_images) &&
					typeof argsForProvider.input_images[0] === "string" &&
					argsForProvider.input_images[0]) ||
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
				server.auth_token,
				server.server_config?.custom_headers
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
				server.server_config?.custom_headers
			),
			body: JSON.stringify(pollBody),
			signal: AbortSignal.timeout(PROVIDER_VIDEO_FETCH_TIMEOUT_MS),
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
				const asyncEnv = isRemoteAsyncEnv();
				const asyncBody = body || {};
				const jobId = asyncBody.job_id;
				const status = asyncBody.status || "processing";
				const statusLower = status.toLowerCase();

				// If provider reports a terminal completed status in JSON, treat that as
				// end-of-polling and do NOT schedule further polls. The image row will
				// already have been finalized by the bytes response.
				if (["completed", "succeeded", "done"].includes(statusLower)) {
					const nextMeta = mergeMeta(existingMeta, {
						provider_job_id: jobId,
						provider_status: status,
						provider_last_payload: asyncBody,
					});

					if (queries.updateCreatedImageMeta?.run) {
						await queries.updateCreatedImageMeta.run(imageId, userId, nextMeta);
					}

					return { ok: true, reason: "async_poll_completed" };
				}

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
					if (asyncEnv) {
						// Cloud: enqueue next poll via QStash worker.
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
						// Local: schedule next poll in-process with a delay to mirror QStash timing.
						setTimeout(() => {
							Promise.resolve(
								runProviderPollJob({
									queries,
									storage,
									payload: {
										created_image_id: imageId,
										user_id: userId,
										server_id,
										credit_cost,
									},
								}),
							).catch((err) => {
								void err;
							});
						}, delaySeconds * 1000);
					}
				} else {
					logCreationWarn("Poll: reached max poll attempts without completion", {
						imageId,
						poll_attempts: pollAttempts,
					});
				}

				return { ok: true, reason: asyncEnv ? "async_poll_scheduled" : "async_poll_scheduled_local" };
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
				(Array.isArray(originalArgs.input_images) &&
					typeof originalArgs.input_images[0] === "string" &&
					originalArgs.input_images[0]) ||
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

const DEFAULT_REPAIR_VIDEO_TIMEOUT_MS = PROVIDER_VIDEO_FETCH_TIMEOUT_MS;
const DEFAULT_REPAIR_MAX_VIDEO_BYTES = 150 * 1024 * 1024;

/**
 * Resolve DB rows + poll body for async provider jobs (probe / repair).
 * @returns {Promise<
 *   | { ok: false; reason: string; message?: string; server_id?: number }
 *   | {
 * 			ok: true;
 * 			image: object;
 * 			server: object;
 * 			existingMeta: Record<string, unknown>;
 * 			pollBody: { method: string; async: boolean; args: { job_id: string } };
 * 			imageId: number;
 * 			serverId: number;
 * 			baseOut: Record<string, unknown>;
 * 		}
 * >}
 */
async function resolveProviderAsyncPollContext(queries, createdImageId) {
	const imageId = Number(createdImageId);
	if (!Number.isFinite(imageId) || imageId < 1) {
		return { ok: false, reason: "invalid_id" };
	}
	const getAny = queries.selectCreatedImageByIdAnyUser?.get;
	if (typeof getAny !== "function") {
		return { ok: false, reason: "missing_db_query" };
	}
	const image = await getAny(imageId);
	if (!image) {
		return { ok: false, reason: "not_found" };
	}
	const existingMeta = parseMeta(image.meta) || {};
	const serverId = Number(existingMeta.server_id);
	if (!Number.isFinite(serverId) || serverId < 1) {
		return {
			ok: false,
			reason: "missing_server_id",
			message: "meta.server_id is missing; cannot reach the provider for this creation.",
		};
	}
	const getServer = queries.selectServerById?.get;
	if (typeof getServer !== "function") {
		return { ok: false, reason: "missing_db_query" };
	}
	const server = await getServer(serverId);
	if (!server?.server_url) {
		return { ok: false, reason: "server_not_found", server_id: serverId };
	}
	const argsPayload = existingMeta.provider_last_payload;
	const pollJobId =
		(argsPayload && typeof argsPayload.job_id === "string" && argsPayload.job_id) ||
		(typeof existingMeta.provider_job_id === "string" && existingMeta.provider_job_id) ||
		null;
	if (!pollJobId) {
		return {
			ok: false,
			reason: "missing_job_id",
			message: "meta.provider_job_id (or provider_last_payload.job_id) is missing.",
		};
	}
	const pollMethod = existingMeta.provider_method || existingMeta.method;
	if (!pollMethod || typeof pollMethod !== "string") {
		return { ok: false, reason: "missing_method", message: "meta.provider_method / meta.method missing." };
	}
	const pollBody = {
		method: pollMethod,
		async: true,
		args: { job_id: pollJobId },
	};
	const baseOut = {
		ok: true,
		created_image_id: imageId,
		poll_body: pollBody,
		server_id: serverId,
		server_url: server.server_url,
		server_row_status: server.status || null,
		creation_row_status: image.status || null,
	};
	return {
		ok: true,
		image,
		server,
		existingMeta,
		pollBody,
		imageId,
		serverId,
		baseOut,
	};
}

async function completeRepairAfterVideoBytes({
	baseOut,
	image,
	existingMeta,
	imageId,
	userId,
	queries,
	storage,
	maxVideoBytes,
	videoBuf,
	contentType,
	provider_http_status,
}) {
	const httpStatus = provider_http_status ?? 200;
	const ctLower = String(contentType || "").toLowerCase();
	if (!videoBuf || videoBuf.length === 0) {
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: ctLower,
			summary: "Empty video body.",
		};
	}
	if (videoBuf.length > maxVideoBytes) {
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			video_byte_length: videoBuf.length,
			summary: `Body (${videoBuf.length} B) exceeds maxVideoBytes (${maxVideoBytes} B).`,
		};
	}

	const baseCt = (ctLower.split(";")[0] || "video/mp4").trim() || "video/mp4";
	const baseExt =
		typeof baseCt === "string" && baseCt.startsWith("video/") && baseCt.split("/")[1]
			? baseCt.split("/")[1]
			: "mp4";
	const safeExt = (baseExt.split("+")[0].split(";")[0].trim() || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const videoFilename = `video/${userId}_${imageId}_${timestamp}_${random}.${safeExt}`;
	let videoUrl;
	try {
		videoUrl = await storage.uploadVideo(videoBuf, videoFilename, {
			contentType: baseCt,
		});
	} catch (err) {
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: ctLower,
			video_byte_length: videoBuf.length,
			summary: "Failed to upload video to storage.",
			upload_error: safeErrorMessage(err),
		};
	}

	const argsObj = existingMeta.args && typeof existingMeta.args === "object" ? existingMeta.args : {};
	const sourceFromArgs =
		(typeof argsObj.image_url === "string" && argsObj.image_url) ||
		(typeof argsObj.image === "string" && argsObj.image) ||
		(Array.isArray(argsObj.input_images) && typeof argsObj.input_images[0] === "string" && argsObj.input_images[0]) ||
		null;

	const metaPatch = {
		media_type: "video",
		completed_at: existingMeta.completed_at || new Date().toISOString(),
		video: {
			filename: videoFilename,
			file_path: videoUrl,
			content_type: baseCt,
		},
		provider_status: "succeeded",
		provider_video_repaired_at: new Date().toISOString(),
		...(!existingMeta.source_image_url && sourceFromArgs
			? { source_image_url: String(sourceFromArgs).trim() }
			: {}),
	};

	const mergedMeta = mergeMeta(existingMeta, metaPatch);

	const upMeta = queries.updateCreatedImageMeta?.run;
	if (typeof upMeta !== "function") {
		return {
			...baseOut,
			repaired: false,
			video_url: videoUrl,
			summary: "Video uploaded but updateCreatedImageMeta is unavailable — orphan object may exist in storage.",
		};
	}
	const up = await upMeta(imageId, userId, mergedMeta);
	const changes = Number(up?.changes ?? 0);
	if (!up || changes === 0) {
		return {
			...baseOut,
			repaired: false,
			video_url: videoUrl,
			summary: "Video uploaded but meta update affected 0 rows.",
		};
	}

	if (image.status === "failed" && typeof queries.updateCreatedImageStatus?.run === "function") {
		try {
			await queries.updateCreatedImageStatus.run(imageId, userId, "completed");
		} catch {
			// best-effort
		}
	}

	return {
		...baseOut,
		repaired: true,
		provider_http_status: httpStatus,
		provider_content_type: ctLower,
		video_byte_length: videoBuf.length,
		video_url: videoUrl,
		video_filename: videoFilename,
		summary: "meta.video patched via admin repair (single provider request; no polling).",
	};
}

/**
 * Admin/diagnostic: send the same async poll POST as runProviderPollJob without
 * updating the database. Does not download full video bodies (cancels stream when content-type is video/*).
 */
export async function probeProviderAsyncJob({ queries, createdImageId }) {
	const ctx = await resolveProviderAsyncPollContext(queries, createdImageId);
	if (!ctx.ok) {
		return ctx;
	}
	const { server, pollBody, baseOut } = ctx;
	let providerResponse;
	try {
		providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token,
				server.server_config?.custom_headers
			),
			body: JSON.stringify(pollBody),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});
	} catch (err) {
		return {
			...baseOut,
			ok: false,
			reason: "fetch_error",
			message: safeErrorMessage(err),
		};
	}
	const httpStatus = providerResponse.status;
	const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
	const contentLengthHdr = providerResponse.headers.get("content-length");
	const parsedLen = contentLengthHdr != null && contentLengthHdr !== "" ? Number(contentLengthHdr) : NaN;
	const contentLength = Number.isFinite(parsedLen) ? parsedLen : null;

	if (!providerResponse.ok) {
		const payloadErr = await readProviderErrorPayload(providerResponse);
		return {
			...baseOut,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_error_body: payloadErr.body,
			recoverable_video: false,
			summary: "Provider returned a non-2xx response for the poll request.",
		};
	}

	if (contentType.includes("application/json")) {
		let body = null;
		try {
			body = await providerResponse.json().catch(() => null);
		} catch {
			body = null;
		}
		let jsonStringTruncated = false;
		let jsonStringPreview = null;
		try {
			const s = JSON.stringify(body);
			if (s.length > 20000) {
				jsonStringTruncated = true;
				jsonStringPreview = `${s.slice(0, 20000)}…`;
			}
		} catch {
			jsonStringPreview = "[unserializable]";
			jsonStringTruncated = true;
		}
		const statusLower = typeof body?.status === "string" ? body.status.toLowerCase() : "";
		const stillRunning = ["processing", "pending", "running", "queued", "starting"].includes(statusLower);
		const terminalCompleted = ["completed", "succeeded", "done"].includes(statusLower);
		return {
			...baseOut,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			kind: "json",
			provider_json: jsonStringTruncated ? null : body,
			provider_json_string_preview: jsonStringTruncated ? jsonStringPreview : null,
			json_string_truncated: jsonStringTruncated,
			async_job_status: typeof body?.status === "string" ? body.status : null,
			still_in_progress: stillRunning,
			terminal_completed_json: terminalCompleted,
			recoverable_video: false,
			summary: stillRunning
				? "Provider still reports in-progress JSON (job may still be running; a later poll might return video/* bytes)."
				: terminalCompleted
					? "Provider reports a terminal completed status in JSON only. Parascene normally expects video bytes on a different poll; if the row is already completed without meta.video, this JSON-only terminal response may indicate a provider/worker mismatch."
					: "Provider returned JSON (see provider_json).",
		};
	}

	if (contentType.startsWith("video/")) {
		try {
			await providerResponse.body?.cancel?.();
		} catch {
			// ignore
		}
		return {
			...baseOut,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_content_length: contentLength,
			kind: "video",
			recoverable_video: true,
			summary:
				"Provider returned video/* (headers only; body not downloaded). A full recovery flow could upload this stream to storage and patch meta.video — not done by this probe.",
		};
	}

	if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
		try {
			await providerResponse.body?.cancel?.();
		} catch {
			// ignore
		}
		return {
			...baseOut,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_content_length: contentLength,
			kind: "binary_skipped",
			recoverable_video: false,
			summary: "Large non-JSON response skipped in probe to avoid loading entire body into memory.",
		};
	}

	const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
	return {
		...baseOut,
		provider_http_status: httpStatus,
		provider_content_type: contentType,
		kind: "binary",
		provider_body_bytes: rawBuffer.length,
		recoverable_video: false,
		summary: "Provider returned a small non-JSON body (e.g. PNG). Unexpected for a video poll unless the job already finished with an image.",
	};
}

/**
 * Admin: one POST to the provider (same poll body as runProviderPollJob). If the response is video/*,
 * uploads to storage and patches meta.video. No QStash scheduling and no multi-step polling loop.
 * Does not run when meta.video.file_path is already set unless options.force === true.
 */
export async function repairProviderAsyncVideoJob({ queries, storage, createdImageId, options = {} }) {
	const force = options.force === true;
	const maxVideoBytes =
		Number.isFinite(Number(options.maxVideoBytes)) && Number(options.maxVideoBytes) > 0
			? Number(options.maxVideoBytes)
			: DEFAULT_REPAIR_MAX_VIDEO_BYTES;
	const repairTimeoutMs =
		Number.isFinite(Number(options.repairTimeoutMs)) && Number(options.repairTimeoutMs) >= 5000
			? Number(options.repairTimeoutMs)
			: DEFAULT_REPAIR_VIDEO_TIMEOUT_MS;

	if (!storage || typeof storage.uploadVideo !== "function") {
		return {
			ok: false,
			reason: "storage_upload_video_unavailable",
			message: "storage.uploadVideo is not configured.",
		};
	}

	const ctx = await resolveProviderAsyncPollContext(queries, createdImageId);
	if (!ctx.ok) {
		return ctx;
	}
	const { image, server, existingMeta, pollBody, imageId, baseOut } = ctx;
	const userId = Number(image.user_id);
	if (!Number.isFinite(userId) || userId < 1) {
		return { ...baseOut, ok: false, reason: "invalid_user_id", message: "creation.user_id missing." };
	}

	const existingVideoPath =
		existingMeta &&
		typeof existingMeta.video === "object" &&
		existingMeta.video &&
		typeof existingMeta.video.file_path === "string" &&
		existingMeta.video.file_path.trim();
	if (existingVideoPath && !force) {
		return {
			...baseOut,
			repaired: false,
			skipped: true,
			reason: "already_has_video",
			existing_video_url: String(existingMeta.video.file_path).trim(),
			summary: "meta.video.file_path is already set. Pass options.force=true (or JSON body.force) to replace.",
		};
	}

	let providerResponse;
	try {
		providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token,
				server.server_config?.custom_headers
			),
			body: JSON.stringify(pollBody),
			signal: AbortSignal.timeout(repairTimeoutMs),
		});
	} catch (err) {
		return {
			...baseOut,
			ok: false,
			reason: "fetch_error",
			message: safeErrorMessage(err),
		};
	}

	const httpStatus = providerResponse.status;
	const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
	const contentLengthHdr = providerResponse.headers.get("content-length");
	const parsedLen = contentLengthHdr != null && contentLengthHdr !== "" ? Number(contentLengthHdr) : NaN;
	const contentLength = Number.isFinite(parsedLen) ? parsedLen : null;

	if (!providerResponse.ok) {
		const payloadErr = await readProviderErrorPayload(providerResponse);
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_error_body: payloadErr.body,
			summary: "Provider returned non-2xx; database unchanged.",
		};
	}

	if (contentType.includes("application/json")) {
		let body = null;
		try {
			body = await providerResponse.json().catch(() => null);
		} catch {
			body = null;
		}
		const statusLower = typeof body?.status === "string" ? body.status.toLowerCase() : "";
		const stillRunning = ["processing", "pending", "running", "queued", "starting"].includes(statusLower);
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			kind: "json",
			provider_json: body,
			still_in_progress: stillRunning,
			summary: stillRunning
				? "Provider still in progress (JSON). Retry repair later when the job may return video/*."
				: "Provider returned JSON without video bytes; cannot repair from this response.",
		};
	}

	if (!contentType.startsWith("video/")) {
		if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
			try {
				await providerResponse.body?.cancel?.();
			} catch {
				// ignore
			}
			return {
				...baseOut,
				repaired: false,
				provider_http_status: httpStatus,
				provider_content_type: contentType,
				provider_content_length: contentLength,
				summary: "Unexpected large non-video body; skipped read. Database unchanged.",
			};
		}
		let byteLen = 0;
		try {
			const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
			byteLen = rawBuffer.length;
		} catch {
			byteLen = 0;
		}
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_body_bytes: byteLen,
			summary: "Provider did not return video/*; no repair applied.",
		};
	}

	if (Number.isFinite(contentLength) && contentLength > maxVideoBytes) {
		try {
			await providerResponse.body?.cancel?.();
		} catch {
			// ignore
		}
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			provider_content_length: contentLength,
			video_byte_length: contentLength,
			summary: `Content-Length (${contentLength} B) exceeds maxVideoBytes (${maxVideoBytes} B).`,
		};
	}

	const videoBuf = Buffer.from(await providerResponse.arrayBuffer());
	if (videoBuf.length > maxVideoBytes) {
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			video_byte_length: videoBuf.length,
			summary: `Downloaded body (${videoBuf.length} B) exceeds maxVideoBytes (${maxVideoBytes} B).`,
		};
	}
	if (videoBuf.length === 0) {
		return {
			...baseOut,
			repaired: false,
			provider_http_status: httpStatus,
			provider_content_type: contentType,
			summary: "Provider returned empty video body.",
		};
	}

	return completeRepairAfterVideoBytes({
		baseOut,
		image,
		existingMeta,
		imageId,
		userId,
		queries,
		storage,
		maxVideoBytes,
		videoBuf,
		contentType,
		provider_http_status: httpStatus,
	});
}

export { PROVIDER_TIMEOUT_MS, PROVIDER_VIDEO_FETCH_TIMEOUT_MS, fetchImageBufferFromUrl, createPlaceholderImageBuffer };

