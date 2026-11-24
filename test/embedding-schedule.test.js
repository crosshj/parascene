import assert from "node:assert/strict";
import test from "node:test";
import { scheduleEmbeddingJob } from "../server/services/create/scheduleEmbeddingJob.js";

test("embedding jobs publish to the worker jobs route", async () => {
	const names = ["VERCEL", "CREATION_JOB_MODE", "CREATION_WORKER_ORIGIN", "UPSTASH_QSTASH_TOKEN", "UPSTASH_QSTASH_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
	const prior = new Map(names.map((name) => [name, process.env[name]]));
	const priorFetch = globalThis.fetch;
	const published = [];
	try {
		delete process.env.VERCEL;
		delete process.env.SUPABASE_URL;
		delete process.env.SUPABASE_SERVICE_ROLE_KEY;
		process.env.CREATION_JOB_MODE = "qstash";
		process.env.CREATION_WORKER_ORIGIN = "https://api.parascene.com";
		process.env.UPSTASH_QSTASH_TOKEN = "test-token";
		process.env.UPSTASH_QSTASH_URL = "https://qstash.example";
		globalThis.fetch = async (url, options) => {
			published.push({ url: String(url), body: JSON.parse(options.body) });
			return { ok: true, status: 200, text: async () => "" };
		};
		const result = await scheduleEmbeddingJob({
			creation: { id: 15, user_id: 4, title: "Night", description: "moon", meta: { args: { prompt: "quiet" } }, published: true }
		});
		assert.equal(result.enqueued, true);
		assert.equal(published[0].url, "https://qstash.example/v2/publish/https://api.parascene.com/api/worker/jobs");
		assert.equal(published[0].body.job_type, "embedding");
		assert.equal(published[0].body.args.created_image_id, 15);
		assert.equal(published[0].body.args.meta.args.prompt, "quiet");
	} finally {
		globalThis.fetch = priorFetch;
		for (const [name, value] of prior) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});
