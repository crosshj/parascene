import { describe, expect, test } from "@jest/globals";
import {
	getGroupCoverSource,
	resolveCreationDisplayMediaUrls
} from "../api_routes/utils/resolveCreationDisplayMedia.js";

describe("resolveCreationDisplayMediaUrls", () => {
	test("uses cover source file_path for grouped rows with synthetic filename", () => {
		const meta = {
			media_type: "image",
			group: {
				kind: "group_creations",
				cover_source_id: 2,
				source_creations: [
					{
						id: 2,
						file_path: "/api/images/created/cover.png"
					},
					{
						id: 3,
						file_path: "/api/images/created/other.png"
					}
				]
			}
		};
		const media = resolveCreationDisplayMediaUrls({
			row: {
				id: 99,
				filename: "group/user_abc.png",
				file_path: "/api/images/created/group/user_abc.png"
			},
			meta,
			creationId: 99
		});
		expect(media.url).toContain("/api/images/created/cover.png");
		expect(media.url).toContain("creation_id=99");
		expect(media.media_type).toBe("image");
	});

	test("resolves grouped video playlist poster from cover source", () => {
		const meta = {
			media_type: "video",
			group: {
				kind: "group_creations",
				cover_source_id: 10,
				source_creations: [
					{
						id: 10,
						file_path: "/api/images/created/poster.jpg",
						meta: {
							media_type: "video",
							video: { file_path: "/api/videos/created/v1.mp4" }
						}
					},
					{
						id: 11,
						meta: {
							media_type: "video",
							video: { file_path: "/api/videos/created/v2.mp4" }
						}
					}
				]
			}
		};
		const cover = getGroupCoverSource(meta);
		expect(cover?.id).toBe(10);
		const media = resolveCreationDisplayMediaUrls({
			row: { id: 50, filename: "group/x.png", file_path: "/api/images/created/group/x.png" },
			meta,
			creationId: 50
		});
		expect(media.media_type).toBe("video");
		expect(media.url).toContain("poster.jpg");
		expect(media.video_url).toContain("/api/videos/created/v1.mp4");
	});
});
