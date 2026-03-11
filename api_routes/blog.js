import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";
import { injectCommonHead, getPageTokens } from "./utils/head.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure marked for safe rendering (match help page behavior)
marked.setOptions({
	gfm: true,
	breaks: false,
	headerIds: true,
	mangle: false
});

function parseFrontmatter(content) {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (match) {
		const frontmatterText = match[1];
		const body = match[2];
		const metadata = {};

		for (const line of frontmatterText.split("\n")) {
			const colonIndex = line.indexOf(":");
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim();
				let value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
				if (value === "true") {
					value = true;
				} else if (value === "false") {
					value = false;
				}
				metadata[key] = value;
			}
		}

		return { metadata, body };
	}

	return { metadata: {}, body: content };
}

function stripSegmentPrefix(segment) {
	return segment.replace(/^\d+-/, "");
}

function stripPathPrefix(pathStr) {
	const normalized = pathStr.replace(/\\/g, "/");
	return normalized.split("/").map(stripSegmentPrefix).join("/");
}

async function scanBlogDirectory(dir, baseDir) {
	const fs = await import("fs/promises");
	let entries;

	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		// Directory does not exist yet – no posts
		return [];
	}

	const posts = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory() && !entry.name.startsWith("_")) {
			const subPosts = await scanBlogDirectory(fullPath, baseDir);
			posts.push(...subPosts);
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.startsWith("_") &&
			entry.name.toLowerCase() !== "index.md"
		) {
			const relativePath = path
				.relative(baseDir, fullPath)
				.replace(/\\/g, "/");
			const slug = stripPathPrefix(relativePath).replace(/\.md$/, "");
			const content = await fs.readFile(fullPath, "utf-8");
			const { metadata, body } = parseFrontmatter(content);

			const nameWithoutExt = entry.name.replace(/\.md$/i, "");
			const nameForTitle = stripSegmentPrefix(nameWithoutExt);
			const titleFromFilename = nameForTitle
				.replace(/-/g, " ")
				.replace(/\b\w/g, (l) => l.toUpperCase());

			posts.push({
				slug,
				title: metadata.title || titleFromFilename,
				description: metadata.description || "",
				date: metadata.date || "",
				content: body,
				html: marked.parse(body)
			});
		}
	}

	return posts;
}

async function getBlogPosts(blogDir) {
	const posts = await scanBlogDirectory(blogDir, blogDir);

	posts.sort((a, b) => {
		// Sort by date desc when available, else by title
		if (a.date && b.date && a.date !== b.date) {
			return String(b.date).localeCompare(String(a.date));
		}
		return a.title.localeCompare(b.title);
	});

	return posts;
}

function escapeHtml(text) {
	return String(text || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function generateBlogPageHtml({ title, description, html, notFound = false }) {
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
				${hasTitle ? `<h1>${safeTitle}</h1>` : ""}
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
		postsCache = await getBlogPosts(blogDir);
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

	router.get("/blog", async (req, res) => {
		try {
			const fs = await import("fs/promises");

			const indexPath = path.join(blogDir, "index.md");
			let indexHtml = "";
			let indexTitle = "";
			let indexDescription = "";

			try {
				const indexContent = await fs.readFile(indexPath, "utf-8");
				const { metadata, body } = parseFrontmatter(indexContent);
				indexHtml = marked.parse(body);
				indexTitle = metadata.title || indexTitle;
				indexDescription = metadata.description || indexDescription;
			} catch {
				// No index.md – treat as not found using generic not-found layout
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
			// console.error("Error rendering blog index:", error);
			return res.status(500).send("Error loading blog");
		}
	});

	router.get("/blog/*", async (req, res) => {
		try {
			const fs = await import("fs/promises");

			let slug = req.path.replace(/^\/blog\/?/, "").replace(/\/$/, "") || "";
			const posts = await getBlogPostsCached();
			const post = posts.find((p) => p.slug === slug);

			const pageDescription = post?.description || (post ? `${post.title} — parascene blog post.` : "");

			const layoutHtml = generateBlogPageHtml({
				title: post ? post.title : "Post Not Found",
				description: pageDescription,
				html: post ? post.html : "",
				notFound: !post
			});

			const templatePath = path.join(pagesDir, "blog.html");
			let pageHtml = await fs.readFile(templatePath, "utf-8");
			pageHtml = pageHtml.replace("<!--BLOG_LAYOUT-->", layoutHtml);

			const tokens = getPageTokens(req);
			if (pageDescription) {
				tokens.PAGE_META_DESCRIPTION = pageDescription;
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
			return res.status(post ? 200 : 404).send(htmlWithHead);
		} catch (error) {
			// console.error("Error rendering blog post:", error);
			return res.status(500).send("Error loading blog post");
		}
	});

	return router;
}

