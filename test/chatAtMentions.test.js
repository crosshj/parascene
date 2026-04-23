import { describe, it, expect } from "@jest/globals";
import { extractUniqueChatMentionUsernames } from "../api_routes/utils/chatAtMentions.js";

describe("extractUniqueChatMentionUsernames", () => {
	it("dedupes and normalizes valid handles", () => {
		expect(extractUniqueChatMentionUsernames("hi @Ada and @ada — @bob_1")).toEqual(["ada", "bob_1"]);
	});

	it("rejects too-short and invalid tokens", () => {
		expect(extractUniqueChatMentionUsernames("@ab @no!here @valid_name")).toEqual(["valid_name"]);
	});

	it("returns empty for non-strings", () => {
		expect(extractUniqueChatMentionUsernames(null)).toEqual([]);
	});
});
