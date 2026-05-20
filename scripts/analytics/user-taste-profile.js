#!/usr/bin/env node

/*
this is WIP and not quite there; just trying to pull together some comcept of what users like

HTML: user-taste-profile.html · CSS: report.css ({{!styleBlock}})
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { loadReportStyleBlock } from "./report-styles.js";

loadEnv();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) =>
	String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const USER_TASTE_PROFILE_HTML_TEMPLATE = path.join(SCRIPT_DIR, "user-taste-profile.html");

let userTasteProfileHtmlTemplateCache = null;

/** {{name}} = escaped; {{!name}} = raw HTML */
function fillHtmlTemplate(template, values) {
	return template.replace(/\{\{(!?)([a-zA-Z0-9_]+)\}\}/g, (_, raw, key) => {
		if (!(key in values)) return "";
		const v = values[key];
		return raw === "!" ? String(v ?? "") : esc(v);
	});
}

async function loadUserTasteProfileHtmlTemplate() {
	if (!userTasteProfileHtmlTemplateCache) {
		userTasteProfileHtmlTemplateCache = await fs.promises.readFile(USER_TASTE_PROFILE_HTML_TEMPLATE, "utf8");
	}
	return userTasteProfileHtmlTemplateCache;
}

const SAMPLE_LIMIT = 20;
const OUTPUT_DIR = path.join(REPO_ROOT, ".output", "tastes");
const WRITE_INDIVIDUAL_USER_PAGES = true;

function runFolderName(date) {
	return date.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
}

async function renderTasteProfilesHtml(report, options = {}) {
	const profiles = Array.isArray(report?.profiles) ? report.profiles : [];
	const title = options.title || "User Taste Profiles";
	const subtitle = options.subtitle || `${profiles.length} users, sorted by interaction volume`;
	const escapeHtml = esc;
	const userName = (p) => (
		p?.user?.profile?.display_name ||
		(p?.user?.profile?.user_name ? `@${p.user.profile.user_name}` : "") ||
		p?.user?.email ||
		`User ${p?.user?.id ?? "unknown"}`
	);
	const fileNameForUser = (p) => {
		const raw = p?.user?.profile?.user_name || p?.user?.email || `user-${p?.user?.id ?? "unknown"}`;
		return `${String(raw).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "user"}.html`;
	};
	const number = (value) => Number(value || 0).toLocaleString();
	const compactMeta = (meta) => {
		if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) return "";
		const json = JSON.stringify(meta, null, 2);
		if (!json || json === "{}") return "";
		return `<details><summary>metadata</summary><pre>${escapeHtml(json)}</pre></details>`;
	};
	const itemList = (items, empty, renderItem) => {
		if (!Array.isArray(items) || items.length === 0) return `<p class="small">${escapeHtml(empty)}</p>`;
		return `<ul class="list-plain">${items.map(renderItem).join("")}</ul>`;
	};
	const navLinkHtml = options.singleUser
		? '<p class="back"><a href="index.html">&lt;- Back to all users</a></p>'
		: "";

	const leaderboard = profiles.map((p, index) => {
		const m = p.interaction_metric || {};
		const href = options.singleUser ? "" : ` href="${escapeHtml(fileNameForUser(p))}"`;
		return `<tr>
			<td class="col-rank">${index + 1}</td>
			<td><a${href}>${escapeHtml(userName(p))}</a><span class="small"> #${escapeHtml(p.user?.id)}</span></td>
			<td>${number(m.total_interactions)}</td>
			<td>${number(m.creations)}</td>
			<td>${number(m.published_creations)}</td>
			<td>${number(m.likes_given)}</td>
			<td>${number(m.comments_given)}</td>
			<td>${number(m.follows_started)}</td>
			<td>${number(m.chat_messages_sent)}</td>
		</tr>`;
	}).join("");

	const cards = profiles.map((p) => {
		const m = p.interaction_metric || {};
		const profile = p.user?.profile || {};
		const about = profile.about ? `<p class="lede">${escapeHtml(profile.about)}</p>` : "";
		const creations = p.own_creations?.samples || [];
		const likes = p.engagement?.likes_given?.samples || [];
		const comments = p.engagement?.comments_given?.samples || [];
		const topCreators = p.engagement?.likes_given?.top_creators_by_recent_likes || [];

		return `<section class="card card-lg" id="user-${escapeHtml(p.user?.id)}">
			<header class="card-head">
				<div>
					<h2>${escapeHtml(userName(p))}</h2>
					<p class="small">
						${profile.user_name ? `@${escapeHtml(profile.user_name)} - ` : ""}
						user ${escapeHtml(p.user?.id)} - ${escapeHtml(p.user?.email || "")}
					</p>
				</div>
				<div class="stat-box">
					<strong>${number(m.total_interactions)}</strong>
					<span>interactions</span>
				</div>
			</header>
			${about}
			<div class="grid cols-6">
				<div><strong>${number(m.creations)}</strong><span>creations</span></div>
				<div><strong>${number(m.published_creations)}</strong><span>published</span></div>
				<div><strong>${number(m.likes_given)}</strong><span>likes given</span></div>
				<div><strong>${number(m.comments_given)}</strong><span>comments</span></div>
				<div><strong>${number(m.follows_started)}</strong><span>follows</span></div>
				<div><strong>${number(m.chat_messages_sent)}</strong><span>chat msgs</span></div>
			</div>
			<div class="grid-2">
				<div>
					<h3>What they make</h3>
					${itemList(creations, "No recent creations.", (r) => `<li>
						<strong>${escapeHtml(r.title || "Untitled creation")}</strong>
						${r.published ? '<span class="pill">published</span>' : ""}
						${r.description ? `<p>${escapeHtml(r.description)}</p>` : ""}
						${compactMeta(r.meta)}
					</li>`)}
				</div>
				<div>
					<h3>What they like</h3>
					${itemList(likes, "No recent likes.", (r) => `<li>
						<strong>${escapeHtml(r.title || "Untitled creation")}</strong>
						<span class="small">creator ${escapeHtml(r.creator_user_id)}</span>
						${compactMeta(r.meta)}
					</li>`)}
				</div>
				<div>
					<h3>What they say</h3>
					${itemList(comments, "No recent comments.", (r) => `<li>
						<p>${escapeHtml(r.text || "")}</p>
						<span class="small">on creation ${escapeHtml(r.created_image_id)}</span>
					</li>`)}
				</div>
				<div>
					<h3>Creators they return to</h3>
					${itemList(topCreators, "No repeated creator likes in the sample.", (r) => `<li>
						<strong>Creator ${escapeHtml(r.creator_id)}</strong>
						<span class="small">${number(r.like_count)} sampled likes</span>
						${Array.isArray(r.sample_titles) && r.sample_titles.length
				? `<p>${escapeHtml(r.sample_titles.join(", "))}</p>`
				: ""}
					</li>`)}
				</div>
			</div>
		</section>`;
	}).join("");

	const leaderboardSectionHtml =
		profiles.length > 0 && !options.singleUser
			? `<section>
			<h3>Users by engagement</h3>
			<table>
				<thead><tr><th>#</th><th>User</th><th>Total</th><th>Makes</th><th>Published</th><th>Likes</th><th>Comments</th><th>Follows</th><th>Chat</th></tr></thead>
				<tbody>${leaderboard}</tbody>
			</table>
		</section>`
			: "";

	let bodyContentHtml = "";
	if (options.singleUser) {
		bodyContentHtml = cards || '<p class="small">No eligible users found.</p>';
	} else if (profiles.length === 0) {
		bodyContentHtml = '<p class="small">No eligible users found.</p>';
	}

	const template = await loadUserTasteProfileHtmlTemplate();
	const styleBlock = await loadReportStyleBlock();
	return fillHtmlTemplate(template, {
		styleBlock,
		title,
		subtitle,
		generatedAt: report?.generated_at || "",
		navLinkHtml,
		leaderboardSectionHtml,
		bodyContentHtml
	});
}

async function main() {
	const generatedAt = new Date();
	const supabaseUrl = process.env.SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl) throw new Error("Missing required env var SUPABASE_URL");
	if (!serviceRoleKey) throw new Error("Missing required env var SUPABASE_SERVICE_ROLE_KEY");

	const client = createClient(supabaseUrl, serviceRoleKey);
	const { data: userRows, error: usersErr } = await client
		.from("prsn_users")
		.select("id,email,role,created_at,meta")
		.eq("role", "consumer")
		.order("id", { ascending: true });
	if (usersErr) throw usersErr;

	const users = (Array.isArray(userRows) ? userRows : []).filter((u) => {
		const meta = u.meta && typeof u.meta === "object" ? u.meta : {};
		return meta.suspended !== true;
	});

	const tasteProfiles = [];

	for (const user of users) {
		const userId = user.id;
		const [
			{ data: profile, error: profileErr },
			{ data: creationRows, error: creationsErr },
			{ data: likeRows, error: likesErr },
			{ data: commentRows, error: commentsErr },
			{ data: followingRows, error: followingErr },
			{ data: followerRows, error: followerErr },
			{ count: creationCount, error: creationCountErr },
			{ count: publishedCreationCount, error: publishedCreationCountErr },
			{ count: likeCount, error: likeCountErr },
			{ count: commentCount, error: commentCountErr },
			{ count: followingCount, error: followingCountErr },
			{ count: chatMessageCount, error: chatMessageCountErr }
		] = await Promise.all([
			client
				.from("prsn_user_profiles")
				.select("user_name,display_name,about,meta")
				.eq("user_id", userId)
				.maybeSingle(),
			client
				.from("prsn_created_images")
				.select("id,title,description,meta,published,published_at,created_at")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(SAMPLE_LIMIT),
			client
				.from("prsn_likes_created_image")
				.select("created_image_id,created_at,prsn_created_images!inner(id,user_id,title,meta)")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(SAMPLE_LIMIT),
			client
				.from("prsn_comments_created_image")
				.select("created_image_id,text,created_at")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(SAMPLE_LIMIT),
			client
				.from("prsn_user_follows")
				.select("following_id,created_at")
				.eq("follower_id", userId),
			client
				.from("prsn_user_follows")
				.select("follower_id,created_at")
				.eq("following_id", userId),
			client
				.from("prsn_created_images")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId),
			client
				.from("prsn_created_images")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId)
				.eq("published", true),
			client
				.from("prsn_likes_created_image")
				.select("created_image_id", { count: "exact", head: true })
				.eq("user_id", userId),
			client
				.from("prsn_comments_created_image")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId),
			client
				.from("prsn_user_follows")
				.select("following_id", { count: "exact", head: true })
				.eq("follower_id", userId),
			client
				.from("prsn_chat_messages")
				.select("id", { count: "exact", head: true })
				.eq("sender_id", userId)
		]);

		for (const err of [
			profileErr,
			creationsErr,
			likesErr,
			commentsErr,
			followingErr,
			followerErr,
			creationCountErr,
			publishedCreationCountErr,
			likeCountErr,
			commentCountErr,
			followingCountErr,
			chatMessageCountErr
		]) {
			if (err) throw err;
		}

		const creations = Array.isArray(creationRows) ? creationRows : [];
		const likes = Array.isArray(likeRows) ? likeRows : [];
		const comments = Array.isArray(commentRows) ? commentRows : [];
		const byCreator = new Map();

		const likedSamples = [];
		for (const row of likes) {
			const img = row.prsn_created_images;
			if (!img) continue;
			const creatorId = img.user_id;
			if (creatorId != null) {
				const stats = byCreator.get(creatorId) || { creator_id: creatorId, like_count: 0, sample_titles: [] };
				stats.like_count += 1;
				if (stats.sample_titles.length < 5 && img.title) stats.sample_titles.push(img.title);
				byCreator.set(creatorId, stats);
			}
			likedSamples.push({
				created_image_id: img.id,
				creator_user_id: img.user_id,
				title: img.title ?? null,
				meta: img.meta && typeof img.meta === "object" ? img.meta : {},
				liked_at: row.created_at
			});
		}

		const totalInteractions =
			(creationCount || 0) +
			(likeCount || 0) +
			(commentCount || 0) +
			(followingCount || 0) +
			(chatMessageCount || 0);

		tasteProfiles.push({
			generated_at: generatedAt.toISOString(),
			interaction_metric: {
				total_interactions: totalInteractions,
				creations: creationCount || 0,
				published_creations: publishedCreationCount || 0,
				likes_given: likeCount || 0,
				comments_given: commentCount || 0,
				follows_started: followingCount || 0,
				chat_messages_sent: chatMessageCount || 0
			},
			user: {
				id: user.id,
				email: user.email,
				role: user.role,
				created_at: user.created_at,
				meta: user.meta && typeof user.meta === "object" ? user.meta : {},
				profile: profile
					? {
						user_name: profile.user_name,
						display_name: profile.display_name,
						about: profile.about,
						meta: profile.meta && typeof profile.meta === "object" ? profile.meta : {}
					}
					: null
			},
			own_creations: {
				total_recent: creations.length,
				total_published_recent: creations.filter((r) => r.published === true).length,
				samples: creations.map((r) => ({
					id: r.id,
					title: r.title ?? null,
					description: r.description ?? null,
					published: !!r.published,
					published_at: r.published_at,
					created_at: r.created_at,
					meta: r.meta && typeof r.meta === "object" ? r.meta : {}
				}))
			},
			engagement: {
				likes_given: {
					total_recent_likes: likes.length,
					top_creators_by_recent_likes: [...byCreator.values()]
						.sort((a, b) => b.like_count - a.like_count)
						.slice(0, 10),
					samples: likedSamples
				},
				comments_given: {
					total_recent_comments: comments.length,
					samples: comments.map((r) => ({
						created_image_id: r.created_image_id,
						text: r.text,
						created_at: r.created_at
					}))
				},
				follows: {
					following_count: Array.isArray(followingRows) ? followingRows.length : 0,
					follower_count: Array.isArray(followerRows) ? followerRows.length : 0
				}
			}
		});
	}

	tasteProfiles.sort((a, b) => b.interaction_metric.total_interactions - a.interaction_metric.total_interactions);

	const output = {
		generated_at: generatedAt.toISOString(),
		eligible_user_count: users.length,
		profiles: tasteProfiles
	};

	const compactSnapshot = {
		generated_at: output.generated_at,
		eligible_user_count: output.eligible_user_count,
		users: tasteProfiles.map((profile) => ({
			user_id: profile.user.id,
			email: profile.user.email,
			user_name: profile.user.profile?.user_name || null,
			display_name: profile.user.profile?.display_name || null,
			created_at: profile.user.created_at,
			interaction_metric: profile.interaction_metric
		}))
	};

	const outDir = path.join(OUTPUT_DIR, runFolderName(generatedAt));
	fs.mkdirSync(outDir, { recursive: true });

	const indexHtml = await renderTasteProfilesHtml(output, {
		title: "Parascene User Tastes",
		subtitle: `${output.eligible_user_count} consumer users, excluding suspended users`
	});
	const indexPath = path.join(outDir, "index.html");
	fs.writeFileSync(indexPath, indexHtml, "utf8");
	fs.writeFileSync(path.join(outDir, "interactions.json"), JSON.stringify(compactSnapshot), "utf8");

	if (WRITE_INDIVIDUAL_USER_PAGES) {
		for (const profile of tasteProfiles) {
			const raw = profile?.user?.profile?.user_name || profile?.user?.email || `user-${profile?.user?.id ?? "unknown"}`;
			const fileName = `${String(raw).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "user"}.html`;
			const html = await renderTasteProfilesHtml(
				{ ...output, profiles: [profile] },
				{
					title: profile?.user?.profile?.display_name || profile?.user?.profile?.user_name || `User ${profile?.user?.id}`,
					subtitle: "Individual taste profile",
					singleUser: true
				}
			);
			fs.writeFileSync(path.join(outDir, fileName), html, "utf8");
		}
	}

	console.error(`Wrote taste report to ${indexPath}`);
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});

