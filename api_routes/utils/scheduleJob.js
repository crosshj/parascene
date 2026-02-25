import { getQStashCallbackBaseUrl } from "./url.js";

function hasNonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function logJob(...args) {
	console.log("[Job]", ...args);
}

function logJobError(...args) {
	console.error("[Job]", ...args);
}

/**
 * Schedule an async job. On Vercel with QStash configured, enqueues to the generic worker.
 * Locally, runs the job in-process (fire-and-forget).
 * @param {{ jobType: string, args: object, jobId?: number, runJob: (opts: { payload: object }) => Promise<void>, log?: object }} opts
 * @returns {Promise<{ enqueued: boolean }>}
 */
export async function scheduleJob({ jobType, args, jobId, runJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	const payload = { job_type: jobType, args, job_id: jobId ?? null };

	logJob("scheduleJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		job_type: jobType,
		job_id: jobId
	});

	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/jobs", getQStashCallbackBaseUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;

		logJob("Publishing job to queue", { callback_url: callbackUrl });

		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish job: ${res.status} ${res.statusText} ${text}`.trim());
			logJobError("Publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}

		logJob("Job successfully enqueued");
		return { enqueued: true };
	}

	logJob("Running job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runJob({ payload })).catch((err) => {
			logJobError("runJob failed in local mode:", err);
			log.error("runJob failed:", err);
		});
	});

	return { enqueued: false };
}
