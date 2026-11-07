import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import { randomUUID } from "node:crypto";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAMPAIGN = /^[a-z0-9]{1,12}$/;
const POSTS = "prsn_blog_posts";
const VIEWS = "prsn_blog_post_views";

function esc(value) {
	return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page({ title = "Blog", description = "", content = "", status = 200, preview = false } = {}) {
	const safeTitle = esc(title);
	const safeDescription = esc(description);
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${safeDescription}"><title>${safeTitle} - parascene</title>${preview ? '<meta name="robots" content="noindex,nofollow">' : ""}<style>
		:root{color-scheme:light dark;font:16px/1.65 system-ui,sans-serif;color:CanvasText;background:Canvas}*{box-sizing:border-box}body{margin:0}.blog-head{border-bottom:1px solid color-mix(in srgb,CanvasText 14%,transparent)}.blog-head nav,main{width:min(720px,100% - 32px);margin:auto}.blog-head nav{height:56px;display:flex;align-items:center;justify-content:space-between}.blog-head a,main a{color:inherit}.blog-head a{text-decoration:none;font-weight:650;letter-spacing:.04em}.blog-head nav span{display:flex;gap:18px;font-size:.9rem}main{padding:28px 0 72px}h1{font-size:1.8rem;line-height:1.2;margin:.1em 0 .35em}h2{font-size:1.3rem;line-height:1.3;margin:1.7em 0 .4em}p,ul,ol,blockquote{margin:.85em 0}img{max-width:100%;height:auto}pre{overflow:auto;padding:14px;border-radius:8px;background:color-mix(in srgb,CanvasText 8%,Canvas)}code{font-family:ui-monospace,monospace}blockquote{border-left:3px solid color-mix(in srgb,CanvasText 25%,transparent);padding-left:1em;color:color-mix(in srgb,CanvasText 78%,Canvas)}.date,.preview{color:color-mix(in srgb,CanvasText 65%,Canvas);font-size:.9rem}.preview{padding:8px 12px;border:1px solid color-mix(in srgb,CanvasText 20%,Canvas);border-radius:6px}footer{border-top:1px solid color-mix(in srgb,CanvasText 14%,transparent);padding:20px 16px;text-align:center;font-size:.85rem;color:color-mix(in srgb,CanvasText 65%,Canvas)}		</style></head><body><header class="blog-head"><nav><a href="/blog">PARASCENE · BLOG</a><span><a href="/blog">Posts</a><a href="/">Home</a></span></nav></header><main>${content}</main><footer>© 2026 parascene</footer></body></html>`;
}

function parsePath(segments) {
	if (segments.length > 1 && CAMPAIGN.test(segments[0])) return { campaign: segments[0], slug: segments.slice(1).join("/"), fallbackSlug: segments.join("/") };
	return { campaign: null, slug: segments.join("/") };
}

export default function createBlogRoutes({ client, users, pagesDir }) {
	const router = express.Router();
	const blogDir = path.join(pagesDir, "blog");
	let cache;
	let cacheAt = 0;
	const ttl = process.env.NODE_ENV === "production" ? 60_000 : 0;

	async function publishedPosts() {
		if (cache && Date.now() - cacheAt < ttl) return cache;
		const { data, error } = await client.from(POSTS).select("id,slug,title,description,body_md,published_at,meta,author_user_id").eq("status", "published").order("published_at", { ascending: false }).limit(500);
		if (error) throw error;
		cache = data || [];
		cacheAt = Date.now();
		return cache;
	}

	function postHref(slug, campaign) {
		return `/blog/${campaign ? `${encodeURIComponent(campaign)}/` : ""}${String(slug).split("/").map(encodeURIComponent).join("/")}`;
	}

	async function renderIndex(res) {
		const source = await fs.readFile(path.join(blogDir, "index.md"), "utf8");
		const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
		let title = "Blog", description = "";
		let body = source;
		if (match) {
			body = source.slice(match[0].length);
			title = match[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] || title;
			description = match[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] || "";
		}
		const posts = await publishedPosts();
		const list = posts.length ? posts.map(p => `- [${String(p.title || p.slug).replace(/[\[\]]/g, "\\$&")}](${postHref(p.slug, "i")})`).join("\n") : "_No posts published yet._";
		body = body.replace(/\{\{\s*BLOG_POST_LIST\s*\}\}|<!--\s*BLOG_POST_LIST\s*-->/gi, list);
		const html = marked.parse(body);
		return res.status(200).send(page({ title, description, content: html }));
	}

	router.get("/blog", async (_req, res) => {
		try { return await renderIndex(res); }
		catch (error) { console.error("[blog] index failed", error); return res.status(500).send(page({ title: "Blog unavailable", content: "<h1>Blog unavailable</h1>" })); }
	});

	router.get("/blog/*", async (req, res) => {
		try {
			const parts = req.path.replace(/^\/blog\/?/, "").replace(/\/$/, "").split("/").filter(Boolean).map(decodeURIComponent);
			const { campaign, slug, fallbackSlug } = parsePath(parts);
			let { data: post, error } = await client.from(POSTS).select("id,slug,title,description,body_md,published_at,meta,author_user_id,status").eq("slug", slug).eq("status", "published").maybeSingle();
			if (error) throw error;
			if (!post && fallbackSlug) {
				const fallback = await client.from(POSTS).select("id,slug,title,description,body_md,published_at,meta,author_user_id,status").eq("slug", fallbackSlug).eq("status", "published").maybeSingle();
				if (fallback.error) throw fallback.error;
				post = fallback.data;
			}
			let preview = false;
			if (!post && req.query.preview !== undefined && !["0", "false", "no"].includes(String(req.query.preview).toLowerCase())) {
				const result = await client.from(POSTS).select("id,slug,title,description,body_md,published_at,meta,author_user_id,status").eq("slug", slug).maybeSingle();
				if (result.error) throw result.error;
				if (result.data) {
					const user = req.auth?.userId ? await users.byId(req.auth.userId) : null;
					const allowed = user && (user.role === "admin" || Number(result.data.author_user_id) === Number(user.id));
					if (!allowed) return res.status(user ? 403 : 401).send(page({ title: "Preview unavailable", content: `<h1>${user ? "Preview not allowed" : "Sign in to preview"}</h1><p>${user ? "You do not have permission to preview this post." : `Sign in to preview this post. <a href="/auth?returnUrl=${encodeURIComponent(req.originalUrl)}#login">Sign in</a>`}</p>` }));
					post = result.data;
					preview = true;
				}
			}
			if (!post) return res.status(404).send(page({ title: "Post not found", content: "<h1>Post Not Found</h1><p>The blog post you’re looking for doesn’t exist or may have been moved.</p>" }));
			if (!preview) {
				const cid = req.cookies?.ps_cid || randomUUID();
				if (!req.cookies?.ps_cid) res.cookie("ps_cid", cid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 86400000, path: "/" });
				void client.from(VIEWS).insert({ blog_post_id: post.id, post_slug: post.slug, campaign_id: campaign, referer: req.get("referer") || null, anon_cid: cid, meta: { page: "blog", post_slug: post.slug, campaign } }).then(({ error: viewError }) => { if (viewError) console.warn("[blog] view logging failed", viewError.message); });
			}
			const date = post.published_at && new Date(post.published_at);
			const dateHtml = date && !Number.isNaN(date.getTime()) ? `<p class="date"><time datetime="${date.toISOString().slice(0, 10)}">${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time></p>` : "";
			const content = `${preview ? `<p class="preview">Previewing ${esc(post.status)} post. This is not the public version.</p>` : ""}${dateHtml}<h1>${esc(post.title)}</h1>${post.description ? `<p>${esc(post.description)}</p>` : ""}<article>${marked.parse(post.body_md || "")}</article>`;
			const response = page({ title: post.title, description: post.description || `${post.title} — parascene blog post.`, content, preview });
			return res.status(200).send(response.replace("<title>", `<link rel="canonical" href="${esc(`${process.env.APP_ORIGIN || "https://www.parascene.com"}${postHref(post.slug)}`)}"><title>`));
		} catch (error) { console.error("[blog] post failed", error); return res.status(500).send(page({ title: "Blog unavailable", content: "<h1>Blog unavailable</h1>" })); }
	});
	return router;
}
