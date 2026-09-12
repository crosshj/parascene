import { describe, expect, test } from "@jest/globals";
import {
	appendItems,
	applyCostumeToCreationPayload,
	costumeProjectV2Meta,
	creationPointer,
	emptyProjectV2Meta,
	isProjectV2Meta,
	wantsProjectGroupType,
	itemFromLocal,
	localUri,
	memberCreationIds,
	parseLocalUri,
	projectRejectMessage,
	removeItems,
	setCoverItem,
	wantsRawGroupV2,
	withHiddenInProject,
	isHiddenInProjectMeta,
	withoutHiddenInProject,
} from "../api_routes/utils/projectGroupV2.js";

describe("projectGroupV2", () => {
	test("empty project meta is v2 and allows no items", () => {
		const meta = emptyProjectV2Meta({ createdAt: "2026-09-12T00:00:00.000Z" });
		expect(isProjectV2Meta(meta)).toBe(true);
		expect(meta.group.items).toEqual([]);
		expect(meta.publish_forbidden).toBe(true);
	});

	test("a bare group v2 is not a project", () => {
		expect(isProjectV2Meta({ group: { kind: "group_v2", items: [] } })).toBe(false);
		expect(wantsProjectGroupType({})).toBe(false);
		expect(wantsProjectGroupType({ type: "project" })).toBe(true);
	});

	test("local:// pointer stays machine-local", () => {
		expect(localUri("lib-1", "asset-9")).toBe("local://lib-1/asset-9");
		expect(parseLocalUri("local://lib-1/asset-9")).toEqual({
			uri: "local://lib-1/asset-9",
			libraryId: "lib-1",
			assetId: "asset-9",
		});
		expect(parseLocalUri("https://example.test/x")).toBeNull();
	});

	test("append is 1-to-1 and does not mint a second cover", () => {
		const first = {
			pointer: creationPointer(11),
			view: { mediaType: "image", title: "A" },
			cover: true,
		};
		const second = itemFromLocal("lib-1", "local-2", { mediaType: "image" });
		const { items, added } = appendItems([first], [second, first]);
		expect(added).toHaveLength(1);
		expect(items).toHaveLength(2);
		expect(items.filter((item) => item.cover)).toHaveLength(1);
		expect(memberCreationIds(items)).toEqual([11]);
	});

	test("remove last row keeps the empty list", () => {
		const { items, removed } = removeItems(
			[{ pointer: creationPointer(11), cover: true, view: { mediaType: "image" } }],
			11,
		);
		expect(removed).toHaveLength(1);
		expect(items).toEqual([]);
	});

	test("set cover is a flag on one row", () => {
		const items = setCoverItem(
			[
				{ pointer: creationPointer(11), cover: true, view: { mediaType: "image" } },
				{ pointer: creationPointer(12), view: { mediaType: "video" } },
			],
			12,
		);
		expect(items.map((item) => item.cover)).toEqual([false, true]);
	});

	test("costume omits local:// and looks like an old group", () => {
		const meta = emptyProjectV2Meta({
			items: [
				{
					pointer: creationPointer(11),
					cover: true,
					view: { mediaType: "image", url: "https://cdn.example/a.png", title: "Still" },
				},
				itemFromLocal("lib-1", "only-here", { mediaType: "image" }),
			],
		});
		const costumed = costumeProjectV2Meta(meta);
		expect(costumed.group.kind).toBe("group_creations");
		expect(costumed.group.ungroup_supported).toBe(false);
		expect(costumed.group.source_creation_ids).toEqual([11]);
		expect(costumed.group.source_creations).toHaveLength(1);
	});

	test("raw payload keeps items[]", () => {
		const meta = emptyProjectV2Meta({
			items: [{ pointer: creationPointer(11), cover: true, view: { mediaType: "image" } }],
		});
		const raw = applyCostumeToCreationPayload({ id: 99, title: "Trip", meta }, { raw: true });
		expect(raw.items).toHaveLength(1);
		expect(raw.meta.group.kind).toBe("group_v2");
		const www = applyCostumeToCreationPayload({ id: 99, title: "Trip", meta }, { raw: false });
		expect(www.items).toBeUndefined();
		expect(www.meta.group.kind).toBe("group_creations");
	});

	test("desktop flag asks for no costume", () => {
		expect(wantsRawGroupV2({ get: () => "1", query: {} })).toBe(true);
		expect(wantsRawGroupV2({ get: () => "", query: { raw: "1" } })).toBe(true);
		expect(wantsRawGroupV2({ get: () => "", query: {} })).toBe(false);
	});

	test("hidden-in-project is a list filter, not an archive", () => {
		const hidden = withHiddenInProject({ media_type: "image" }, 44);
		expect(isHiddenInProjectMeta(hidden)).toBe(true);
		expect(hidden.hidden_in_group).toBe(44);
		expect(hidden.hidden_in_project).toBeUndefined();
		expect(isHiddenInProjectMeta({ hidden_in_project: 44 })).toBe(true);
		expect(withoutHiddenInProject(hidden).hidden_in_group).toBeUndefined();
		expect(withoutHiddenInProject(hidden).hidden_in_project).toBeUndefined();
	});

	test("reject copy", () => {
		expect(projectRejectMessage("publish")).toMatch(/cannot be published/i);
		expect(projectRejectMessage("ungroup")).toMatch(/cannot be ungrouped/i);
		expect(projectRejectMessage("group")).toMatch(/v1 group/i);
	});
});
