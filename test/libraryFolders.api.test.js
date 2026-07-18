import { describe, expect, it, beforeEach } from "@jest/globals";
import express from "express";
import http from "node:http";
import createLibraryFoldersRoutes from "../api_routes/library_folders.js";
import {
	normalizeLibraryFolderOperations,
	parseBaseRevision,
	formatLibraryFoldersSnapshot
} from "../api_routes/utils/libraryFolders.js";

const FOLDER_A = "11111111-1111-4111-8111-111111111111";
const FOLDER_B = "22222222-2222-4222-8222-222222222222";
const FOLDER_C = "33333333-3333-4333-8333-333333333333";

function createMemoryLibraryFoldersStore() {
	/** @type {Map<number, { revision: number, folders: Map<string, any>, ownedCreationIds: Set<number> }>} */
	const users = new Map();
	/** Global folder ids (mirrors uuid PK). */
	const allFolderIds = new Set();

	function ensureUser(userId) {
		const uid = Number(userId);
		if (!users.has(uid)) {
			users.set(uid, {
				revision: 0,
				folders: new Map(),
				ownedCreationIds: new Set()
			});
		}
		return users.get(uid);
	}

	function snapshot(userId) {
		const state = ensureUser(userId);
		const folders = [...state.folders.values()]
			.map((f) => ({
				id: f.id,
				title: f.title,
				description: f.description,
				created_at: f.created_at,
				updated_at: f.updated_at,
				creation_ids: [...f.creation_ids]
			}))
			.sort((a, b) => {
				const ua = String(b.updated_at).localeCompare(String(a.updated_at));
				if (ua !== 0) return ua;
				return String(a.title).localeCompare(String(b.title));
			});
		return { ok: true, revision: state.revision, folders };
	}

	function removeCreationFromAll(state, creationId) {
		for (const folder of state.folders.values()) {
			const before = folder.creation_ids.length;
			folder.creation_ids = folder.creation_ids.filter((id) => id !== creationId);
			if (folder.creation_ids.length !== before) {
				folder.updated_at = new Date().toISOString();
			}
		}
	}

	return {
		seedOwnedCreations(userId, creationIds) {
			const state = ensureUser(userId);
			for (const id of creationIds) state.ownedCreationIds.add(Number(id));
		},
		queries: {
			getLibraryFoldersSnapshot: {
				get: async (userId) => snapshot(userId)
			},
			mutateLibraryFolders: {
				run: async (userId, baseRevision, operations) => {
					const state = ensureUser(userId);
					if (state.revision !== Number(baseRevision)) {
						const current = snapshot(userId);
						return {
							ok: false,
							error: "conflict",
							revision: current.revision,
							folders: current.folders
						};
					}

					const now = new Date().toISOString();
					for (const op of operations) {
						if (op.op === "create") {
							if (allFolderIds.has(op.id) || state.folders.has(op.id)) {
								return { ok: false, error: "validation", message: "folder id already exists" };
							}
							if (state.folders.size >= 500) {
								return { ok: false, error: "validation", message: "folder limit reached" };
							}
							const creationIds = Array.isArray(op.creation_ids) ? op.creation_ids : [];
							for (const cid of creationIds) {
								if (!state.ownedCreationIds.has(cid)) {
									return { ok: false, error: "validation", message: "creation not owned" };
								}
							}
							for (const cid of creationIds) removeCreationFromAll(state, cid);
							state.folders.set(op.id, {
								id: op.id,
								title: op.title,
								description: op.description ?? "",
								created_at: now,
								updated_at: now,
								creation_ids: [...creationIds]
							});
							allFolderIds.add(op.id);
						} else if (op.op === "update") {
							const folder = state.folders.get(op.id);
							if (!folder) {
								return { ok: false, error: "validation", message: "folder not found" };
							}
							if (op.title !== undefined) folder.title = op.title;
							if (op.description !== undefined) folder.description = op.description;
							folder.updated_at = now;
						} else if (op.op === "delete") {
							if (!state.folders.has(op.id)) {
								return { ok: false, error: "validation", message: "folder not found" };
							}
							state.folders.delete(op.id);
							allFolderIds.delete(op.id);
						} else if (op.op === "move") {
							const creationIds = op.creation_ids || [];
							for (const cid of creationIds) {
								if (!state.ownedCreationIds.has(cid)) {
									return { ok: false, error: "validation", message: "creation not owned" };
								}
							}
							if (op.folder_id != null && !state.folders.has(op.folder_id)) {
								return { ok: false, error: "validation", message: "folder not found" };
							}
							for (const cid of creationIds) removeCreationFromAll(state, cid);
							if (op.folder_id != null) {
								const folder = state.folders.get(op.folder_id);
								for (const cid of creationIds) {
									if (!folder.creation_ids.includes(cid)) folder.creation_ids.push(cid);
								}
								folder.updated_at = now;
							}
						} else {
							return { ok: false, error: "validation", message: "unknown operation" };
						}
					}

					state.revision += 1;
					return snapshot(userId);
				}
			}
		}
	};
}

async function withServer(queries, authUserId, fn) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		if (authUserId != null) req.auth = { userId: authUserId };
		next();
	});
	app.use(createLibraryFoldersRoutes({ queries }));
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	try {
		return await fn(baseUrl);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function api(baseUrl, method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	return { status: res.status, body: json };
}

describe("libraryFolders utils", () => {
	it("rejects invalid base_revision", () => {
		expect(parseBaseRevision(undefined).error).toBeTruthy();
		expect(parseBaseRevision(-1).error).toBeTruthy();
		expect(parseBaseRevision(1.5).error).toBeTruthy();
		expect(parseBaseRevision(0).revision).toBe(0);
	});

	it("normalizes operations and aliases", () => {
		const normalized = normalizeLibraryFolderOperations([
			{
				type: "create",
				id: FOLDER_A,
				title: "  Shots  ",
				creationIds: [1, 1, 2]
			},
			{
				op: "move",
				folderId: null,
				creation_ids: [2]
			}
		]);
		expect(normalized.error).toBeUndefined();
		expect(normalized.operations).toEqual([
			{
				op: "create",
				id: FOLDER_A,
				title: "Shots",
				description: "",
				creation_ids: [1, 2]
			},
			{
				op: "move",
				folder_id: null,
				creation_ids: [2]
			}
		]);
	});

	it("rejects unknown and oversized ops", () => {
		expect(normalizeLibraryFolderOperations([{ op: "rename", id: FOLDER_A }]).error).toMatch(
			/unknown/
		);
		expect(
			normalizeLibraryFolderOperations(
				Array.from({ length: 101 }, () => ({ op: "delete", id: FOLDER_A }))
			).error
		).toMatch(/too many/);
	});

	it("formats snapshot member_count", () => {
		const formatted = formatLibraryFoldersSnapshot({
			revision: 3,
			folders: [{ id: FOLDER_A, title: "A", description: "", creation_ids: [9, 8] }]
		});
		expect(formatted.revision).toBe(3);
		expect(formatted.folders[0].member_count).toBe(2);
		expect(formatted.folders[0].creation_ids).toEqual([9, 8]);
	});
});

describe("libraryFolders API", () => {
	let store;

	beforeEach(() => {
		store = createMemoryLibraryFoldersStore();
		store.seedOwnedCreations(1, [10, 11, 12]);
		store.seedOwnedCreations(2, [20]);
	});

	it("requires auth", async () => {
		await withServer(store.queries, null, async (baseUrl) => {
			const get = await api(baseUrl, "GET", "/api/library/folders");
			expect(get.status).toBe(401);
			const mutate = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_A, title: "A" }]
			});
			expect(mutate.status).toBe(401);
		});
	});

	it("returns empty snapshot for a new user", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			const res = await api(baseUrl, "GET", "/api/library/folders");
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ revision: 0, folders: [] });
		});
	});

	it("creates, updates, moves, and deletes with revision bumps", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			const created = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [
					{
						op: "create",
						id: FOLDER_A,
						title: "Favorites",
						creation_ids: [10, 11]
					}
				]
			});
			expect(created.status).toBe(200);
			expect(created.body.revision).toBe(1);
			expect(created.body.folders).toHaveLength(1);
			expect(created.body.folders[0].creation_ids).toEqual([10, 11]);
			expect(created.body.folders[0].member_count).toBe(2);

			const updated = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 1,
				operations: [
					{ op: "update", id: FOLDER_A, title: "Favs", description: "top picks" },
					{ op: "create", id: FOLDER_B, title: "B-roll" },
					{ op: "move", folder_id: FOLDER_B, creation_ids: [11, 12] }
				]
			});
			expect(updated.status).toBe(200);
			expect(updated.body.revision).toBe(2);
			const byId = Object.fromEntries(updated.body.folders.map((f) => [f.id, f]));
			expect(byId[FOLDER_A].title).toBe("Favs");
			expect(byId[FOLDER_A].description).toBe("top picks");
			expect(byId[FOLDER_A].creation_ids).toEqual([10]);
			expect(byId[FOLDER_B].creation_ids).toEqual([11, 12]);

			const unfiled = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 2,
				operations: [{ op: "move", folder_id: null, creation_ids: [10] }]
			});
			expect(unfiled.status).toBe(200);
			expect(unfiled.body.revision).toBe(3);
			expect(
				unfiled.body.folders.find((f) => f.id === FOLDER_A).creation_ids
			).toEqual([]);

			const deleted = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 3,
				operations: [{ op: "delete", id: FOLDER_A }]
			});
			expect(deleted.status).toBe(200);
			expect(deleted.body.revision).toBe(4);
			expect(deleted.body.folders.map((f) => f.id)).toEqual([FOLDER_B]);
		});
	});

	it("enforces one folder per creation on move", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [
					{ op: "create", id: FOLDER_A, title: "A", creation_ids: [10] },
					{ op: "create", id: FOLDER_B, title: "B" }
				]
			});
			const moved = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 1,
				operations: [{ op: "move", folder_id: FOLDER_B, creation_ids: [10] }]
			});
			expect(moved.status).toBe(200);
			const byId = Object.fromEntries(moved.body.folders.map((f) => [f.id, f]));
			expect(byId[FOLDER_A].creation_ids).toEqual([]);
			expect(byId[FOLDER_B].creation_ids).toEqual([10]);
		});
	});

	it("rejects filing creations the user does not own", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			const res = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [
					{ op: "create", id: FOLDER_A, title: "A", creation_ids: [20] }
				]
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/owned|creation/i);
		});
	});

	it("isolates folders between users", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_A, title: "User1" }]
			});
		});
		await withServer(store.queries, 2, async (baseUrl) => {
			const get = await api(baseUrl, "GET", "/api/library/folders");
			expect(get.status).toBe(200);
			expect(get.body.folders).toEqual([]);
			const conflictCreate = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_A, title: "User2" }]
			});
			// Same UUID colliding globally is rejected by store (mirrors DB PK).
			expect(conflictCreate.status).toBe(400);
			const created = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_C, title: "User2" }]
			});
			expect(created.status).toBe(200);
			expect(created.body.folders).toHaveLength(1);
			expect(created.body.folders[0].id).toBe(FOLDER_C);
		});
	});

	it("returns 409 with current snapshot on stale base_revision", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			const first = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_A, title: "A" }]
			});
			expect(first.status).toBe(200);
			expect(first.body.revision).toBe(1);

			const stale = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_B, title: "B" }]
			});
			expect(stale.status).toBe(409);
			expect(stale.body.error).toBe("conflict");
			expect(stale.body.revision).toBe(1);
			expect(stale.body.folders.map((f) => f.id)).toEqual([FOLDER_A]);

			const retry = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: stale.body.revision,
				operations: [{ op: "create", id: FOLDER_B, title: "B" }]
			});
			expect(retry.status).toBe(200);
			expect(retry.body.revision).toBe(2);
			expect(retry.body.folders.map((f) => f.id).sort()).toEqual(
				[FOLDER_A, FOLDER_B].sort()
			);
		});
	});

	it("rejects invalid mutate payloads", async () => {
		await withServer(store.queries, 1, async (baseUrl) => {
			const missingOps = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0
			});
			expect(missingOps.status).toBe(400);

			const badId = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: "folder-local-1", title: "A" }]
			});
			expect(badId.status).toBe(400);
			expect(badId.body.error).toMatch(/uuid/i);
		});
	});

	it("returns 501 when query helpers are missing", async () => {
		await withServer({}, 1, async (baseUrl) => {
			const get = await api(baseUrl, "GET", "/api/library/folders");
			expect(get.status).toBe(501);
			const mutate = await api(baseUrl, "POST", "/api/library/folders/mutate", {
				base_revision: 0,
				operations: [{ op: "create", id: FOLDER_A, title: "A" }]
			});
			expect(mutate.status).toBe(501);
		});
	});
});
