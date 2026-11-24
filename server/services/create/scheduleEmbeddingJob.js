import { createJobStore } from "../../db/jobs.js";
import { runEmbeddingJob } from "./embeddingJob.js";
import { useQStashCreationJobs } from "./scheduleCreationJob.js";
import { getSupabaseServiceClient } from "./supabaseService.js";
import { getCreationWorkerOrigin } from "./url.js";

function embeddingArgs(creation) {
	return {
		created_image_id: Number(creation.id),
		user_id: Number(creation.user_id),
		title: creation.title ?? "",
		description: creation.description ?? "",
		meta: creation.meta ?? null
	};
}

/** Publish, published edits, and admin restore enqueue this. QStash in deployment, in-process locally. */
export async function scheduleEmbeddingJob({ creation } = {}) {
	if (!creation) return { enqueued: false };
	const args = embeddingArgs(creation);
	if (!Number.isFinite(args.created_image_id) || args.created_image_id <= 0) return { enqueued: false };
	if (!Number.isFinite(args.user_id) || args.user_id <= 0) return { enqueued: false };

	const client = getSupabaseServiceClient();
	const jobs = client ? createJobStore(client) : null;
	let jobId = null;
	if (jobs) {
		try {
			jobId = await jobs.insert("embedding", args, "pending");
		} catch (error) {
			console.warn("[embedding] job row failed", error?.message || error);
		}
	}
	const payload = { job_type: "embedding", args, job_id: jobId };

	if (useQStashCreationJobs()) {
		const token = String(process.env.UPSTASH_QSTASH_TOKEN || "").trim();
		const base = String(process.env.UPSTASH_QSTASH_URL || "").trim().replace(/\/$/, "");
		if (!token || !base) throw new Error("QStash token is required for embedding jobs. Set UPSTASH_QSTASH_TOKEN.");
		const callbackUrl = new URL("/api/worker/jobs", getCreationWorkerOrigin()).toString();
		const response = await fetch(`${base}/v2/publish/${callbackUrl}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Failed to publish embedding job: ${response.status} ${text}`.trim());
		}
		return { enqueued: true };
	}

	queueMicrotask(() => {
		const start = Date.now();
		Promise.resolve(runEmbeddingJob({ client, args })).then(async () => {
			if (jobs && jobId) await jobs.update(jobId, "completed", { duration_ms: Date.now() - start });
		}).catch(async (error) => {
			console.warn("[embedding] local job failed", error?.message || error);
			if (jobs && jobId) {
				try {
					await jobs.update(jobId, "failed", { error: error?.message || String(error) });
				} catch { /* status is best-effort */ }
			}
		});
	});
	return { enqueued: false };
}
