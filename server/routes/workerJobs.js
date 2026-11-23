import express from "express";
import { createJobStore } from "../db/jobs.js";
import { runEmbeddingJob } from "../services/create/embeddingJob.js";
import { verifyQStashRequest } from "../services/create/qstashVerification.js";
import { runVisitPulseFlush } from "../services/feed/visitPulseFlush.js";
import { runFeedCatalogRebuild } from "../services/feed/ranking/catalogRebuild.js";

function qstashMeta(req) {
	const header = (name) => req.get(name);
	const meta = {};
	const messageId = header("Upstash-Message-Id");
	if (messageId) meta.qstash_message_id = messageId;
	const retried = header("Upstash-Retried");
	if (retried != null) meta.qstash_retried = String(retried);
	const scheduleId = header("Upstash-Schedule-Id");
	if (scheduleId) meta.qstash_schedule_id = scheduleId;
	return meta;
}

export function createWorkerJobRoutes({ client, feedQueries, pulseQueries }) {
	const router = express.Router();
	const jobs = createJobStore(client);
	const handlers = {
		embedding: ({ args }) => runEmbeddingJob({ client, args }),
		visit_pulse_flush: ({ args }) => runVisitPulseFlush({ args, queries: pulseQueries }),
		feed_beta_catalog_rebuild: () => runFeedCatalogRebuild({ queries: feedQueries })
	};

	router.post("/api/worker/jobs", async (req, res) => {
		res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
		if (!process.env.UPSTASH_QSTASH_TOKEN) return res.status(503).json({ error: "QStash not configured" });
		if (!(await verifyQStashRequest(req))) return res.status(401).json({ error: "Invalid QStash signature" });
		const jobType = req.body?.job_type;
		const args = req.body?.args;
		if (!jobType || args == null) return res.status(400).json({ error: "Missing job_type or args" });
		const handler = handlers[jobType];
		if (!handler) return res.status(400).json({ error: `Unknown job type: ${jobType}` });
		const meta = qstashMeta(req);
		let jobId = req.body?.job_id ?? null;
		try {
			if (jobId) await jobs.update(jobId, "processing", meta);
			else jobId = await jobs.insert(jobType, args, "processing");
		} catch (error) {
			console.error("[Jobs Worker] job row failed", error?.message || error);
		}
		const start = Date.now();
		try {
			await handler({ args });
			if (jobId) await jobs.update(jobId, "completed", { duration_ms: Date.now() - start });
			return res.json({ ok: true });
		} catch (error) {
			if (jobId) {
				try {
					await jobs.update(jobId, "failed", { ...meta, error: error?.message || String(error), duration_ms: Date.now() - start });
				} catch (updateError) {
					console.error("[Jobs Worker] status update failed", updateError?.message || updateError);
				}
			}
			if (jobType === "feed_beta_catalog_rebuild") {
				res.set("Upstash-NonRetryable-Error", "true");
				return res.status(489).json({ ok: false, error: error?.message || String(error) });
			}
			console.error("[Jobs Worker] failed", error?.message || error);
			return res.status(500).json({ ok: false, error: "Worker failed" });
		}
	});

	return router;
}
