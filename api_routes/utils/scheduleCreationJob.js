import { getBaseAppUrl } from "./url.js";

function hasNonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

export async function scheduleCreationJob({ payload, runCreationJob, log = console }) {
	// Cloud: enqueue via QStash only when running on Vercel AND token is set.
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/create/worker", getBaseAppUrl()).toString();
		const publishUrl = `https://qstash.upstash.io/v2/publish/${encodeURIComponent(callbackUrl)}`;

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
			throw new Error(`Failed to publish QStash job: ${res.status} ${res.statusText} ${text}`.trim());
		}

		return { enqueued: true };
	}

	// Local: fire-and-forget in-process.
	console.log("scheduleCreationJob: local, running job inline", payload);
	queueMicrotask(() => {
		Promise.resolve(runCreationJob({ payload })).catch((err) => {
			log.error("runCreationJob failed:", err);
		});
	});

	return { enqueued: false };
}

