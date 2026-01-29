import { getBaseAppUrl } from "./url.js";

function hasNonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

export async function scheduleCreationJob({ payload, runCreationJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	logCreation("scheduleCreationJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: payload?.created_image_id,
		user_id: payload?.user_id,
		server_id: payload?.server_id,
		method: payload?.method
	});

	// cloud: enqueue via QStash
	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/create/", getBaseAppUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;

		logCreation("Publishing job to QStash", {
			publish_url: publishUrl,
			callback_url: callbackUrl
		});

		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash publish failed", {
				status: res.status,
				statusText: res.statusText,
				response: text.substring(0, 200)
			});
			throw error;
		}

		logCreation("Job successfully enqueued to QStash");
		return { enqueued: true };
	}

	// Local: fire-and-forget in-process.
	logCreation("Running job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runCreationJob({ payload })).catch((err) => {
			logCreationError("runCreationJob failed in local mode:", err);
			log.error("runCreationJob failed:", err);
		});
	});

	return { enqueued: false };
}

