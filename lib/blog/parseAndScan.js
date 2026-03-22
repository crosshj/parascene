/**
 * Shared blog markdown parsing and filesystem scan (used by api_routes/blog.js and migration scripts).
 */
import path from "path";

export function parseFrontmatter(content) {
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

export function stripSegmentPrefix(segment) {
	return segment.replace(/^\d+-/, "");
}

export function stripPathPrefix(pathStr) {
	const normalized = pathStr.replace(/\\/g, "/");
	return normalized.split("/").map(stripSegmentPrefix).join("/");
}

/**
 * @param {string} dir
 * @param {string} baseDir
 * @returns {Promise<Array<{ slug: string, title: string, description: string, date: string, content: string }>>}
 */
export async function scanBlogDirectory(dir, baseDir) {
	const fs = await import("fs/promises");
	let entries;

	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
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
			const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
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
				author: metadata.author || "",
				content: body
			});
		}
	}

	return posts;
}

export function sortBlogPosts(posts) {
	const list = Array.isArray(posts) ? [...posts] : [];
	list.sort((a, b) => {
		if (a.date && b.date && a.date !== b.date) {
			return String(b.date).localeCompare(String(a.date));
		}
		return String(a.title || "").localeCompare(String(b.title || ""));
	});
	return list;
}
