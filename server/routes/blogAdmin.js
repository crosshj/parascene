import express from "express";
import { getBaseAppUrl } from "../services/create/url.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAMPAIGN_RE = /^[a-z0-9]{1,12}$/;
const POSTS = "prsn_blog_posts";
const VIEWS = "prsn_blog_post_views";
const CAMPAIGNS = "prsn_blog_campaigns";
const POST_FIELDS = "id, slug, title, description, body_md, status, published_at, author_user_id, updated_by_user_id, meta, created_at, updated_at";

function normalizeSlug(input) {
	const slug = typeof input === "string" ? input.trim().toLowerCase() : "";
	return slug && SLUG_RE.test(slug) ? slug : null;
}

function normalizeText(input, max) {
	const text = typeof input === "string" ? input : "";
	return text.length > max ? text.slice(0, max) : text;
}

function normalizeCampaignId(input) {
	const id = typeof input === "string" ? input.trim().toLowerCase() : "";
	return id && CAMPAIGN_RE.test(id) ? id : null;
}

function isReservedCampaign(id) {
	return id === "n" || id === "i";
}

function metaOf(value) {
	if (value && typeof value === "object") return value;
	if (typeof value === "string") {
		try { return JSON.parse(value); } catch { return {}; }
	}
	return {};
}

function rowToJson(row) {
	if (!row) return null;
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
		meta: metaOf(row.meta),
		created_at: row.created_at,
		updated_at: row.updated_at
	};
}

async function eachPage(build) {
	const rows = [];
	for (let from = 0; ; from += 1000) {
		const result = await build(from, from + 999);
		if (result.error) throw result.error;
		const data = result.data || [];
		rows.push(...data);
		if (data.length < 1000) return rows;
	}
}

export function createBlogAdminRoutes({ client }) {
	const router = express.Router();

	async function userById(id) {
		const result = await client.from("prsn_users").select("id,email,role,meta").eq("id", id).maybeSingle();
		if (result.error) throw result.error;
		return result.data || null;
	}

	async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		const user = await userById(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}
		return user;
	}

	function isAdmin(user) {
		return user?.role === "admin";
	}

	function canBlog(user) {
		return isAdmin(user) || metaOf(user?.meta).plan === "founder";
	}

	async function requireContributor(req, res) {
		const user = await requireUser(req, res);
		if (!user) return null;
		if (!canBlog(user)) {
			res.status(403).json({ error: "Forbidden", message: "Blog editing is limited to admins and founder accounts." });
			return null;
		}
		return user;
	}

	function canManage(user, post) {
		return Boolean(post) && (isAdmin(user) || Number(post.author_user_id) === Number(user.id));
	}

	async function authorCandidates() {
		const users = await eachPage((from, to) => client.from("prsn_users").select("id,email,role,meta").order("id", { ascending: true }).range(from, to));
		return users.filter((user) => user.role === "admin" || metaOf(user.meta).plan === "founder");
	}

	async function profilesFor(ids) {
		const map = new Map();
		for (let index = 0; index < ids.length; index += 200) {
			const chunk = ids.slice(index, index + 200);
			if (!chunk.length) continue;
			const result = await client.from("prsn_user_profiles").select("user_id,user_name,display_name").in("user_id", chunk);
			if (result.error) throw result.error;
			for (const row of result.data || []) map.set(Number(row.user_id), row);
		}
		return map;
	}

	async function postById(id) {
		const result = await client.from(POSTS).select(POST_FIELDS).eq("id", id).maybeSingle();
		if (result.error) throw result.error;
		return result.data || null;
	}

	async function postBySlug(slug) {
		const result = await client.from(POSTS).select(POST_FIELDS).eq("slug", slug).maybeSingle();
		if (result.error) throw result.error;
		return result.data || null;
	}

	async function updatePost(id, patch) {
		const existing = await client.from(POSTS).select("meta").eq("id", id).maybeSingle();
		if (existing.error) throw existing.error;
		if (!existing.data) return 0;
		const row = { updated_at: new Date().toISOString() };
		for (const key of ["slug", "title", "description", "body_md", "status", "published_at", "author_user_id", "updated_by_user_id"]) {
			if (patch[key] !== undefined) row[key] = patch[key];
		}
		if (patch.meta && typeof patch.meta === "object") row.meta = { ...metaOf(existing.data.meta), ...patch.meta };
		const result = await client.from(POSTS).update(row).eq("id", id).select("id");
		if (result.error) throw result.error;
		return result.data?.length || 0;
	}

	async function viewStats() {
		const rows = await eachPage((from, to) => client.from(VIEWS).select("blog_post_id,campaign_id").order("id", { ascending: true }).range(from, to));
		const byPost = new Map();
		const byCampaign = new Map();
		for (const row of rows) {
			if (row.blog_post_id != null) byPost.set(Number(row.blog_post_id), (byPost.get(Number(row.blog_post_id)) || 0) + 1);
			const campaign = row.campaign_id ?? "";
			byCampaign.set(campaign, (byCampaign.get(campaign) || 0) + 1);
		}
		return {
			total: rows.length,
			byPost: [...byPost.entries()].map(([blog_post_id, views]) => ({ blog_post_id, views })),
			byCampaign: [...byCampaign.entries()].map(([campaign, views]) => ({ campaign_id: campaign === "" ? null : campaign, views }))
		};
	}

	router.get("/api/blog/author-options", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!isAdmin(user)) return res.status(403).json({ error: "Forbidden" });
		try {
			const candidates = await authorCandidates();
			const profiles = await profilesFor(candidates.map((item) => item.id));
			const users = candidates.map((item) => {
				const profile = profiles.get(Number(item.id));
				const name = String(profile?.display_name || profile?.user_name || "").trim();
				const email = String(item.email || "").trim();
				const label = name && email ? `${name} (${email})` : email || name || `User ${item.id}`;
				return { id: Number(item.id), label };
			}).sort((a, b) => a.id - b.id);
			return res.json({ users });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to load author options" });
		}
	});

	router.get("/api/blog/posts", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		try {
			const status = typeof req.query?.status === "string" ? req.query.status.trim() : "";
			let query = client.from(POSTS).select(POST_FIELDS);
			if (["draft", "published", "archived"].includes(status)) query = query.eq("status", status);
			if (!isAdmin(user)) query = query.eq("author_user_id", user.id);
			const result = await query.order("updated_at", { ascending: false }).range(0, 199);
			if (result.error) throw result.error;
			const rows = result.data || [];
			const profiles = await profilesFor([...new Set(rows.map((row) => Number(row.author_user_id)).filter((id) => id > 0))]);
			let views = new Map();
			try {
				const stats = await viewStats();
				views = new Map(stats.byPost.map((row) => [Number(row.blog_post_id), row.views]));
			} catch { views = new Map(); }
			return res.json({
				posts: rows.map((row) => ({
					...rowToJson(row),
					author_username: String(profiles.get(Number(row.author_user_id))?.user_name || "").trim(),
					view_count: views.get(Number(row.id)) || 0
				}))
			});
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to list posts" });
		}
	});

	router.get("/api/blog/posts/:id", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const row = await postById(id);
			if (!row) return res.status(404).json({ error: "Not found" });
			if (!canManage(user, row)) return res.status(403).json({ error: "Forbidden" });
			return res.json({ post: rowToJson(row) });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to load post" });
		}
	});

	router.post("/api/blog/posts", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		const slug = normalizeSlug(req.body?.slug);
		const title = normalizeText(req.body?.title, 500).trim();
		if (!slug) return res.status(400).json({ error: "Invalid or missing slug" });
		if (!title) return res.status(400).json({ error: "Title is required" });
		try {
			if (await postBySlug(slug)) return res.status(409).json({ error: "Slug already exists" });
			const inserted = await client.from(POSTS).insert({
				slug,
				title,
				description: normalizeText(req.body?.description ?? "", 2000),
				body_md: normalizeText(req.body?.body_md ?? "", 2_000_000),
				status: "draft",
				author_user_id: user.id,
				updated_by_user_id: user.id,
				published_at: null,
				meta: {}
			}).select("id").single();
			if (inserted.error) throw inserted.error;
			return res.status(201).json({ post: rowToJson(await postById(inserted.data.id)) });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to create post" });
		}
	});

	router.patch("/api/blog/posts/:id", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await postById(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManage(user, existing)) return res.status(403).json({ error: "Forbidden" });
			const patch = { updated_by_user_id: user.id };
			if (req.body?.slug != null) {
				const slug = normalizeSlug(req.body.slug);
				if (!slug) return res.status(400).json({ error: "Invalid slug" });
				if (slug !== existing.slug) {
					const clash = await postBySlug(slug);
					if (clash && Number(clash.id) !== id) return res.status(409).json({ error: "Slug already in use" });
				}
				patch.slug = slug;
			}
			if (req.body?.title != null) {
				const title = normalizeText(req.body.title, 500).trim();
				if (!title) return res.status(400).json({ error: "Title cannot be empty" });
				patch.title = title;
			}
			if (req.body?.description != null) patch.description = normalizeText(req.body.description, 2000);
			if (req.body?.body_md != null) patch.body_md = normalizeText(req.body.body_md, 2_000_000);
			if (req.body?.author_user_id != null && isAdmin(user)) {
				const authorId = parseInt(req.body.author_user_id, 10);
				if (!authorId) return res.status(400).json({ error: "Invalid author_user_id" });
				const allowed = new Set((await authorCandidates()).map((item) => Number(item.id)));
				if (!allowed.has(authorId)) return res.status(400).json({ error: "Author must be an admin or founder account" });
				patch.author_user_id = authorId;
			}
			if (!(await updatePost(id, patch))) return res.status(404).json({ error: "Not found" });
			return res.json({ post: rowToJson(await postById(id)) });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to update post" });
		}
	});

	router.delete("/api/blog/posts/:id", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		try {
			const existing = await postById(id);
			if (!existing) return res.status(404).json({ error: "Not found" });
			if (!canManage(user, existing)) return res.status(403).json({ error: "Forbidden" });
			const views = await client.from(VIEWS).delete().eq("blog_post_id", id);
			if (views.error) throw views.error;
			const removed = await client.from(POSTS).delete().eq("id", id).select("id");
			if (removed.error) throw removed.error;
			if (!removed.data?.length) return res.status(404).json({ error: "Not found" });
			return res.status(204).end();
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to delete post" });
		}
	});

	for (const [path, status, publishedAt] of [
		["/api/blog/posts/:id/publish", "published", "keep"],
		["/api/blog/posts/:id/archive", "archived", "leave"],
		["/api/blog/posts/:id/unpublish", "draft", "clear"]
	]) {
		router.post(path, async (req, res) => {
			const user = await requireContributor(req, res);
			if (!user) return;
			const id = parseInt(req.params.id, 10);
			if (!id) return res.status(400).json({ error: "Invalid id" });
			try {
				const existing = await postById(id);
				if (!existing) return res.status(404).json({ error: "Not found" });
				if (!canManage(user, existing)) return res.status(403).json({ error: "Forbidden" });
				const patch = { status, updated_by_user_id: user.id };
				if (publishedAt === "keep") patch.published_at = existing.published_at || new Date().toISOString();
				if (publishedAt === "clear") patch.published_at = null;
				await updatePost(id, patch);
				return res.json({ post: rowToJson(await postById(id)) });
			} catch (error) {
				return res.status(500).json({ error: error.message || "Failed to update post status" });
			}
		});
	}

	router.get("/api/blog/analytics/summary", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!isAdmin(user)) return res.status(403).json({ error: "Forbidden" });
		try {
			const stats = await viewStats();
			const byPost = new Map(stats.byPost.map((row) => [Number(row.blog_post_id), row.views]));
			const rows = await client.from(POSTS).select("id,slug,title,status").order("updated_at", { ascending: false }).range(0, 499);
			if (rows.error) throw rows.error;
			return res.json({
				total: stats.total,
				byPost: stats.byPost,
				byCampaign: stats.byCampaign,
				posts: (rows.data || []).map((row) => ({ id: row.id, slug: row.slug, title: row.title, status: row.status, views: byPost.get(Number(row.id)) || 0 }))
			});
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to load analytics" });
		}
	});

	router.get("/api/blog/campaigns", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		try {
			const result = await client.from(CAMPAIGNS).select("id,label,notes,active,created_at").order("created_at", { ascending: true });
			if (result.error) throw result.error;
			return res.json({ campaigns: result.data || [] });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to list campaigns" });
		}
	});

	router.post("/api/blog/campaigns", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!isAdmin(user)) return res.status(403).json({ error: "Forbidden" });
		const id = normalizeCampaignId(req.body?.id);
		if (!id) return res.status(400).json({ error: "Invalid campaign id (use 1–12 lowercase letters/numbers)" });
		if (isReservedCampaign(id)) return res.status(400).json({ error: "Campaign ids n and i are reserved for in-app and blog index links and cannot be registered." });
		const label = normalizeText(req.body?.label ?? "", 200);
		const notes = normalizeText(req.body?.notes ?? "", 2000);
		const active = req.body?.active !== false;
		const inserted = await client.from(CAMPAIGNS).insert({ id, label, notes, active });
		if (inserted.error) {
			if (inserted.error.code === "23505") return res.status(409).json({ error: "Campaign id already exists" });
			return res.status(500).json({ error: inserted.error.message || "Failed to create campaign" });
		}
		return res.status(201).json({ campaign: { id, label, notes, active } });
	});

	router.patch("/api/blog/campaigns/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!isAdmin(user)) return res.status(403).json({ error: "Forbidden" });
		const id = normalizeCampaignId(req.params.id);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		const patch = {};
		if (req.body?.label != null) patch.label = normalizeText(req.body.label, 200);
		if (req.body?.notes != null) patch.notes = normalizeText(req.body.notes, 2000);
		if (req.body?.active != null) patch.active = Boolean(req.body.active);
		if (!Object.keys(patch).length) return res.status(404).json({ error: "Not found" });
		const result = await client.from(CAMPAIGNS).update(patch).eq("id", id).select("id");
		if (result.error) return res.status(500).json({ error: result.error.message || "Failed to update campaign" });
		if (!result.data?.length) return res.status(404).json({ error: "Not found" });
		return res.json({ ok: true });
	});

	router.get("/api/blog/posts/:id/tracked-url", async (req, res) => {
		const user = await requireContributor(req, res);
		if (!user) return;
		const id = parseInt(req.params.id, 10);
		const campaignId = normalizeCampaignId(req.query?.campaign);
		if (!id) return res.status(400).json({ error: "Invalid id" });
		if (!campaignId) return res.status(400).json({ error: "Query campaign=campaignId required" });
		try {
			const row = await postById(id);
			if (!row) return res.status(404).json({ error: "Not found" });
			if (!canManage(user, row)) return res.status(403).json({ error: "Forbidden" });
			const base = getBaseAppUrl().replace(/\/$/, "");
			const encoded = String(row.slug || "").split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
			return res.json({ url: `${base}/blog/${encodeURIComponent(campaignId)}/${encoded}`, canonical: `${base}/blog/${encoded}` });
		} catch (error) {
			return res.status(500).json({ error: error.message || "Failed to build URL" });
		}
	});

	return router;
}
