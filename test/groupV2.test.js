import { describe, expect, test } from "@jest/globals";
import {
	applyCostumeToCreationPayload,
	emptyGroupV2Meta,
	GROUP_V2_SUPPORTED,
	groupActionSupported,
	groupActionSupportedForMeta,
	groupV2RejectMessage,
	isGroupV2Meta,
	isHiddenInGroupMeta,
	viewFromCreationRow,
	withHiddenInGroup,
	withoutHiddenInGroup,
	withUpdatedItems,
} from "../api_routes/utils/groupV2.js";
import { emptyProjectV2Meta, isProjectV2Meta } from "../api_routes/utils/projectGroupV2.js";
import {
	collectGroupV2ItemsFromBody,
	fillThinGroupV2ItemViews,
	jsonGroupV2,
	refreshGroupV2MemberView,
} from "../api_routes/utils/groupV2Ops.js";

describe("groupV2", () => {
	test("empty group meta is generic, not a project", () => {
		const meta = emptyGroupV2Meta({ createdAt: "2026-09-12T00:00:00.000Z" });
		expect(isGroupV2Meta(meta)).toBe(true);
		expect(isProjectV2Meta(meta)).toBe(false);
		expect(meta.type).toBeUndefined();
		expect(meta.publish_forbidden).toBeUndefined();
		expect(meta.group.items).toEqual([]);
		expect(meta.group.supported).toEqual(GROUP_V2_SUPPORTED);
	});

	test("supported bag: missing key shows, false hides", () => {
		expect(groupActionSupported(null, "publish")).toBe(true);
		expect(groupActionSupported({ kind: "group_creations" }, "ungroup")).toBe(true);
		expect(groupActionSupported({ ungroup_supported: false }, "ungroup")).toBe(false);
		expect(groupActionSupported({ supported: { ungroup: false } }, "publish")).toBe(true);
		expect(groupActionSupported({ supported: { publish: false } }, "publish")).toBe(false);
		expect(groupActionSupportedForMeta(emptyGroupV2Meta(), "ungroup")).toBe(false);
		expect(groupActionSupportedForMeta(emptyGroupV2Meta(), "publish")).toBe(true);
		expect(groupActionSupportedForMeta({ type: "project", group: { kind: "group_v2", items: [] } }, "publish")).toBe(
			false,
		);
		expect(groupActionSupportedForMeta({ type: "project", group: { kind: "group_v2", items: [] } }, "challenge_assign")).toBe(
			false,
		);
		expect(groupActionSupportedForMeta({ type: "project", group: { kind: "group_v2", items: [] } }, "carousel")).toBe(
			false,
		);
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
		expect(www.url).toBe("https://cdn.example/a.png");
		expect(www.media_type).toBe("image");
		expect(www.meta.group.supported.ungroup).toBe(false);
		expect(www.meta.group.supported.publish).toBeUndefined();
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

	test("fillThin copies member rows even when a creating filename was stored", async () => {
		const meta = emptyGroupV2Meta({
			items: [
				{
					pointer: { kind: "creation", creationId: 29527 },
					cover: true,
					view: { mediaType: "image", filename: "creating_219_1.png" },
				},
			],
		});
		const next = await fillThinGroupV2ItemViews(
			{
				selectCreatedImageById: {
					get: async () => ({
						id: 29527,
						filename: "219_29527.png",
						file_path: "/api/images/created/219_29527.png",
						title: "still",
						status: "completed",
					}),
				},
			},
			1,
			meta,
		);
		expect(next.group.items[0].view.filePath).toBe("/api/images/created/219_29527.png");
		const www = applyCostumeToCreationPayload({ id: 29526, title: "TestProject", meta: next }, { raw: false });
		expect(www.meta.group.source_creations[0].id).toBe(29527);
		expect(www.meta.group.source_creations[0].file_path).toBe("/api/images/created/219_29527.png");
		expect(www.url).toBe("/api/images/created/219_29527.png");
	});

	test("job complete writes the finished file onto the owning group item", async () => {
		const groupMeta = emptyGroupV2Meta({
			items: [
				{
					pointer: { kind: "creation", creationId: 29527 },
					cover: true,
					view: { mediaType: "image", filename: "creating_219_1.png" },
				},
			],
		});
		let persisted = null;
		const ok = await refreshGroupV2MemberView(
			{
				selectCreatedImageById: {
					get: async (id) => {
						if (Number(id) === 29526) {
							return { id: 29526, meta: groupMeta };
						}
						return null;
					},
				},
				updateCreatedImageMeta: {
					run: async (_id, _userId, nextMeta) => {
						persisted = nextMeta;
						return { changes: 1 };
					},
				},
			},
			219,
			{
				id: 29527,
				filename: "219_29527.png",
				file_path: "/api/images/created/219_29527.png",
				status: "completed",
				meta: { hidden_in_group: 29526 },
			},
		);
		expect(ok).toBe(true);
		expect(persisted.group.items[0].view.filePath).toBe("/api/images/created/219_29527.png");
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

	test("costume snapshots carry video and audio from the live view", () => {
		const view = viewFromCreationRow({
			id: 12,
			title: "Clip",
			filename: "219_12.png",
			file_path: "/api/images/created/219_12.png",
			status: "completed",
			meta: {
				media_type: "video",
				video: { file_path: "/api/videos/created/v12.mp4" },
			},
		});
		expect(view.mediaType).toBe("video");
		expect(view.videoUrl).toBe("/api/videos/created/v12.mp4");
		const www = applyCostumeToCreationPayload(
			{
				id: 7,
				title: "List",
				meta: emptyGroupV2Meta({
					items: [{ pointer: { kind: "creation", creationId: 12 }, cover: true, view }],
				}),
			},
			{ raw: false },
		);
		expect(www.meta.group.source_creations[0].meta.media_type).toBe("video");
		expect(www.meta.group.source_creations[0].meta.video.file_path).toBe("/api/videos/created/v12.mp4");
		expect(www.meta.group.source_creations[0].file_path).toBe("/api/images/created/219_12.png");
	});
});
