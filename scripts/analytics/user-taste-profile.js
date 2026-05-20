#!/usr/bin/env node

/*
this is WIP and not quite there; just trying to pull together some comcept of what users like
*/

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";

loadEnv();

const SAMPLE_LIMIT = 20;
const OUTPUT_DIR = path.join(REPO_ROOT, ".output", "tastes");
const WRITE_INDIVIDUAL_USER_PAGES = true;

function runFolderName(date) {
	return date.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
}

function renderTasteProfilesHtml(report, options = {}) {
	const profiles = Array.isArray(report?.profiles) ? report.profiles : [];
	const title = options.title || "User Taste Profiles";
	const subtitle = options.subtitle || `${profiles.length} users, sorted by interaction volume`;
	const escapeHtml = (value) => String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
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
		if (!Array.isArray(items) || items.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;
		return `<ul class="signal-list">${items.map(renderItem).join("")}</ul>`;
	};
	const backToIndex = options.singleUser
		? '<p class="nav-link"><a href="index.html">&lt;- Back to all users</a></p>'
		: "";

	const leaderboard = profiles.map((p, index) => {
		const m = p.interaction_metric || {};
		const href = options.singleUser ? "" : ` href="${escapeHtml(fileNameForUser(p))}"`;
		return `<tr>
			<td class="rank">${index + 1}</td>
			<td><a${href}>${escapeHtml(userName(p))}</a><span class="muted"> #${escapeHtml(p.user?.id)}</span></td>
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
		const about = profile.about ? `<p class="about">${escapeHtml(profile.about)}</p>` : "";
		const creations = p.own_creations?.samples || [];
		const likes = p.engagement?.likes_given?.samples || [];
		const comments = p.engagement?.comments_given?.samples || [];
		const topCreators = p.engagement?.likes_given?.top_creators_by_recent_likes || [];

		return `<section class="user-card" id="user-${escapeHtml(p.user?.id)}">
			<header class="user-head">
				<div>
					<h2>${escapeHtml(userName(p))}</h2>
					<p class="muted">
						${profile.user_name ? `@${escapeHtml(profile.user_name)} - ` : ""}
						user ${escapeHtml(p.user?.id)} - ${escapeHtml(p.user?.email || "")}
					</p>
				</div>
				<div class="score">
					<strong>${number(m.total_interactions)}</strong>
					<span>interactions</span>
				</div>
			</header>
			${about}
			<div class="metric-grid">
				<div><strong>${number(m.creations)}</strong><span>creations</span></div>
				<div><strong>${number(m.published_creations)}</strong><span>published</span></div>
				<div><strong>${number(m.likes_given)}</strong><span>likes given</span></div>
				<div><strong>${number(m.comments_given)}</strong><span>comments</span></div>
				<div><strong>${number(m.follows_started)}</strong><span>follows</span></div>
				<div><strong>${number(m.chat_messages_sent)}</strong><span>chat msgs</span></div>
			</div>
			<div class="taste-grid">
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
						<span class="muted">creator ${escapeHtml(r.creator_user_id)}</span>
						${compactMeta(r.meta)}
					</li>`)}
				</div>
				<div>
					<h3>What they say</h3>
					${itemList(comments, "No recent comments.", (r) => `<li>
						<p>${escapeHtml(r.text || "")}</p>
						<span class="muted">on creation ${escapeHtml(r.created_image_id)}</span>
					</li>`)}
				</div>
				<div>
					<h3>Creators they return to</h3>
					${itemList(topCreators, "No repeated creator likes in the sample.", (r) => `<li>
						<strong>Creator ${escapeHtml(r.creator_id)}</strong>
						<span class="muted">${number(r.like_count)} sampled likes</span>
						${Array.isArray(r.sample_titles) && r.sample_titles.length
				? `<p>${escapeHtml(r.sample_titles.join(", "))}</p>`
				: ""}
					</li>`)}
				</div>
			</div>
		</section>`;
	}).join("");

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		:root { color-scheme: dark; --bg: #101018; --panel: #181524; --muted: #aaa3ba; --text: #f5f0ff; --border: #342c47; --accent: #9f7aea; }
		* { box-sizing: border-box; }
		body { margin: 0; padding: 32px; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; }
		main { max-width: 1180px; margin: 0 auto; }
		h1, h2, h3, p { margin-top: 0; }
		h1 { margin-bottom: 6px; font-size: clamp(2rem, 4vw, 3.4rem); letter-spacing: -0.04em; }
		h2 { margin-bottom: 4px; font-size: 1.35rem; }
		h3 { margin-bottom: 10px; color: #d8ceef; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; }
		a { color: inherit; text-decoration-color: var(--accent); text-underline-offset: 3px; }
		table { width: 100%; border-collapse: collapse; margin: 20px 0 28px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
		th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; }
		th { color: var(--muted); font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
		tr:last-child td { border-bottom: 0; }
		pre { overflow: auto; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: #0d0b14; color: #ddd4f7; font-size: 0.78rem; }
		summary { cursor: pointer; color: var(--muted); font-size: 0.82rem; }
		.report-head { margin-bottom: 24px; }
		.nav-link { margin-bottom: 18px; }
		.muted, .empty { color: var(--muted); }
		.rank { width: 52px; color: var(--muted); }
		.user-card { margin: 22px 0; padding: 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
		.user-head { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
		.score { min-width: 128px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; text-align: right; background: #120f1d; }
		.score strong { display: block; font-size: 1.8rem; line-height: 1; }
		.score span { color: var(--muted); font-size: 0.8rem; }
		.about { max-width: 72ch; color: #ddd7eb; }
		.metric-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 18px; }
		.metric-grid div { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: #120f1d; }
		.metric-grid strong { display: block; font-size: 1.12rem; }
		.metric-grid span { color: var(--muted); font-size: 0.78rem; }
		.taste-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
		.signal-list { margin: 0; padding: 0; list-style: none; }
		.signal-list li { padding: 10px 0; border-top: 1px solid var(--border); }
		.signal-list li:first-child { border-top: 0; }
		.signal-list p { margin: 5px 0 0; color: #ddd7eb; }
		.pill { display: inline-flex; margin-left: 8px; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 0.72rem; vertical-align: middle; }
		@media (max-width: 900px) { body { padding: 18px; } .metric-grid, .taste-grid { grid-template-columns: 1fr; } .user-head { display: block; } .score { margin-top: 12px; text-align: left; } table { display: block; overflow-x: auto; } }
	</style>
</head>
<body>
	<main>
		<header class="report-head">
			<h1>${escapeHtml(title)}</h1>
			<p class="muted">${escapeHtml(subtitle)} - generated ${escapeHtml(report?.generated_at || "")}</p>
		</header>
		${backToIndex}
		${profiles.length > 0 && !options.singleUser ? `<section>
			<h3>Users by engagement</h3>
			<table>
				<thead><tr><th>#</th><th>User</th><th>Total</th><th>Makes</th><th>Published</th><th>Likes</th><th>Comments</th><th>Follows</th><th>Chat</th></tr></thead>
				<tbody>${leaderboard}</tbody>
			</table>
		</section>` : ""}
		${options.singleUser ? (cards || '<p class="empty">No eligible users found.</p>') : ""}
		${!options.singleUser && profiles.length === 0 ? '<p class="empty">No eligible users found.</p>' : ""}
	</main>
</body>
</html>`;
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

	const indexHtml = renderTasteProfilesHtml(output, {
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
			const html = renderTasteProfilesHtml(
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

