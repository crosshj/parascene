import { describe, it, expect } from "@jest/globals";
import {
	collectCreationMentionSourceTexts,
	extractBroadcastMentionSlugs,
	extractUserMentionHandles
} from "../api_routes/utils/textMentions.js";

describe("textMentions", () => {
	it("extracts user handles and skips broadcast slugs", () => {
		expect(extractUserMentionHandles("@here @channel @ada @ada")).toEqual(["ada"]);
		expect(extractBroadcastMentionSlugs("@here @channel @ada")).toEqual(["here", "channel"]);
	});

	it("collects title, description, and prompt from creation", () => {
		const texts = collectCreationMentionSourceTexts({
			title: "Hi @bob",
			description: "For @carol",
			meta: { args: { prompt: "Scene with @dave" } }
		});
		expect(texts.join(" ")).toContain("@bob");
		expect(texts.join(" ")).toContain("@carol");
		expect(texts.join(" ")).toContain("@dave");
	});
});
