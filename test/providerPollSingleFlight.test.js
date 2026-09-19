import { describe, expect, test, jest, beforeEach, afterEach } from "@jest/globals";
import {
	isProviderPollAlreadyScheduled,
	isProviderPollRunLocked,
	kickStaleProviderPollIfNeeded,
	runProviderPollJob,
} from "../api_routes/utils/creationJob.js";
import { scheduleProviderPollJob } from "../api_routes/utils/scheduleCreationJob.js";

describe("provider poll single-flight", () => {
	test("treats a future next_poll_at as already scheduled", () => {
		const now = Date.parse("2026-09-19T20:24:31.000Z");
		expect(
			isProviderPollAlreadyScheduled(
				{ provider_next_poll_at: "2026-09-19T20:24:41.000Z" },
				now,
			),
		).toBe(true);
		expect(
			isProviderPollAlreadyScheduled(
				{ provider_next_poll_at: "2026-09-19T20:24:32.000Z" },
				now,
			),
		).toBe(false);
		expect(isProviderPollAlreadyScheduled({}, now)).toBe(false);
	});

	test("treats an unexpired lock as running", () => {
		const now = 1_758_313_471_000;
		expect(isProviderPollRunLocked({ provider_poll_lock_until_ms: now + 1 }, now)).toBe(true);
		expect(isProviderPollRunLocked({ provider_poll_lock_until_ms: now }, now)).toBe(false);
		expect(isProviderPollRunLocked({}, now)).toBe(false);
	});

	test("does not kick while a poll is locked or already scheduled", async () => {
		const image = {
			id: 30625,
			user_id: 1570,
			status: "processing",
			meta: {
				provider_async: true,
				server_id: 6,
				credit_cost: 0.1,
				provider_poll_lock_until_ms: Date.now() + 30_000,
			},
		};
		const queries = {
			updateCreatedImageMeta: { run: jest.fn(async () => ({ changes: 1 })) },
		};
		const locked = await kickStaleProviderPollIfNeeded({
			queries,
			storage: {},
			image,
			userId: 1570,
			force: true,
		});
		expect(locked.kicked).toBe(false);
		expect(queries.updateCreatedImageMeta.run).not.toHaveBeenCalled();

		const scheduled = await kickStaleProviderPollIfNeeded({
			queries,
			storage: {},
			image: {
				...image,
				meta: {
					provider_async: true,
					server_id: 6,
					provider_next_poll_at: new Date(Date.now() + 10_000).toISOString(),
				},
			},
			userId: 1570,
			force: true,
		});
		expect(scheduled.kicked).toBe(false);
	});

	test("skips a poll job when another poll still holds the lock", async () => {
		const result = await runProviderPollJob({
			queries: {
				selectCreatedImageById: {
					get: async () => ({
						id: 30625,
						status: "processing",
						meta: {
							provider_async: true,
							provider_last_payload: { job_id: "job_1", async: true, status: "running" },
							provider_poll_lock_until_ms: Date.now() + 30_000,
						},
					}),
				},
				selectServerById: { get: jest.fn() },
			},
			storage: {},
			payload: {
				created_image_id: 30625,
				user_id: 1570,
				server_id: 6,
				credit_cost: 0.1,
			},
		});
		expect(result).toMatchObject({ ok: true, skipped: true, reason: "poll_already_running" });
	});
});

describe("scheduleProviderPollJob QStash headers", () => {
	const envKeys = ["VERCEL", "UPSTASH_QSTASH_TOKEN", "UPSTASH_QSTASH_URL"];
	const previous = {};

	beforeEach(() => {
		for (const key of envKeys) previous[key] = process.env[key];
		process.env.VERCEL = "1";
		process.env.UPSTASH_QSTASH_TOKEN = "test-token";
		process.env.UPSTASH_QSTASH_URL = "https://qstash.test";
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (previous[key] == null) delete process.env[key];
			else process.env[key] = previous[key];
		}
		jest.restoreAllMocks();
	});

	test("publishes with retries 0 and a per-image dedup id", async () => {
		const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			text: async () => "",
		});
		await scheduleProviderPollJob({
			payload: {
				created_image_id: 30625,
				user_id: 1570,
				server_id: 6,
			},
			delaySeconds: 10,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const headers = fetchMock.mock.calls[0][1].headers;
		expect(headers["Upstash-Retries"]).toBe("0");
		expect(headers["Upstash-Delay"]).toBe("10s");
		expect(headers["Upstash-Deduplication-Id"]).toMatch(/^poll-provider-30625-\d+$/);
	});
});
