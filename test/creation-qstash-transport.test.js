import assert from "node:assert/strict";
import test from "node:test";
import {
	scheduleAnonCreationJob,
	scheduleCreationJob,
	scheduleProviderPollJob,
} from "../server/services/create/scheduleCreationJob.js";
import { healProviderPollOnRead, resumeLocalProviderPolls } from "../server/services/create/creationJob.js";

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
		const readRepair = await healProviderPollOnRead({
			queries: { selectCreatedImageById: { get: runLocally } },
			image: { id: 42, user_id: 7, status: "queued", meta: { provider_async: true } },
			userId: 7,
			force: true,
		});

		assert.equal(recovery.resumed, 0);
		assert.deepEqual(readRepair, { kicked: false, revived: false });
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
