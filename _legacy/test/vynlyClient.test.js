import { describe, it, expect } from "@jest/globals";
import { createVynlyClient } from "../api_routes/utils/vynlyClient.js";

describe("createVynlyClient", () => {
	it("getPosts forwards query and Authorization", async () => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			return new Response(JSON.stringify({ ok: true, items: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		};

		const client = createVynlyClient({
			baseUrl: "https://example.test",
			fetchImpl
		});

		const data = await client.getPosts("tok", { limit: 5, before: "123" });
		expect(data.ok).toBe(true);
		expect(calls.length).toBe(1);
		const u = new URL(calls[0].url);
		expect(`${u.origin}${u.pathname}`).toBe("https://example.test/api/posts");
		expect(u.searchParams.get("before")).toBe("123");
		expect(u.searchParams.get("limit")).toBe("5");
		expect(calls[0].init.headers.get("Authorization")).toBe("Bearer tok");
	});

	it("throws VynlyApiError on non-OK response", async () => {
		const fetchImpl = async () =>
			new Response("nope", { status: 429, statusText: "Too Many" });

		const client = createVynlyClient({
			baseUrl: "https://example.test",
			fetchImpl
		});

		await expect(client.getSparks("t")).rejects.toMatchObject({
			name: "VynlyApiError",
			status: 429
		});
	});
});
