import { describe, expect, it, afterEach } from "@jest/globals";
import express from "express";
import http from "node:http";
import createProfileRoutes from "../api_routes/user.js";

const TARGET = {
	id: 42,
	email: "target@example.com",
	role: "creator",
	created_at: "2024-01-15T00:00:00.000Z",
	meta: { plan: "free" }
};
const VIEWER = {
	id: 7,
	email: "viewer@example.com",
	role: "creator",
	created_at: "2024-02-01T00:00:00.000Z",
	meta: { enableNsfw: true }
};

function buildQueries({ published = [], all = [] } = {}) {
	return {
		selectUserById: {
			get: async (id) => {
				if (Number(id) === TARGET.id) return TARGET;
				if (Number(id) === VIEWER.id) return VIEWER;
				return undefined;
			}
		},
		selectUserProfileByUserId: {
			get: async (id) => {
				if (Number(id) !== TARGET.id) return undefined;
				return {
					user_id: TARGET.id,
					user_name: "ocean",
					display_name: "Ocean",
					about: "Hello",
					socials: { instagram: "https://instagram.com/ocean" },
					avatar_url: "/api/images/generic/profile/ocean.png",
					cover_image_url: null,
					badges: [],
					meta: { prsn_cids: ["secret-cid"], character_description: "A tide" },
					created_at: TARGET.created_at,
					updated_at: TARGET.created_at
				};
			}
		},
		selectUserProfileByUsername: {
			get: async (username) => {
				if (String(username) === "ocean") return { user_id: TARGET.id };
				return undefined;
			}
		},
		selectAllCreatedImageCountForUser: {
			get: async () => ({ count: 9 })
		},
		selectPublishedCreatedImageCountForUser: {
			get: async () => ({ count: 3 })
		},
		selectLikesReceivedForUserPublished: {
			get: async () => ({ count: 4 })
		},
		selectFollowerCountForUser: {
			get: async () => ({ count: 2 })
		},
		selectUserFollowStatus: {
			get: async () => ({ viewer_follows: true })
		},
		selectPublishedCreatedImagesForUser: {
			all: async (_userId, options = {}) => {
				const limit = Number(options.limit) || 24;
				const offset = Number(options.offset) || 0;
				return published.slice(offset, offset + limit);
			}
		},
		selectCreatedImagesForUser: {
			all: async (_userId, options = {}) => {
				const limit = Number(options.limit) || 24;
				const offset = Number(options.offset) || 0;
				return all.slice(offset, offset + limit);
			}
		}
	};
}

async function startServer({ queries, withAuth = false } = {}) {
	const app = express();
	app.use((req, _res, next) => {
		if (withAuth) req.auth = { userId: VIEWER.id };
		next();
	});
	app.use(createProfileRoutes({ queries }));
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function getJson(baseUrl, path) {
	const res = await fetch(`${baseUrl}${path}`);
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

describe("public user profile APIs", () => {
	let server;

	afterEach(async () => {
		if (server) {
			await new Promise((resolve) => server.close(resolve));
			server = null;
		}
	});

	it("serves profile summary without auth and hides private fields", async () => {
		const started = await startServer({
			queries: buildQueries(),
			withAuth: false
		});
		server = started.server;

		const { status, body } = await getJson(started.baseUrl, "/api/users/42/profile");
		expect(status).toBe(200);
		expect(body.is_self).toBe(false);
		expect(body.viewer_follows).toBe(false);
		expect(body.user).toEqual({
			id: 42,
			role: "creator",
			created_at: TARGET.created_at
		});
		expect(body.user.email).toBeUndefined();
		expect(body.user.email_prefix).toBeUndefined();
		expect(body.profile.user_name).toBe("ocean");
		expect(body.profile.prsn_cids).toEqual([]);
		expect(body.profile.meta.prsn_cids).toBeUndefined();
		expect(body.stats.creations_total).toBe(3);
		expect(body.stats.creations_published).toBe(3);
	});

	it("resolves the same public profile by username", async () => {
		const started = await startServer({
			queries: buildQueries(),
			withAuth: false
		});
		server = started.server;

		const { status, body } = await getJson(started.baseUrl, "/api/users/by-username/ocean/profile");
		expect(status).toBe(200);
		expect(body.profile.display_name).toBe("Ocean");
	});

	it("hides unpublished, nsfw, and challenge submissions from guests", async () => {
		const published = [
			{
				id: 1,
				filename: "pub.png",
				file_path: "/api/images/created/pub.png",
				published: true,
				status: "completed",
				created_at: TARGET.created_at,
				meta: {}
			},
			{
				id: 3,
				filename: "nsfw.png",
				file_path: "/api/images/created/nsfw.png",
				published: true,
				status: "completed",
				created_at: TARGET.created_at,
				meta: { nsfw: true }
			},
			{
				id: 4,
				filename: "challenge.png",
				file_path: "/api/images/created/challenge.png",
				published: true,
				status: "completed",
				created_at: TARGET.created_at,
				meta: { challenge_submissions: [{ challenge_id: "open-summer" }] }
			}
		];
		const all = [
			...published,
			{
				id: 2,
				filename: "draft.png",
				file_path: "/api/images/created/draft.png",
				published: false,
				status: "completed",
				created_at: TARGET.created_at,
				meta: {}
			}
		];
		const started = await startServer({
			queries: buildQueries({ published, all }),
			withAuth: false
		});
		server = started.server;

		const { status, body } = await getJson(
			started.baseUrl,
			"/api/users/42/created-images?include=all"
		);
		expect(status).toBe(200);
		expect(body.scope).toBe("published");
		expect(body.is_self).toBe(false);
		expect(body.images.map((img) => img.id)).toEqual([1]);
	});

	it("keeps follow status and unpublished counts for signed-in viewers", async () => {
		const started = await startServer({
			queries: buildQueries(),
			withAuth: true
		});
		server = started.server;

		const { status, body } = await getJson(started.baseUrl, "/api/users/42/profile");
		expect(status).toBe(200);
		expect(body.viewer_follows).toBe(true);
		expect(body.user.email_prefix).toBe("target");
		expect(body.stats.creations_total).toBe(9);
	});
});
