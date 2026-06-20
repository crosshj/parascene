import { getBuildMetadata } from "../api_routes/utils/buildInfo.js";

describe("getBuildMetadata", () => {
	const envKeys = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG", "BUILD_ID", "BUILD_TIME", "ASSET_VERSION"];

	let savedEnv = {};

	beforeEach(() => {
		savedEnv = {};
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
	});

	test("prefers Vercel commit SHA and BUILD_TIME", () => {
		process.env.VERCEL_GIT_COMMIT_SHA = "abc123def4567890abcdef1234567890abcdef12";
		process.env.VERCEL_GIT_REPO_OWNER = "crosshj";
		process.env.VERCEL_GIT_REPO_SLUG = "parascene";
		process.env.BUILD_TIME = "2026-06-20T18:30:00.000Z";

		const meta = getBuildMetadata();
		expect(meta.commit).toBe("abc123def4567890abcdef1234567890abcdef12");
		expect(meta.commitUrl).toBe(
			"https://github.com/crosshj/parascene/commit/abc123def4567890abcdef1234567890abcdef12"
		);
		expect(meta.deployedAt).toBe("2026-06-20T18:30:00.000Z");
		expect(meta.version).toMatch(/\d+\.\d+\.\d+/);
	});
});

describe("formatBuildCommit", () => {
	test("shortens long commit hashes", async () => {
		const mod = await import("../public/shared/buildInfo.js");
		expect(mod.formatBuildCommit("abc123def4567890abcdef1234567890abcdef12")).toBe("abc123d");
		expect(mod.formatBuildCommit("")).toBe("Unknown");
	});
});
