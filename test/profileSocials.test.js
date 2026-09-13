import { describe, expect, it } from "@jest/globals";
import {
	applySocialFieldUpdates,
	applySocialObjectUpdates,
	listVisibleSocials,
	validateSocialUrl
} from "../public/shared/profileSocials.js";

describe("profileSocials", () => {
	it("clears empty values and normalizes missing protocol", () => {
		expect(validateSocialUrl("website", "  ")).toEqual({ ok: true, href: null });
		expect(validateSocialUrl("instagram", "instagram.com/parascene_com")).toEqual({
			ok: true,
			href: "https://instagram.com/parascene_com"
		});
	});

	it("rejects URLs that do not match the network", () => {
		const result = validateSocialUrl("instagram", "https://example.com/parascene");
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/instagram\.com/i);

		expect(validateSocialUrl("instagram", "javascript:alert(1)").ok).toBe(false);
		expect(validateSocialUrl("youtube", "https://vimeo.com/123").ok).toBe(false);
	});

	it("accepts known hosts for each network", () => {
		expect(validateSocialUrl("youtube", "https://youtu.be/abcd").ok).toBe(true);
		expect(validateSocialUrl("x", "https://twitter.com/parascene").ok).toBe(true);
		expect(validateSocialUrl("suno", "https://suno.com/@ocean").ok).toBe(true);
		expect(validateSocialUrl("nightcafe", "https://creator.nightcafe.studio/u/ocean").ok).toBe(true);
		expect(validateSocialUrl("spotify", "https://open.spotify.com/user/abc").ok).toBe(true);
	});

	it("merges form fields and fails the whole update when one link is invalid", () => {
		const existing = { website: "https://example.com/", instagram: "https://instagram.com/keep" };
		const ok = applySocialFieldUpdates(existing, {
			social_tiktok: "https://www.tiktok.com/@parascene",
			social_website: ""
		});
		expect(ok).toEqual({
			ok: true,
			socials: {
				instagram: "https://instagram.com/keep",
				tiktok: "https://www.tiktok.com/@parascene"
			}
		});

		const bad = applySocialFieldUpdates(existing, {
			social_youtube: "https://example.com/not-youtube"
		});
		expect(bad.ok).toBe(false);
		expect(bad.error).toMatch(/youtube/i);
	});

	it("updates only provided JSON keys and lists visible links", () => {
		const existing = { website: "https://example.com/", instagram: "https://instagram.com/keep" };
		const next = applySocialObjectUpdates(existing, { suno: "suno.com/@ocean" });
		expect(next.ok).toBe(true);
		expect(next.socials).toEqual({
			website: "https://example.com/",
			instagram: "https://instagram.com/keep",
			suno: "https://suno.com/@ocean"
		});

		expect(listVisibleSocials({
			instagram: "https://instagram.com/keep",
			youtube: "https://example.com/nope",
			tiktok: ""
		})).toEqual([
			{ key: "instagram", label: "Instagram", href: "https://instagram.com/keep" }
		]);
	});
});
