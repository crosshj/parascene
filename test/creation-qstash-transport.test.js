import assert from "node:assert/strict";
import test from "node:test";
import {
	scheduleAnonCreationJob,
	scheduleCreationJob,
	scheduleProviderPollJob,
} from "../server/services/create/scheduleCreationJob.js";
import { healProviderPollOnRead, resumeLocalProviderPolls, runProviderPollJob } from "../server/services/create/creationJob.js";

test("VPS creation jobs use the legacy API worker through QStash", async () => {
	const names = [
		"VERCEL",
		"CREATION_JOB_MODE",
		"CREATION_WORKER_ORIGIN",
		"API_HOSTNAME",
		"UPSTASH_QSTASH_TOKEN",
		"UPSTASH_QSTASH_URL",
	];
	const prior = new Map(names.map((name) => [name, process.env[name]]));
	const priorFetch = globalThis.fetch;
	const published = [];
	try {
		delete process.env.VERCEL;
		process.env.CREATION_JOB_MODE = "qstash";
		process.env.CREATION_WORKER_ORIGIN = "https://api.parascene.com";
		process.env.API_HOSTNAME = "beta-api.parascene.com";
		process.env.UPSTASH_QSTASH_TOKEN = "test-token";
		process.env.UPSTASH_QSTASH_URL = "https://qstash.example";
		globalThis.fetch = async (url, options) => {
			published.push({ url: String(url), options });
			return { ok: true, status: 200 };
		};
		const runLocally = () => assert.fail("VPS must not execute a published job in process");

		await scheduleCreationJob({
			payload: { created_image_id: 42, user_id: 7, method: "generate" },
			runCreationJob: runLocally,
		});
		await scheduleProviderPollJob({ payload: { created_image_id: 42, user_id: 7 } });
		await scheduleAnonCreationJob({
			payload: { created_image_anon_id: 9 },
			runAnonCreationJob: runLocally,
		});
		const recovery = await resumeLocalProviderPolls({
			queries: { selectCreatedImagesGpuInFlight: { all: runLocally } },
		});
		assert.equal(recovery.resumed, 0);
		assert.deepEqual(published.map(({ url }) => url), [
			"https://qstash.example/v2/publish/https://api.parascene.com/api/worker/create",
			"https://qstash.example/v2/publish/https://api.parascene.com/api/worker/create",
			"https://qstash.example/v2/publish/https://api.parascene.com/api/try/worker",
		]);
		assert.equal(JSON.parse(published[0].options.body).created_image_id, 42);
	} finally {
		globalThis.fetch = priorFetch;
		for (const [name, value] of prior) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});

test("VPS owner read restarts a stale Blue poll through the API worker", async () => {
	const priorMode = process.env.CREATION_JOB_MODE;
	const priorToken = process.env.UPSTASH_QSTASH_TOKEN;
	const priorUrl = process.env.UPSTASH_QSTASH_URL;
	const priorFetch = globalThis.fetch;
	const image = {
		id: 42,
		user_id: 7,
		status: "processing",
		meta: {
			provider_async: true,
			provider_job_id: "blue-job",
			provider_last_payload: { job_id: "blue-job" },
			server_id: 6,
			started_at: new Date().toISOString(),
			provider_next_poll_at: new Date(Date.now() - 60_000).toISOString(),
		},
	};
	let published = 0;
	try {
		process.env.CREATION_JOB_MODE = "qstash";
		process.env.UPSTASH_QSTASH_TOKEN = "test-token";
		process.env.UPSTASH_QSTASH_URL = "https://qstash.example";
		globalThis.fetch = async () => { published += 1; return { ok: true, status: 200 }; };
		const queries = {
			selectCreatedImageById: { get: async () => image },
			updateCreatedImageMeta: { run: async (_id, _uid, meta) => { image.meta = meta; } },
		};
		const result = await healProviderPollOnRead({ queries, image, userId: 7 });
		assert.deepEqual(result, { kicked: true, revived: false });
		assert.equal(published, 1);
		assert.ok(Date.parse(image.meta.provider_next_poll_at) > Date.now() - 1000);
	} finally {
		globalThis.fetch = priorFetch;
		for (const [name, value] of [
			["CREATION_JOB_MODE", priorMode],
			["UPSTASH_QSTASH_TOKEN", priorToken],
			["UPSTASH_QSTASH_URL", priorUrl],
		]) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});

test("a provider poll releases its lock before the scheduled follow-up", async () => {
	const priorMode = process.env.CREATION_JOB_MODE;
	const priorToken = process.env.UPSTASH_QSTASH_TOKEN;
	const priorUrl = process.env.UPSTASH_QSTASH_URL;
	const priorFetch = globalThis.fetch;
	const row = {
		id: 42,
		user_id: 7,
		status: "processing",
		meta: {
			provider_async: true,
			provider_method: "ltx_i2v",
			provider_job_id: "blue-job",
			provider_last_payload: { async: true, job_id: "blue-job", method: "ltx_i2v", status: "running" },
			server_id: 6,
			started_at: new Date().toISOString(),
		},
	};
	let providerPolls = 0;
	let publishedPolls = 0;
	try {
		process.env.CREATION_JOB_MODE = "qstash";
		process.env.UPSTASH_QSTASH_TOKEN = "test-token";
		process.env.UPSTASH_QSTASH_URL = "https://qstash.example";
		globalThis.fetch = async (url) => {
			if (String(url).startsWith("https://qstash.example/")) {
				publishedPolls += 1;
				return { ok: true, status: 200 };
			}
			providerPolls += 1;
			return {
				ok: true,
				headers: { get: () => "application/json" },
				json: async () => ({ async: true, job_id: "blue-job", method: "ltx_i2v", status: "running" }),
			};
		};
		const queries = {
			selectCreatedImageById: { get: async () => ({ ...row, meta: { ...row.meta } }) },
			selectServerById: { get: async () => ({ status: "active", server_url: "https://blue.example/generate" }) },
			claimCreatedImageProviderPollLock: {
				run: async (_id, _uid, meta, now) => {
					if (Number(row.meta.provider_poll_lock_until_ms) > now) return { changes: 0 };
					row.meta = meta;
					return { changes: 1 };
				},
			},
			updateCreatedImageMeta: { run: async (_id, _uid, meta) => { row.meta = meta; } },
			updateCreatedImageStatus: { run: async (_id, _uid, status) => { row.status = status; } },
		};
		const payload = { created_image_id: 42, user_id: 7, server_id: 6, credit_cost: 0 };
		await runProviderPollJob({ queries, payload });
		assert.equal(publishedPolls, 1);
		assert.equal(row.meta.provider_poll_lock_until_ms, 0);
		await runProviderPollJob({ queries, payload });
		assert.equal(providerPolls, 2);
	} finally {
		globalThis.fetch = priorFetch;
		for (const [name, value] of [
			["CREATION_JOB_MODE", priorMode],
			["UPSTASH_QSTASH_TOKEN", priorToken],
			["UPSTASH_QSTASH_URL", priorUrl],
		]) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});

test("a late owner check detects expired Blue output and fails the creation", async () => {
	const priorFetch = globalThis.fetch;
	const row = {
		id: 42,
		user_id: 7,
		status: "queued",
		meta: {
			provider_async: true,
			provider_method: "text2image",
			provider_job_id: "blue-job",
			provider_last_payload: { async: true, job_id: "blue-job", status: "pending" },
			server_id: 6,
			started_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
		},
	};
	let providerPolls = 0;
	try {
		globalThis.fetch = async () => {
			providerPolls += 1;
			return {
				ok: false,
				status: 410,
				statusText: "Gone",
				headers: { get: () => "application/json" },
				text: async () => JSON.stringify({ async: true, data_removed: true, error: "Output data removed" }),
			};
		};
		const queries = {
			selectCreatedImageById: { get: async () => ({ ...row, meta: { ...row.meta } }) },
			selectServerById: { get: async () => ({ status: "active", server_url: "https://blue.example/generate" }) },
			claimCreatedImageProviderPollLock: { run: async (_id, _uid, meta) => { row.meta = meta; return { changes: 1 }; } },
			updateCreatedImageJobFailed: { run: async (_id, _uid, update) => { row.status = "failed"; row.meta = update.meta; } },
		};
		const result = await runProviderPollJob({ queries, payload: { created_image_id: 42, user_id: 7, server_id: 6, credit_cost: 0 } });
		assert.equal(providerPolls, 1);
		assert.equal(result.reason, "provider_failed");
		assert.equal(row.status, "failed");
		assert.equal(row.meta.error_code, "output_expired");
	} finally {
		globalThis.fetch = priorFetch;
	}
});
