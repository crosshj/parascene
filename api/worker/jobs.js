import "dotenv/config";
import { openDb } from "../../db/index.js";
import { verifyQStashRequest } from "../../api_routes/utils/qstashVerification.js";
import { runEmbeddingJob } from "../../api_routes/utils/embeddingJob.js";

console.log("[Jobs Worker] Module loaded at", new Date().toISOString());

function logJob(...args) {
	console.log("[Jobs Worker]", ...args);
}

function logJobError(...args) {
	console.error("[Jobs Worker]", ...args);
}

/** Capture QStash-related headers for meta (future admin linking to QStash dashboard). */
function captureQStashMeta(req) {
	const headers = req.headers || {};
	const get = (name) => headers[name] ?? headers[name.toLowerCase()];
	const meta = {};
	const messageId = get("Upstash-Message-Id") ?? get("upstash-message-id");
	if (messageId) meta.qstash_message_id = messageId;
	const retried = get("Upstash-Retried") ?? get("upstash-retried");
	if (retried !== undefined && retried !== null) meta.qstash_retried = String(retried);
	const scheduleId = get("Upstash-Schedule-Id") ?? get("upstash-schedule-id");
	if (scheduleId) meta.qstash_schedule_id = scheduleId;
	return meta;
}

const JOB_HANDLERS = {
	embedding: runEmbeddingJob
};

export default async function handler(req, res) {
	logJob("Handler invoked", {
		method: req.method,
		url: req.url,
		hasBody: !!req.body
	});

	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	try {
		if (!process.env.UPSTASH_QSTASH_TOKEN) {
			logJobError("QStash not configured");
			return res.status(503).json({ error: "QStash not configured" });
		}

		const isValid = await verifyQStashRequest(req);
		if (!isValid) {
			logJobError("Invalid QStash signature");
			return res.status(401).json({ error: "Invalid QStash signature" });
		}

		const { job_type: jobType, args, job_id: jobId } = req.body ?? {};
		if (!jobType || !args) {
			logJobError("Missing job_type or args");
			return res.status(400).json({ error: "Missing job_type or args" });
		}

		const handler = JOB_HANDLERS[jobType];
		if (!handler) {
			logJobError("Unknown job type", jobType);
			return res.status(400).json({ error: `Unknown job type: ${jobType}` });
		}

		const { queries } = await openDb();
		const qstashMeta = captureQStashMeta(req);

		let effectiveJobId = jobId;
		if (effectiveJobId) {
			await queries.updateJobStatus.run(effectiveJobId, "processing", qstashMeta);
		} else {
			const result = await queries.insertJob.run(jobType, args, "processing");
			effectiveJobId = result?.insertId ?? null;
			if (effectiveJobId) {
				await queries.updateJobStatus.run(effectiveJobId, "processing", qstashMeta);
			}
		}

		const start = Date.now();
		try {
			await handler({ args });
			if (effectiveJobId && queries.updateJobStatus) {
				await queries.updateJobStatus.run(effectiveJobId, "completed", {
					duration_ms: Date.now() - start
				});
			}
			logJob("Job completed", { job_type: jobType, job_id: effectiveJobId });
			return res.json({ ok: true });
		} catch (err) {
			if (effectiveJobId && queries.updateJobStatus) {
				await queries.updateJobStatus.run(effectiveJobId, "failed", {
					...qstashMeta,
					error: err?.message || String(err),
					duration_ms: Date.now() - start
				});
			}
			throw err;
		}
	} catch (error) {
		logJobError("Worker failed", {
			error: error.message,
			stack: error.stack
		});
		return res.status(500).json({ ok: false, error: "Worker failed" });
	}
}
