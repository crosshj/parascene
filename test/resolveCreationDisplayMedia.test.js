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

	test("exposes a stable Parascene audio_url for CDN-backed audio", () => {
		const meta = {
			media_type: "audio",
			audio: {
				cdn_id: "o_0123456789abcdef01234567",
				content_type: "audio/mpeg"
			}
		};
		const media = resolveCreationDisplayMediaUrls({
			row: {
				id: 44,
				filename: "7_cover.png",
				file_path: "/api/images/created/7_cover.png"
			},
			meta,
			creationId: 44
		});
		expect(media.media_type).toBe("audio");
		expect(media.audio_url).toBe("/api/create/images/44/audio");
		expect(media.url).toContain("/api/images/created/7_cover.png");
	});

	test("omits audio_url when there is no CDN object", () => {
		const media = resolveCreationDisplayMediaUrls({
			row: { id: 8, file_path: "/api/images/created/suno.png" },
			meta: { media_type: "audio", import: { provider: "suno" } },
			creationId: 8
		});
		expect(media.audio_url).toBeNull();
	});
});
