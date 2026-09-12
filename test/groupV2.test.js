import { describe, expect, test } from "@jest/globals";
import {
	applyCostumeToCreationPayload,
	emptyGroupV2Meta,
	groupV2RejectMessage,
	isGroupV2Meta,
	isHiddenInGroupMeta,
	withHiddenInGroup,
	withoutHiddenInGroup,
	withUpdatedItems,
} from "../api_routes/utils/groupV2.js";
import { emptyProjectV2Meta, isProjectV2Meta } from "../api_routes/utils/projectGroupV2.js";
import { collectGroupV2ItemsFromBody, jsonGroupV2 } from "../api_routes/utils/groupV2Ops.js";

describe("groupV2", () => {
	test("empty group meta is generic, not a project", () => {
		const meta = emptyGroupV2Meta({ createdAt: "2026-09-12T00:00:00.000Z" });
		expect(isGroupV2Meta(meta)).toBe(true);
		expect(isProjectV2Meta(meta)).toBe(false);
		expect(meta.type).toBeUndefined();
		expect(meta.publish_forbidden).toBeUndefined();
		expect(meta.group.items).toEqual([]);
	});

	test("updating items does not stamp project type", () => {
		const meta = emptyGroupV2Meta();
		const next = withUpdatedItems(meta, [
			{ pointer: { kind: "creation", creationId: 11 }, cover: true, view: { mediaType: "image" } },
		]);
		expect(next.type).toBeUndefined();
		expect(next.publish_forbidden).toBeUndefined();
		expect(isProjectV2Meta(next)).toBe(false);
		expect(isGroupV2Meta(next)).toBe(true);
		expect(next.group.items).toHaveLength(1);
	});

	test("updating a project keeps project stamps", () => {
		const next = withUpdatedItems(emptyProjectV2Meta(), []);
		expect(isProjectV2Meta(next)).toBe(true);
		expect(next.type).toBe("project");
		expect(next.publish_forbidden).toBe(true);
	});

	test("costume does not force type project", () => {
		const meta = emptyGroupV2Meta({
			items: [
				{
					pointer: { kind: "creation", creationId: 11 },
					cover: true,
					view: { mediaType: "image", url: "https://cdn.example/a.png" },
				},
			],
		});
		const www = applyCostumeToCreationPayload({ id: 7, title: "List", meta }, { raw: false });
		expect(www.meta.group.kind).toBe("group_creations");
		expect(www.meta.type).toBeUndefined();
		expect(www.items).toBeUndefined();
		const raw = applyCostumeToCreationPayload({ id: 7, title: "List", meta }, { raw: true });
		expect(raw.meta.group.kind).toBe("group_v2");
		expect(raw.items).toHaveLength(1);
	});

	test("hide writes hidden_in_group and still reads the old key", () => {
		const hidden = withHiddenInGroup({ media_type: "image" }, 44);
		expect(hidden.hidden_in_group).toBe(44);
		expect(hidden.hidden_in_project).toBeUndefined();
		expect(isHiddenInGroupMeta(hidden)).toBe(true);
		expect(isHiddenInGroupMeta({ hidden_in_project: 9 })).toBe(true);
		expect(withoutHiddenInGroup(hidden).hidden_in_group).toBeUndefined();
	});

	test("reject copy is about the list, not a project", () => {
		expect(groupV2RejectMessage("ungroup")).toMatch(/cannot be ungrouped/i);
		expect(groupV2RejectMessage("group")).toMatch(/v1 group/i);
	});

	test("json keeps type from meta without forcing project", () => {
		const bare = jsonGroupV2(
			{ id: 7, filename: "group_v2/x", status: "completed", published: 0, title: "List", meta: emptyGroupV2Meta() },
			{ get: () => "1", query: {} },
		);
		expect(bare.type).toBeUndefined();
		expect(bare.meta.group.kind).toBe("group_v2");
		const project = jsonGroupV2(
			{ id: 8, filename: "project/x", status: "completed", published: 0, title: "Trip", meta: emptyProjectV2Meta() },
			{ get: () => "1", query: {} },
		);
		expect(project.type).toBe("project");
	});

	test("collect accepts pointer items without hitting the db", async () => {
		const collected = await collectGroupV2ItemsFromBody(
			{ selectCreatedImageById: { get: async () => null } },
			1,
			{ items: [{ pointer: { kind: "creation", creationId: 11 }, cover: true, view: { mediaType: "image" } }] },
		);
		expect(collected.items).toHaveLength(1);
		expect(collected.items[0].pointer.creationId).toBe(11);
	});
});
