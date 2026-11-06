import { describe, expect, test } from "@jest/globals";
import {
	groupActionSupported,
	groupActionSupportedWhenKnown,
	groupCreationBadgeHtml,
	groupSupportedKnown,
	isProjectGroupMark,
} from "../public/shared/creationGroupMedia.js";

describe("creationGroupMedia", () => {
	test("project mark uses badge, then type", () => {
		expect(isProjectGroupMark({ meta: { group: { kind: "group_creations", badge: "project" } } })).toBe(true);
		expect(isProjectGroupMark({ meta: { type: "project", group: { kind: "group_creations" } } })).toBe(true);
		expect(isProjectGroupMark({ meta: { group: { kind: "group_creations" } } })).toBe(false);
	});

	test("project badge html is not the overlapping squares", () => {
		const project = groupCreationBadgeHtml({ meta: { group: { badge: "project" } } });
		const group = groupCreationBadgeHtml({ meta: { group: { kind: "group_creations" } } });
		expect(project).toContain("creation-group-badge--project");
		expect(project).toContain("Project");
		expect(group).not.toContain("creation-group-badge--project");
		expect(group).toContain("Group creation");
	});

	test("carousel missing means show", () => {
		expect(groupActionSupported({ kind: "group_creations" }, "carousel")).toBe(true);
		expect(groupActionSupported({ supported: { carousel: false } }, "carousel")).toBe(false);
	});

	test("unknown group seed hides gated chrome until supported is known", () => {
		expect(groupSupportedKnown(null)).toBe(true);
		expect(groupSupportedKnown({ kind: "group_creations" })).toBe(false);
		expect(groupSupportedKnown({ kind: "group_creations", ungroup_supported: true })).toBe(true);
		expect(groupSupportedKnown({ kind: "group_creations", ungroup_supported: false })).toBe(false);
		expect(groupSupportedKnown({ kind: "group_v2", supported: { publish: false } })).toBe(true);
		expect(groupActionSupportedWhenKnown({ kind: "group_creations" }, "publish")).toBe(false);
		expect(groupActionSupportedWhenKnown({ kind: "group_creations", ungroup_supported: true }, "publish")).toBe(true);
		expect(groupActionSupportedWhenKnown({ kind: "group_creations", ungroup_supported: false }, "publish")).toBe(false);
		expect(groupActionSupportedWhenKnown({ supported: { publish: false } }, "publish")).toBe(false);
		expect(groupActionSupportedWhenKnown(null, "publish")).toBe(true);
	});
});
