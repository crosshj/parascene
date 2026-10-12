import { buildProviderHeaders } from "./providerAuth.js";
import { applyAudioCoverBuffer, parseCreationMeta } from "./audioCoverApply.js";
import { scheduleAudioCoverJob } from "./scheduleCreationJob.js";

const PROVIDER_TIMEOUT_MS = 50_000;
const BLUE_FAST_MODELS = [
	"diffusion_models/z-image/z_image_turbo_bf16.safetensors",
	"diffusion_models/flux/flux1-schnell.safetensors",
	"checkpoints/FLUX1/flux1-schnell-fp8.safetensors",
];

function parseServerConfig(server) {
	const raw = server?.server_config;
	if (raw && typeof raw === "object") return raw;
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

function pickBlueModel(methodConfig) {
	const options = methodConfig?.fields?.model?.options;
	const values = Array.isArray(options)
		? options.map((o) => (typeof o?.value === "string" ? o.value : "")).filter(Boolean)
		: [];
	for (const preferred of BLUE_FAST_MODELS) {
		if (values.includes(preferred)) return preferred;
	}
	return values[0] || BLUE_FAST_MODELS[0];
}

export function albumCoverPromptFromCreation(image, meta, userPrompt) {
	const typed = typeof userPrompt === "string" ? userPrompt.trim() : "";
	if (typed) return typed.slice(0, 800);
	const title = typeof image?.title === "string" ? image.title.trim() : "";
	const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	const lyrics = typeof args.lyrics === "string" ? args.lyrics.trim() : "";
	const importTitle = typeof meta?.import?.title === "string" ? meta.import.title.trim() : "";
	const base = title || importTitle || prompt || lyrics || "abstract atmospheric music";
	return `${base.slice(0, 400)}. Square album cover, atmospheric, no text, no letters, no watermark.`;
}

export function resolveAudioCoverGenerateTarget(servers, prompt) {
	const active = Array.isArray(servers) ? servers.filter((s) => s?.status === "active") : [];
	for (const server of active) {
		const methods = parseServerConfig(server).methods || {};
		const method = methods.text2image;
		if (!method) continue;
		const credits = Number(method.credits);
		return {
			server_id: Number(server.id),
			method: "text2image",
			credits: Number.isFinite(credits) && credits > 0 ? credits : 0.1,
			async: method.async === true,
			args: {
				prompt,
				aspect_ratio: "1:1",
				model: pickBlueModel(method),
			},
		};
	}
	for (const server of active) {
		const methods = parseServerConfig(server).methods || {};
		const method = methods.replicate;
		if (!method) continue;
		const credits = Number(method.credits);
		return {
			server_id: Number(server.id),
			method: "replicate",
			credits: Number.isFinite(credits) && credits > 0 ? credits : 3,
			async: method.async === true,
			args: {
				prompt,
				model: "prunaai/p-image",
			},
		};
	}
	return null;
}

function isAsyncAckBody(body, fallbackMethod) {
	if (!body || typeof body !== "object") return false;
	if (body.async !== true) return false;
	if (typeof body.job_id !== "string" || !body.job_id) return false;
	if (typeof body.status !== "string" || !body.status) return false;
	const status = body.status.toLowerCase();
	if (["failed", "error"].includes(status)) return false;
	if (typeof body.method === "string" && fallbackMethod && body.method !== fallbackMethod) return false;
	return true;
}

function isPng(buffer) {
	return (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47
	);
}

async function ensurePngBuffer(buffer) {
	if (isPng(buffer)) return buffer;
	const sharp = (await import("sharp")).default;
	return sharp(buffer, { failOn: "none" }).png().toBuffer();
}

function mergeMeta(existing, patch) {
	const base = existing && typeof existing === "object" ? existing : {};
	return { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
}

async function refundCoverCredits(queries, userId, creditCost, existingMeta) {
	if (!(Number(creditCost) > 0) || existingMeta?.cover_generate?.credits_refunded === true) return true;
	await queries.updateUserCreditsBalance.run(userId, Number(creditCost));
	return true;
}

async function failCoverGenerate({ queries, imageId, userId, existingMeta, creditCost, message }) {
	const nextMeta = mergeMeta(existingMeta, {
		cover_generate: {
			status: "error",
			message: message || "Cover generation failed",
			credits_refunded: Number(creditCost) > 0,
			failed_at: new Date().toISOString(),
		},
	});
	await queries.updateCreatedImageMeta.run(imageId, userId, nextMeta);
	await refundCoverCredits(queries, userId, creditCost, existingMeta);
	return { ok: false, reason: "failed", meta: nextMeta };
}

async function postProvider({ server, method, args, asyncRequested }) {
	const payload = asyncRequested ? { method, args, async: true } : { method, args };
	const response = await fetch(server.server_url, {
		method: "POST",
		headers: buildProviderHeaders(
			{ "Content-Type": "application/json", Accept: "image/png" },
			server.auth_token,
			server.server_config?.custom_headers
		),
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
	});
	return response;
}

async function applyGeneratedBytes({ queries, storage, image, rawBuffer, extraMeta }) {
	const png = await ensurePngBuffer(rawBuffer);
	return applyAudioCoverBuffer({
		queries,
		storage,
		image,
		buffer: png,
		coverSource: "generate",
		extraMeta,
	});
}

export async function runAudioCoverJob({ queries, storage, payload }) {
	const imageId = Number(payload?.created_image_id);
	const userId = Number(payload?.user_id);
	const serverId = Number(payload?.server_id);
	const method = typeof payload?.method === "string" ? payload.method : "";
	const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
	const creditCost = Number(payload?.credit_cost) || 0;
	const asyncRequested = payload?.async === true;
	const pollJobId = typeof payload?.job_id === "string" ? payload.job_id.trim() : "";

	if (!Number.isFinite(imageId) || !Number.isFinite(userId) || !serverId || !method) {
		return { ok: false, reason: "bad_payload" };
	}

	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) return { ok: false, reason: "not_found" };
	const existingMeta = parseCreationMeta(image.meta) || {};
	if (pollJobId) {
		const attempts = Number(existingMeta.cover_generate?.poll_attempts || 0) + 1;
		if (attempts > 24) {
			return failCoverGenerate({
				queries,
				imageId,
				userId,
				existingMeta,
				creditCost,
				message: "Cover generation timed out",
			});
		}
		existingMeta.cover_generate = {
			...(existingMeta.cover_generate && typeof existingMeta.cover_generate === "object"
				? existingMeta.cover_generate
				: {}),
			poll_attempts: attempts,
			status: "loading",
		};
	}

	const server = await queries.selectServerById.get(serverId);
	if (!server || server.status !== "active") {
		return failCoverGenerate({
			queries,
			imageId,
			userId,
			existingMeta,
			creditCost,
			message: "Cover server is not available",
		});
	}

	try {
		const providerArgs = pollJobId ? { job_id: pollJobId } : args;
		const response = await postProvider({
			server,
			method,
			args: providerArgs,
			asyncRequested: asyncRequested || Boolean(pollJobId),
		});
		const contentType = String(response.headers.get("content-type") || "").toLowerCase();

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(text.slice(0, 200) || `Provider error ${response.status}`);
		}

		if (contentType.includes("application/json")) {
			const body = await response.json().catch(() => null);
			if (asyncRequested && isAsyncAckBody(body, method)) {
				const status = String(body.status || "").toLowerCase();
				const jobId = body.job_id;
				if (status === "succeeded" || status === "completed" || status === "done") {
					const retry = await postProvider({
						server,
						method,
						args: { job_id: jobId },
						asyncRequested: true,
					});
					const retryType = String(retry.headers.get("content-type") || "").toLowerCase();
					if (retry.ok && !retryType.includes("application/json")) {
						const rawBuffer = Buffer.from(await retry.arrayBuffer());
						await applyGeneratedBytes({ queries, storage, image, rawBuffer });
						return { ok: true };
					}
				}
				const nextMeta = mergeMeta(existingMeta, {
					cover_generate: {
						status: "loading",
						job_id: jobId,
						provider_status: body.status,
						server_id: serverId,
						method,
						credit_cost: creditCost,
						started_at: existingMeta.cover_generate?.started_at || new Date().toISOString(),
					},
				});
				await queries.updateCreatedImageMeta.run(imageId, userId, nextMeta);
				await scheduleAudioCoverJob({
					payload: {
						job_type: "audio_cover_poll",
						created_image_id: imageId,
						user_id: userId,
						server_id: serverId,
						method,
						args,
						credit_cost: creditCost,
						async: true,
						job_id: jobId,
					},
					runAudioCoverJob: ({ payload: nextPayload }) => runAudioCoverJob({ queries, storage, payload: nextPayload }),
					delaySeconds: 8,
				});
				return { ok: true, reason: "async_queued" };
			}
			const message =
				(body && typeof body === "object" && (body.error || body.message)) ||
				"Provider returned unexpected JSON";
			throw new Error(String(message));
		}

		const rawBuffer = Buffer.from(await response.arrayBuffer());
		await applyGeneratedBytes({ queries, storage, image, rawBuffer });
		return { ok: true };
	} catch (err) {
		return failCoverGenerate({
			queries,
			imageId,
			userId,
			existingMeta,
			creditCost,
			message: err?.message || "Cover generation failed",
		});
	}
}
