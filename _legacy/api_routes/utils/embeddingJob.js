import { createClient } from "@supabase/supabase-js";
import Replicate from "replicate";
import { getBaseAppUrlForEmail } from "./url.js";
import { buildPublicImageUrl } from "./publicImageUrl.js";
import {
	buildEmbeddingText,
	getEmbeddingFromReplicate,
	REPLICATE_CLIP_MODEL,
	upsertCreationEmbedding
} from "./embeddings.js";
import { scheduleJob } from "./scheduleJob.js";

/**
 * Run embedding job logic. Best-effort; logs warnings on failure.
 * @param {{ args: { created_image_id: number, user_id: number, title?: string, description?: string, meta?: object } }} opts
 */
export async function runEmbeddingJob({ args }) {
	if (!args?.created_image_id || !args?.user_id) return;
	try {
		const supabaseUrl = process.env.SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		const replicateToken = process.env.REPLICATE_API_TOKEN;
		if (!supabaseUrl || !supabaseKey || !replicateToken) return;
		const creationId = Number(args.created_image_id);
		const userId = Number(args.user_id);
		const baseUrl = getBaseAppUrlForEmail();
		const imagePublicUrl = buildPublicImageUrl(creationId, userId, baseUrl);
		if (!imagePublicUrl) return;
		const title = args.title ?? "";
		const description = args.description ?? "";
		const prompt =
			args.meta && typeof args.meta === "object" && args.meta.args?.prompt
				? args.meta.args.prompt
				: "";
		const text = buildEmbeddingText({ title, description, prompt });
		const replicate = new Replicate({ auth: replicateToken });
		const output = await getEmbeddingFromReplicate(replicate, { text, image: imagePublicUrl });
		const embedding = output?.embedding;
		if (!Array.isArray(embedding)) return;
		const supabase = createClient(supabaseUrl, supabaseKey);
		await upsertCreationEmbedding(supabase, creationId, embedding, REPLICATE_CLIP_MODEL);
	} catch (e) {
		console.warn("[embeddingJob] Embedding store failed:", e?.message || e);
		throw e;
	}
}

/**
 * Schedule an embedding job for a creation. Creates a pending job record, then enqueues.
 * @param {{ creation: object, queries: object, log?: object }} opts
 * @returns {Promise<{ enqueued: boolean }>}
 */
export async function scheduleEmbeddingJob({ creation, queries, log = console }) {
	if (!creation) return { enqueued: false };
	const creationId = Number(creation.id);
	const userId = Number(creation.user_id);
	const args = {
		created_image_id: creationId,
		user_id: userId,
		title: creation.title ?? "",
		description: creation.description ?? "",
		meta: creation.meta ?? null
	};

	const result = await queries.insertJob.run("embedding", args, "pending");
	const jobId = result?.insertId ?? null;

	return scheduleJob({
		jobType: "embedding",
		args,
		jobId,
		runJob: async ({ payload }) => {
			try {
				const start = Date.now();
				await runEmbeddingJob({ args: payload.args });
				if (queries.updateJobStatus && payload.job_id) {
					await queries.updateJobStatus.run(payload.job_id, "completed", {
						duration_ms: Date.now() - start
					});
				}
			} catch (err) {
				if (queries.updateJobStatus && payload.job_id) {
					await queries.updateJobStatus.run(payload.job_id, "failed", {
						error: err?.message || String(err)
					});
				}
				throw err;
			}
		},
		log
	});
}
