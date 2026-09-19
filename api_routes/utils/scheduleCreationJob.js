import { getQStashCallbackBaseUrl } from "./url.js";

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
		const callbackUrl = new URL("/api/worker/create", getQStashCallbackBaseUrl()).toString();
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

/** Schedule landscape (outpaint) job: same callback as creation job; worker branches on job_type. */
export async function scheduleLandscapeJob({ payload, runLandscapeJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;
	const body = { ...payload, job_type: "landscape" };

	logCreation("scheduleLandscapeJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: payload?.created_image_id,
		user_id: payload?.user_id,
		server_id: payload?.server_id,
	});

	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel (landscape)");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/create", getQStashCallbackBaseUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
		logCreation("Publishing landscape job to QStash", { callback_url: callbackUrl });
		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash landscape job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash landscape publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}
		logCreation("Landscape job successfully enqueued to QStash");
		return { enqueued: true };
	}

	logCreation("Running landscape job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runLandscapeJob({ payload })).catch((err) => {
			logCreationError("runLandscapeJob failed in local mode:", err);
			log.error("runLandscapeJob failed:", err);
		});
	});
	return { enqueued: false };
}

/** Schedule audio cover generate/poll: same callback as creation job; worker branches on job_type. */
export async function scheduleAudioCoverJob({ payload, runAudioCoverJob, delaySeconds = 0, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;
	const body = { ...payload, job_type: payload?.job_type || "audio_cover" };
	const delay = Math.max(0, Math.floor(delaySeconds || 0));

	logCreation("scheduleAudioCoverJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: payload?.created_image_id,
		user_id: payload?.user_id,
		job_type: body.job_type,
		delaySeconds: delay,
	});

	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel (audio cover)");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/create", getQStashCallbackBaseUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
		const headers = {
			Authorization: `Bearer ${qstashToken}`,
			"Content-Type": "application/json",
		};
		if (delay > 0) headers["Upstash-Delay"] = `${delay}s`;
		const res = await fetch(publishUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash audio cover job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash audio cover publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}
		logCreation("Audio cover job successfully enqueued to QStash");
		return { enqueued: true };
	}

	logCreation("Running audio cover job locally (fire-and-forget)");
	const start = () => {
		Promise.resolve(runAudioCoverJob({ payload: body })).catch((err) => {
			logCreationError("runAudioCoverJob failed in local mode:", err);
			log.error("runAudioCoverJob failed:", err);
		});
	};
	if (delay > 0) setTimeout(start, delay * 1000);
	else queueMicrotask(start);
	return { enqueued: false };
}

/** Schedule anonymous (try) creation job: QStash on Vercel, in-process locally. */
export async function scheduleAnonCreationJob({ payload, runAnonCreationJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	logCreation("scheduleAnonCreationJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_anon_id: payload?.created_image_anon_id,
		server_id: payload?.server_id,
		method: payload?.method
	});

	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel (anon)");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/try/worker", getQStashCallbackBaseUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
		logCreation("Publishing anon job to QStash", { callback_url: callbackUrl });
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
			const error = new Error(`Failed to publish QStash anon job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash anon publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}
		logCreation("Anon job successfully enqueued to QStash");
		return { enqueued: true };
	}

	logCreation("Running anon job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runAnonCreationJob({ payload })).catch((err) => {
			logCreationError("runAnonCreationJob failed in local mode:", err);
			log.error("runAnonCreationJob failed:", err);
		});
	});
	return { enqueued: false };
}

export async function scheduleProviderPollJob({ payload, delaySeconds = 10, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;
	const body = { ...payload, job_type: payload?.job_type || "poll_provider" };

	logCreation("scheduleProviderPollJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: body?.created_image_id,
		user_id: body?.user_id,
		server_id: body?.server_id,
		delaySeconds,
	});

	if (!isVercel) {
		logCreation("scheduleProviderPollJob: running locally; async polling is disabled");
		return { enqueued: false };
	}

	if (!hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel for async provider polling. Set UPSTASH_QSTASH_TOKEN.");
		logCreationError("QStash token missing on Vercel (provider poll)");
		throw error;
	}

	const callbackUrl = new URL("/api/worker/create", getQStashCallbackBaseUrl()).toString();
	const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
	const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
	const delayHeaderSeconds = Math.max(0, Math.floor(delaySeconds || 0));

	logCreation("Publishing provider poll job to QStash", {
		callback_url: callbackUrl,
		delaySeconds: delayHeaderSeconds,
	});

	const headers = {
		Authorization: `Bearer ${qstashToken}`,
		"Content-Type": "application/json",
		// App already reschedules the next poll. QStash retries of the same
		// message multiply in-flight chains for one creation.
		"Upstash-Retries": "0",
	};
	if (delayHeaderSeconds > 0) {
		headers["Upstash-Delay"] = `${delayHeaderSeconds}s`;
	}
	const imageId = body?.created_image_id;
	if (imageId != null && String(imageId).trim()) {
		const bucket = Math.floor(Date.now() / 10_000);
		headers["Upstash-Deduplication-Id"] = `poll-provider-${String(imageId).trim()}-${bucket}`;
	}

	const res = await fetch(publishUrl, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		const error = new Error(
			`Failed to publish QStash provider poll job: ${res.status} ${res.statusText} ${text}`.trim(),
		);
		logCreationError("QStash provider poll publish failed", {
			status: res.status,
			statusText: res.statusText,
			response: text.substring(0, 200),
		});
		throw error;
	}

	logCreation("Provider poll job successfully enqueued to QStash");
	return { enqueued: true };
}

