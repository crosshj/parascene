import express from "express";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(input) {
	const s = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (!s || !SLUG_RE.test(s)) return null;
	return s;
}

function normalizeText(input, max) {
	const t = typeof input === "string" ? input : "";
	if (t.length > max) return t.slice(0, max);
	return t;
}

export default function createBlogAdminRoutes({ queries }) {
	const router = express.Router();

	async function requireAuthedUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}
		return user;
	}

	function isAdmin(user) {
		return user?.role === "admin";
	}

	function isFounderPlan(user) {
		const meta = user?.meta && typeof user.meta === "object" ? user.meta : {};
		return meta.plan === "founder";
	}

	/** Blog create/list/edit APIs: admins and founder-tier accounts only. */
	function canBlogCrud(user) {
		return isAdmin(user) || isFounderPlan(user);
	}

	async function requireBlogContributor(req, res) {
		const user = await requireAuthedUser(req, res);
		if (!user) return null;
		if (!canBlogCrud(user)) {
			res.status(403).json({
				error: "Forbidden",
				message: "Blog editing is limited to admins and founder accounts."
			});
			return null;
		}
		return user;
	}

	function canManageBlogPost(user, post) {
		if (!post) return false;
		if (isAdmin(user)) return true;
		return Number(post.author_user_id) === Number(user.id);
	}

	function authorOptionLabel(u) {
		const name = (u.display_name || u.user_name || "").trim();
		const email = (u.email || "").trim();
		if (name && email) return `${name} (${email})`;
		return email || name || `User ${u.id}`;
	}

	async function loadBlogAuthorCandidates(queries) {
		const all = await queries.selectUsers.all();
		return all.filter((u) => u.role === "admin" || u.meta?.plan === "founder");
	}

	async function allowedBlogAuthorIdSet(queries) {
		const candidates = await loadBlogAuthorCandidates(queries);
		return new Set(candidates.map((c) => Number(c.id)));
	}

	function rowToJson(row) {
		if (!row) return null;
		const meta =
			row.meta && typeof row.meta === "object"
				? row.meta
				: typeof row.meta === "string"
					? (() => {
							try {
								return JSON.parse(row.meta);
							} catch {
								return {};
							}
						})()
					: {};
		return {
			id: row.id,
			slug: row.slug,
			title: row.title,
			description: row.description ?? "",
			body_md: row.body_md ?? "",
			status: row.status,
			published_at: row.published_at ?? null,
			author_user_id: row.author_user_id,
			updated_by_user_id: row.updated_by_user_id ?? null,
			meta,
			created_at: row.created_at,
			updated_at: row.updated_at
		};
	}

	function postJsonWithAuthorUsername(row, profileMap) {
		const j = rowToJson(row);
		const aid = row.author_user_id != null ? Number(row.author_user_id) : null;
		let author_username = "";
		if (aid != null && profileMap instanceof Map) {
			const prof = profileMap.get(aid);
			if (prof?.user_name != null && String(prof.user_name).trim() !== "") {
				author_username = String(prof.user_name).trim();
			}
		}
		return { ...j, author_username };
	}

	/** Admin-only: founder accounts + admin accounts (for reassigning blog post author). */
	router.get("/api/blog/author-options", async (req, res) => {
		const user = await requireAuthedUser(req, res);
		if (!user) return;
		if (!isAdmin(user)) {
			return res.status(403).json({ error: "Forbidden" });
		}
		try {
			const candidates = await loadBlogAuthorCandidates(queries);
			const users = candidates
				.map((u) => ({ id: Number(u.id), label: authorOptionLabel(u) }))
				.sort((a, b) => a.id - b.id);
			return res.json({ users });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to load author options" });
		}
	});

	router.get("/api/blog/posts", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		try {
			const status = typeof req.query?.status === "string" ? req.query.status.trim() : "";
			const valid = ["draft", "published", "archived", ""];
			const statusFilter = valid.includes(status) && status ? status : undefined;
			const listOpts = {
				status: statusFilter,
				limit: 200,
				offset: 0
			};
			if (!isAdmin(user)) listOpts.authorUserId = user.id;
			const rows = await queries.selectBlogPostsAdmin.all(listOpts);
			const authorIds = [
				...new Set(
					rows.map((r) => r.author_user_id).filter((id) => id != null && Number.isFinite(Number(id)))
				)
			].map(Number);
			let profileMap = new Map();
			if (authorIds.length && typeof queries.selectUserProfilesByUserIds === "function") {
				profileMap = await queries.selectUserProfilesByUserIds(authorIds);
			}
			return res.json({ posts: rows.map((row) => postJsonWithAuthorUsername(row, profileMap)) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to list posts" });
		}
	});

	router.get("/api/blog/posts/:id", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const row = await queries.selectBlogPostById.get(id);
			if (!row) return res.status(404).json({ error: "Not found" });
			if (!canManageBlogPost(user, row)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			return res.json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to load post" });
		}
	});

	router.post("/api/blog/posts", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const slug = normalizeSlug(req.body?.slug);
		const title = normalizeText(req.body?.title, 500).trim();
		if (!slug) return res.status(400).json({ error: "Invalid or missing slug" });
		if (!title) return res.status(400).json({ error: "Title is required" });
		const description = normalizeText(req.body?.description ?? "", 2000);
		const body_md = normalizeText(req.body?.body_md ?? "", 2_000_000);
		try {
			const existing = await queries.selectBlogPostBySlugAny.get(slug);
			if (existing) {
				return res.status(409).json({ error: "Slug already exists" });
			}
			const result = await queries.insertBlogPost.run({
				slug,
				title,
				description,
				body_md,
				status: "draft",
				author_user_id: user.id,
				updated_by_user_id: user.id,
				published_at: null,
				meta: {}
			});
			const row = await queries.selectBlogPostById.get(result.insertId ?? result.lastInsertRowid);
			return res.status(201).json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to create post" });
		}
	});

	router.patch("/api/blog/posts/:id", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await queries.selectBlogPostById.get(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManageBlogPost(user, existing)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const patch = { updated_by_user_id: user.id };
			if (req.body?.slug != null) {
				const ns = normalizeSlug(req.body.slug);
				if (!ns) return res.status(400).json({ error: "Invalid slug" });
				if (ns !== existing.slug) {
					const clash = await queries.selectBlogPostBySlugAny.get(ns);
					if (clash && Number(clash.id) !== id) {
						return res.status(409).json({ error: "Slug already in use" });
					}
				}
				patch.slug = ns;
			}
			if (req.body?.title != null) {
				const t = normalizeText(req.body.title, 500).trim();
				if (!t) return res.status(400).json({ error: "Title cannot be empty" });
				patch.title = t;
			}
			if (req.body?.description != null) patch.description = normalizeText(req.body.description, 2000);
			if (req.body?.body_md != null) patch.body_md = normalizeText(req.body.body_md, 2_000_000);
			if (req.body?.author_user_id != null && isAdmin(user)) {
				const aid = parseInt(req.body.author_user_id, 10);
				if (!aid) return res.status(400).json({ error: "Invalid author_user_id" });
				const allowed = await allowedBlogAuthorIdSet(queries);
				if (!allowed.has(aid)) {
					return res.status(400).json({ error: "Author must be an admin or founder account" });
				}
				patch.author_user_id = aid;
			}
			const r = await queries.updateBlogPost.run(id, patch);
			if (!r.changes) return res.status(404).json({ error: "Not found" });
			const row = await queries.selectBlogPostById.get(id);
			return res.json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to update post" });
		}
	});

	router.post("/api/blog/posts/:id/publish", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await queries.selectBlogPostById.get(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManageBlogPost(user, existing)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const now = new Date().toISOString();
			await queries.updateBlogPost.run(id, {
				status: "published",
				published_at: existing.published_at || now,
				updated_by_user_id: user.id
			});
			const row = await queries.selectBlogPostById.get(id);
			return res.json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to publish" });
		}
	});

	router.post("/api/blog/posts/:id/archive", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await queries.selectBlogPostById.get(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManageBlogPost(user, existing)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			await queries.updateBlogPost.run(id, {
				status: "archived",
				updated_by_user_id: user.id
			});
			const row = await queries.selectBlogPostById.get(id);
			return res.json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to archive" });
		}
	});

	router.post("/api/blog/posts/:id/unpublish", async (req, res) => {
		const user = await requireBlogContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await queries.selectBlogPostById.get(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManageBlogPost(user, existing)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			await queries.updateBlogPost.run(id, {
				status: "draft",
				published_at: null,
				updated_by_user_id: user.id
			});
			const row = await queries.selectBlogPostById.get(id);
			return res.json({ post: rowToJson(row) });
		} catch (e) {
			return res.status(500).json({ error: e?.message || "Failed to unpublish" });
		}
	});

	return router;
}
