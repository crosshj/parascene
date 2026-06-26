import { describe, it, expect } from "@jest/globals";
import {
	collectCreationMentionSourceTexts,
	collectCreationPromptMentionTexts,
	extractBroadcastMentionSlugs,
	extractUserMentionHandles,
	textContainsBoundedPersonalityMention
} from "../api_routes/utils/textMentions.js";

describe("textMentions", () => {
	it("extracts user handles and skips broadcast slugs", () => {
		expect(extractUserMentionHandles("@here @channel @ada @ada")).toEqual(["ada"]);
		expect(extractBroadcastMentionSlugs("@here @channel @ada")).toEqual(["here", "channel"]);
	});

	it("detects bounded personality mentions without false positives", () => {
		expect(textContainsBoundedPersonalityMention("portrait of @alice wearing red", "alice")).toBe(true);
		expect(textContainsBoundedPersonalityMention("love this @alice", "alice")).toBe(true);
		expect(textContainsBoundedPersonalityMention("cc @alice!", "alice")).toBe(true);
		expect(textContainsBoundedPersonalityMention("first line @alice\nsecond line", "alice")).toBe(true);
		expect(textContainsBoundedPersonalityMention("hey @alice, come back", "alice")).toBe(false);
		expect(textContainsBoundedPersonalityMention("@aliceplate looks great", "alice")).toBe(false);
		expect(textContainsBoundedPersonalityMention("email bob@alice.com", "alice")).toBe(false);
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

	it("collects stored prompt fields from meta", () => {
		const texts = collectCreationPromptMentionTexts({
			user_prompt: "Scene with @eve ",
			args: { prompt: "Portrait of @frank" }
		});
		expect(texts).toEqual(["Scene with @eve", "Portrait of @frank"]);
	});
});
