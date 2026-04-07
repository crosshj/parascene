import express from "express";
import path from "path";
import { marked } from "marked";
import { getAvatarColor } from "../public/shared/avatar.js";
import { injectCommonHead, getPageTokens, getCanonicalLinkHtml } from "./utils/head.js";
import { buildRequestMeta } from "./utils/analytics.js";
import { getBaseAppUrl } from "./utils/url.js";
import { scanBlogDirectory, sortBlogPosts } from "../lib/blog/parseAndScan.js";
import { parseBlogPathSegments, buildBlogPostPublicPath, BLOG_CAMPAIGN_INDEX } from "../lib/blog/campaignPath.js";

marked.setOptions({
	gfm: true,
	breaks: false,
	headerIds: true,
	mangle: false
});

function escapeHtml(text) {
	return String(text || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function normalizeUserNameForProfile(userName) {
	const value = typeof userName === "string" ? userName.trim().toLowerCase() : "";
	if (!value) return null;
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(value)) return null;
	return value;
}

function buildPublicProfilePath({ userName, userId } = {}) {
	const normalizedUserName = normalizeUserNameForProfile(userName);
	if (normalizedUserName) {
		return `/p/${encodeURIComponent(normalizedUserName)}`;
	}
	const id = Number.parseInt(String(userId ?? ""), 10);
	if (Number.isFinite(id) && id > 0) {
		return `/user/${id}`;
	}
	return null;
}

function formatBlogDateParts(post) {
	if (post?.published_at) {
		const d = new Date(post.published_at);
		if (!Number.isNaN(d.getTime())) {
			return {
				label: d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
				datetimeAttr: d.toISOString().slice(0, 10)
			};
		}
	}
	const raw = post?.date;
	if (raw != null && String(raw).trim()) {
		const s = String(raw).trim();
		const parsed = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T12:00:00.000Z`) : new Date(s);
		if (!Number.isNaN(parsed.getTime())) {
			return {
				label: parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
				datetimeAttr: parsed.toISOString().slice(0, 10)
			};
		}
	}
	return { label: "", datetimeAttr: "" };
}

function emailLocalPart(email) {
	if (typeof email !== "string" || !email.includes("@")) return "";
	return email.split("@")[0].trim();
}

function blogBylineAvatarHtml({ avatarUrl, initial, colorSeed }) {
	const seed = String(colorSeed ?? "").trim() || "x";
	const bg = getAvatarColor(seed);
	const ch = (initial && String(initial).trim().charAt(0).toUpperCase()) || "?";
	const safeUrl = typeof avatarUrl === "string" ? avatarUrl.trim() : "";
	if (safeUrl) {
		return `<span class="blog-byline-avatar blog-byline-avatar--img" aria-hidden="true"><img class="blog-byline-avatar-img" src="${escapeHtml(safeUrl)}" alt="" width="36" height="36" loading="lazy" decoding="async" /></span>`;
	}
	return `<span class="blog-byline-avatar blog-byline-avatar--fallback" style="--blog-byline-avatar-bg:${escapeHtml(bg)}" aria-hidden="true">${escapeHtml(ch)}</span>`;
}

function buildBlogBylineHtml(post) {
	if (!post) return "";
	const { label: dateLabel, datetimeAttr } = formatBlogDateParts(post);
	const chunks = [];

	if (post._source === "file") {
		const a = typeof post.author === "string" ? post.author.trim() : "";
		if (a) {
			const av = blogBylineAvatarHtml({
				avatarUrl: "",
				initial: a,
				colorSeed: a
			});
			chunks.push(
				`<span class="blog-byline-file-author"><span class="blog-byline-profile blog-byline-profile--static">${av}<span class="blog-byline-names">${escapeHtml(a)}</span></span></span>`
			);
		}
	} else if (post.author_user_id != null) {
		const prof = post._profile;
		const u = post._authorUser;
		const isFounder = u?.meta?.plan === "founder";
		const userName = prof && typeof prof.user_name === "string" ? prof.user_name.trim() : "";
		const emailPrefix = emailLocalPart(u?.email);
		const avatarUrl = prof && typeof prof.avatar_url === "string" ? prof.avatar_url.trim() : "";
		const handleLabel = userName
			? `@${userName}`
			: emailPrefix
				? `@${emailPrefix}`
				: `user_${post.author_user_id}`;
		const initialSource = userName || emailPrefix || String(post.author_user_id);
		const href = buildPublicProfilePath({ userName, userId: post.author_user_id });
		if (href) {
			const colorSeed = userName || emailPrefix || String(post.author_user_id);
			const av = blogBylineAvatarHtml({
				avatarUrl,
				initial: initialSource,
				colorSeed
			});
			const namesInner = isFounder
				? `<span class="founder-name">${escapeHtml(handleLabel)}</span>`
				: escapeHtml(handleLabel);
			chunks.push(
				`<a class="blog-byline-profile" href="${escapeHtml(href)}">${av}<span class="blog-byline-names">${namesInner}</span></a>`
			);
		}
	}

	if (chunks.length === 0 && !dateLabel) {
		return "";
	}

	const authorHtml = chunks.length ? `<span class="blog-byline-who">${chunks.join(" ")}</span>` : "";
	const parts = [];
	if (authorHtml) parts.push(authorHtml);
	if (dateLabel) {
		parts.push(
			`<time class="blog-byline-date" datetime="${escapeHtml(datetimeAttr)}">${escapeHtml(dateLabel)}</time>`
		);
	}
	if (parts.length === 0) return "";
	return `<p class="blog-byline">${parts.join('<span class="blog-byline-sep" aria-hidden="true"> · </span>')}</p>`;
}

function previewBannerHtmlForDbRow(row) {
	if (!row) return "";
	const st = String(row.status || "").toLowerCase();
	let msg;
	if (st === "draft") {
		msg =
			"You're previewing a draft of an unpublished blog post available only to logged in users.";
	} else if (st === "archived") {
		msg = "You're previewing an archived post. It isn't shown on the public blog.";
	} else {
		msg = "You're previewing this post. It isn't what visitors see on the public blog yet.";
	}
	return `<p class="blog-preview-banner" role="status">${escapeHtml(msg)}</p>`;
}

function isBlogPreviewQuery(req) {
	const p = req.query?.preview;
	if (p === undefined || p === null) return false;
	if (p === "") return true;
	const s = String(p).trim().toLowerCase();
	if (s === "0" || s === "false" || s === "no") return false;
	return true;
}

function blogPreviewAuthErrorHtml({ title, message, req, showSignIn }) {
	const returnUrl = encodeURIComponent(String(req.originalUrl || req.url || "/"));
	const signInHref = `/auth?returnUrl=${returnUrl}#login`;
	const signInBlock = showSignIn
		? `<p><a href="${escapeHtml(signInHref)}">Sign in</a> to preview this post.</p>`
		: "";
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/global.css"/></head><body class="blog-page"><main class="blog-main blog-content"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${signInBlock}</main></body></html>`;
}

function generateBlogPageHtml({
	title,
	description,
	html,
	notFound = false,
	bylineHtml = "",
	previewBannerHtml = ""
}) {
	const hasTitle = Boolean(title && String(title).trim());
	const safeTitle = hasTitle ? escapeHtml(title) : "";
	const safeDescription = escapeHtml(description || "");

	let mainContent;
	if (notFound) {
		mainContent = `
			<div class="blog-content">
				<h1>Post Not Found</h1>
				<p>The blog post you're looking for doesn't exist or may have been moved.</p>
			</div>
		`;
	} else {
		mainContent = `
			<div class="blog-content">
				${previewBannerHtml || ""}
				${hasTitle ? `<h1>${safeTitle}</h1>` : ""}
				${bylineHtml || ""}
				${description ? `<p class="blog-description">${safeDescription}</p>` : ""}
				<div class="blog-body">
					${html}
				</div>
			</div>
		`;
	}

	return `
		<div class="blog-layout">
			<section class="blog-article">
				${mainContent}
			</section>
		</div>
	`;
}

function rowDateFromMeta(meta) {
	if (meta && typeof meta === "object" && typeof meta.source_date === "string") {
		return meta.source_date;
	}
	return "";
}

function rowToMergedPost(row) {
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
	const body = row.body_md ?? "";
	const publishedAtIso = row.published_at ? String(row.published_at) : "";
	const published = publishedAtIso ? publishedAtIso.slice(0, 10) : "";
	const date = rowDateFromMeta(meta) || published;
	const authorUserId =
		row.author_user_id != null && Number.isFinite(Number(row.author_user_id))
			? Number(row.author_user_id)
			: null;
	return {
		id: row.id != null ? Number(row.id) : null,
		slug: row.slug,
		title: row.title,
		description: row.description ?? "",
		date,
		published_at: publishedAtIso || null,
		author_user_id: authorUserId,
		content: body,
		html: marked.parse(body),
		_source: "db"
	};
}

/** Escape markdown link label text for [label](url) lists. */
function escapeMarkdownLinkLabel(text) {
	return String(text ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]");
}

/** Build bullet list markdown from merged published posts (DB + repo fallback). */
function formatMergedPostsAsIndexMarkdown(posts) {
	if (!Array.isArray(posts) || posts.length === 0) {
		return "_No posts published yet._";
	}
	return posts
		.map((p) => {
			const slug = String(p.slug || "").trim();
			const title = escapeMarkdownLinkLabel(p.title || slug);
			return `- [${title}](${buildBlogPostPublicPath(slug, BLOG_CAMPAIGN_INDEX)})`;
		})
		.join("\n");
}

async function getMergedBlogPosts(blogDir, queries) {
	const filePosts = await scanBlogDirectory(blogDir, blogDir);
	const fileMapped = filePosts.map((p) => ({
		...p,
		html: marked.parse(p.content),
		_source: "file"
	}));

	let dbPosts = [];
	if (queries?.selectPublishedBlogPosts?.all) {
		try {
			const rows = await queries.selectPublishedBlogPosts.all();
			dbPosts = Array.isArray(rows) ? rows.map(rowToMergedPost) : [];
		} catch {
			dbPosts = [];
		}
	}

	const dbSlugs = new Set(dbPosts.map((p) => p.slug));
	const onlyFile = fileMapped.filter((p) => !dbSlugs.has(p.slug));
	const merged = sortBlogPosts([...dbPosts, ...onlyFile]);
	return merged;
}

export default function createBlogRoutes({ pagesDir, queries }) {
	const router = express.Router();
	const blogDir = path.join(pagesDir, "blog");

	function getPageForUser(user) {
		const roleToPage = {
			consumer: "app.html",
			creator: "app.html",
			provider: "app.html",
			admin: "app-admin.html"
		};
		return roleToPage[user.role] || "app.html";
	}

	let postsCache = null;
	let postsCacheTime = 0;
	const CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60000 : 0;

	async function getBlogPostsCached() {
		const now = Date.now();
		if (postsCache && now - postsCacheTime < CACHE_TTL_MS) {
			return postsCache;
		}
		postsCache = await getMergedBlogPosts(blogDir, queries);
		postsCacheTime = now;
		return postsCache;
	}

	async function getPublicHeaderHtml() {
		const fs = await import("fs/promises");
		const indexPath = path.join(pagesDir, "index.html");
		try {
			const indexHtml = await fs.readFile(indexPath, "utf-8");
			const match = indexHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
			return match ? match[0] : "";
		} catch {
			return "";
		}
	}

	async function resolvePublishedPost(slug) {
		if (queries?.selectBlogPostPublishedBySlug?.get) {
			try {
				const row = await queries.selectBlogPostPublishedBySlug.get(slug);
				if (row) {
					const merged = rowToMergedPost(row);
					if (merged.author_user_id != null && queries.selectUserProfileByUserId?.get) {
						merged._profile = await queries.selectUserProfileByUserId.get(merged.author_user_id);
					}
					if (merged.author_user_id != null && queries.selectUserById?.get) {
						merged._authorUser = await queries.selectUserById.get(merged.author_user_id);
					}
					return merged;
				}
			} catch {
				// fall through
			}
		}
		const filePosts = await scanBlogDirectory(blogDir, blogDir);
		const fp = filePosts.find((p) => p.slug === slug);
		if (!fp) return null;
		return {
			id: null,
			slug: fp.slug,
			title: fp.title,
			description: fp.description,
			date: fp.date,
			author: fp.author || "",
			published_at: null,
			author_user_id: null,
			content: fp.content,
			html: marked.parse(fp.content),
			_source: "file"
		};
	}

	function canonicalBlogUrlForSlug(slug) {
		const base = getBaseAppUrl().replace(/\/$/, "");
		if (!slug) return `${base}/blog`;
		const enc = String(slug)
			.split("/")
			.filter(Boolean)
			.map((s) => encodeURIComponent(s))
			.join("/");
		return `${base}/blog/${enc}`;
	}

	function tryLogBlogPostView(req, queries, { post, campaign, slugUsed }) {
		if (!post || !queries?.insertBlogPostView?.run) return;
		const referer = typeof req.get("referer") === "string" ? req.get("referer").trim() || null : null;
		const anonCid = typeof req.cookies?.ps_cid === "string" ? req.cookies.ps_cid.trim() || null : null;
		const blog_post_id = post._source === "db" && post.id != null ? Number(post.id) : null;
		const meta = buildRequestMeta(req, {
			page: "blog",
			post_slug: post.slug || slugUsed,
			campaign: campaign ?? null
		});
		queries.insertBlogPostView
			.run({
				blog_post_id,
				post_slug: post.slug || slugUsed || "",
				campaign_id: campaign ?? null,
				referer,
				anon_cid: anonCid,
				meta
			})
			.catch(() => {});
	}

	async function resolvePublishedPostForBlogPath(segments) {
		const parsed = parseBlogPathSegments(segments);
		let post = await resolvePublishedPost(parsed.slug);
		let campaign = parsed.campaign;
		let slugUsed = parsed.slug;
		if (parsed.tryCampaignFallback && !post) {
			post = await resolvePublishedPost(segments.join("/"));
			campaign = null;
			slugUsed = segments.join("/");
		}
		return { post, campaign, slugUsed };
	}

	function canManageBlogPost(user, postRow) {
		if (!postRow) return false;
		if (user?.role === "admin") return true;
		return Number(postRow.author_user_id) === Number(user.id);
	}

	async function enrichDbMergedPost(merged) {
		if (merged.author_user_id != null && queries.selectUserProfileByUserId?.get) {
			merged._profile = await queries.selectUserProfileByUserId.get(merged.author_user_id);
		}
		if (merged.author_user_id != null && queries.selectUserById?.get) {
			merged._authorUser = await queries.selectUserById.get(merged.author_user_id);
		}
		return merged;
	}

	async function loadPreviewDraftIfAuthorized(segments, req) {
		if (!isBlogPreviewQuery(req) || !queries?.selectBlogPostBySlugAny?.get) {
			return { kind: "skip" };
		}
		const parsed = parseBlogPathSegments(segments);
		let row = await queries.selectBlogPostBySlugAny.get(parsed.slug);
		if (!row && parsed.tryCampaignFallback && segments.length > 0) {
			row = await queries.selectBlogPostBySlugAny.get(segments.join("/"));
		}
		if (!row) return { kind: "none" };
		const uid = req.auth?.userId;
		if (!uid) return { kind: "unauthorized" };
		const user = await queries.selectUserById?.get(uid);
		if (!user || !canManageBlogPost(user, row)) {
			return { kind: "forbidden" };
		}
		const merged = rowToMergedPost(row);
		await enrichDbMergedPost(merged);
		return {
			kind: "ok",
			row,
			merged,
			campaign: parsed.campaign,
			slugUsed: row.slug || parsed.slug
		};
	}

	/**
	 * Replace {{BLOG_POST_LIST}} or <!-- BLOG_POST_LIST --> in index.md body with a markdown list
	 * of published posts (same merge order as elsewhere). Uses getBlogPostsCached for TTL alignment.
	 */
	async function injectBlogIndexPostList(body) {
		if (typeof body !== "string") return body;
		const hasCurly = /\{\{\s*BLOG_POST_LIST\s*\}\}/i.test(body);
		const hasComment = /<!--\s*BLOG_POST_LIST\s*-->/i.test(body);
		if (!hasCurly && !hasComment) return body;
		const posts = await getBlogPostsCached();
		const listMd = formatMergedPostsAsIndexMarkdown(posts);
		return body
			.replace(/\{\{\s*BLOG_POST_LIST\s*\}\}/gi, listMd)
			.replace(/<!--\s*BLOG_POST_LIST\s*-->/gi, listMd);
	}

	router.get("/blog", async (req, res) => {
		try {
			const fs = await import("fs/promises");

			const indexPath = path.join(blogDir, "index.md");
			let indexHtml = "";
			let indexTitle = "";
			let indexDescription = "";

			try {
				const { parseFrontmatter } = await import("../lib/blog/parseAndScan.js");
				const indexContent = await fs.readFile(indexPath, "utf-8");
				const { metadata, body } = parseFrontmatter(indexContent);
				const bodyWithPostList = await injectBlogIndexPostList(body);
				indexHtml = marked.parse(bodyWithPostList);
				indexTitle = metadata.title || indexTitle;
				indexDescription = metadata.description || indexDescription;
			} catch {
				const layoutHtml = generateBlogPageHtml({
					title: "",
					description: "",
					html: "",
					notFound: true
				});

				const templatePath = path.join(pagesDir, "blog.html");
				let pageHtml = await fs.readFile(templatePath, "utf-8");
				pageHtml = pageHtml.replace("<!--BLOG_LAYOUT-->", layoutHtml);

				const tokens = getPageTokens(req);
				tokens.PAGE_META_DESCRIPTION = "Blog page not found.";
				let htmlWithHead = injectCommonHead(pageHtml, tokens);

				const publicHeader = await getPublicHeaderHtml();
				htmlWithHead = htmlWithHead
					.replace("<!--APP_HEADER-->", publicHeader)
					.replace("<!--APP_MOBILE_BOTTOM_NAV-->", "");

				res.setHeader("Content-Type", "text/html");
				return res.status(404).send(htmlWithHead);
			}

			const layoutHtml = generateBlogPageHtml({
				title: indexTitle,
				description: indexDescription,
				html: indexHtml,
				notFound: false
			});

			const templatePath = path.join(pagesDir, "blog.html");
			let pageHtml = await fs.readFile(templatePath, "utf-8");
			pageHtml = pageHtml.replace("<!--BLOG_LAYOUT-->", layoutHtml);

			const tokens = getPageTokens(req);
			if (indexDescription) {
				tokens.PAGE_META_DESCRIPTION = indexDescription;
			}
			let htmlWithHead = injectCommonHead(pageHtml, tokens);

			const userId = req.auth?.userId;
			if (userId && queries) {
				const user = await queries.selectUserById?.get(userId);
				if (user) {
					const fsRole = await import("fs/promises");
					const rolePageName = getPageForUser(user);
					const rolePagePath = path.join(pagesDir, rolePageName);
					try {
						const roleHtml = await fsRole.readFile(rolePagePath, "utf-8");
						const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
						if (headerMatch) {
							const headerHtml = headerMatch[0];
							htmlWithHead = htmlWithHead.replace("<!--APP_HEADER-->", headerHtml);

							const includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
							htmlWithHead = htmlWithHead.replace(
								"<!--APP_MOBILE_BOTTOM_NAV-->",
								includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
							);
						}
					} catch {
						// fall back to public header
					}
				}
			}

			if (htmlWithHead.includes("<!--APP_HEADER-->")) {
				const publicHeader = await getPublicHeaderHtml();
				htmlWithHead = htmlWithHead
					.replace("<!--APP_HEADER-->", publicHeader)
					.replace("<!--APP_MOBILE_BOTTOM_NAV-->", "");
			}

			res.setHeader("Content-Type", "text/html");
			return res.send(htmlWithHead);
		} catch (error) {
			return res.status(500).send("Error loading blog");
		}
	});

	router.get("/blog/*", async (req, res) => {
		try {
			const fs = await import("fs/promises");
			const raw = req.path.replace(/^\/blog\/?/, "").replace(/\/$/, "") || "";
			const segments = raw ? raw.split("/").filter(Boolean) : [];
			let { post, campaign, slugUsed } = await resolvePublishedPostForBlogPath(segments);
			let postIsPreview = false;
			let previewBannerHtml = "";

			if (!post) {
				const pv = await loadPreviewDraftIfAuthorized(segments, req);
				if (pv.kind === "unauthorized") {
					res.setHeader("Content-Type", "text/html");
					return res
						.status(401)
						.send(
							blogPreviewAuthErrorHtml({
								title: "Sign in to preview",
								message: "Sign in with an account that can edit this post to see it here.",
								req,
								showSignIn: true
							})
						);
				}
				if (pv.kind === "forbidden") {
					res.setHeader("Content-Type", "text/html");
					return res
						.status(403)
						.send(
							blogPreviewAuthErrorHtml({
								title: "Preview not allowed",
								message: "You do not have permission to preview this post.",
								req,
								showSignIn: false
							})
						);
				}
				if (pv.kind === "ok") {
					post = pv.merged;
					campaign = pv.campaign;
					slugUsed = pv.slugUsed;
					postIsPreview = true;
					previewBannerHtml = previewBannerHtmlForDbRow(pv.row);
				}
			}

			const pageDescription = post?.description || (post ? `${post.title} — parascene blog post.` : "");

			const bylineHtml = post ? buildBlogBylineHtml(post) : "";
			const layoutHtml = generateBlogPageHtml({
				title: post ? post.title : "Post Not Found",
				description: pageDescription,
				html: post ? post.html : "",
				notFound: !post,
				bylineHtml,
				previewBannerHtml
			});

			const templatePath = path.join(pagesDir, "blog.html");
			let pageHtml = await fs.readFile(templatePath, "utf-8");
			pageHtml = pageHtml.replace("<!--BLOG_LAYOUT-->", layoutHtml);

			const tokens = getPageTokens(req);
			if (pageDescription) {
				tokens.PAGE_META_DESCRIPTION = pageDescription;
			}
			let htmlWithHead = injectCommonHead(pageHtml, tokens);

			if (postIsPreview) {
				htmlWithHead = htmlWithHead.replace(
					/<head>/i,
					"<head>\n\t\t<meta name=\"robots\" content=\"noindex,nofollow\" />"
				);
			}

			const userId = req.auth?.userId;
			if (userId && queries) {
				const user = await queries.selectUserById?.get(userId);
				if (user) {
					const fsRole = await import("fs/promises");
					const rolePageName = getPageForUser(user);
					const rolePagePath = path.join(pagesDir, rolePageName);
					try {
						const roleHtml = await fsRole.readFile(rolePagePath, "utf-8");
						const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
						if (headerMatch) {
							const headerHtml = headerMatch[0];
							htmlWithHead = htmlWithHead.replace("<!--APP_HEADER-->", headerHtml);

							const includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
							htmlWithHead = htmlWithHead.replace(
								"<!--APP_MOBILE_BOTTOM_NAV-->",
								includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
							);
						}
					} catch {
						// fall back to public header
					}
				}
			}

			if (htmlWithHead.includes("<!--APP_HEADER-->")) {
				const publicHeader = await getPublicHeaderHtml();
				htmlWithHead = htmlWithHead
					.replace("<!--APP_HEADER-->", publicHeader)
					.replace("<!--APP_MOBILE_BOTTOM_NAV-->", "");
			}

			if (post) {
				if (!postIsPreview) {
					tryLogBlogPostView(req, queries, { post, campaign, slugUsed });
				}
				if (!postIsPreview && campaign != null && post.slug) {
					const canUrl = canonicalBlogUrlForSlug(post.slug);
					htmlWithHead = htmlWithHead.replace(/<link rel="canonical" href="[^"]*"\s*\/>/i, getCanonicalLinkHtml(canUrl));
					const ogEsc = canUrl
						.replace(/&/g, "&amp;")
						.replace(/"/g, "&quot;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;");
					htmlWithHead = htmlWithHead.replace(
						/<meta property="og:url" content="[^"]*"\s*\/>/i,
						`<meta property="og:url" content="${ogEsc}" />`
					);
				}
			}

			res.setHeader("Content-Type", "text/html");
			return res.status(post ? 200 : 404).send(htmlWithHead);
		} catch (error) {
			return res.status(500).send("Error loading blog post");
		}
	});

	return router;
}
