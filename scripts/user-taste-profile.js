#!/usr/bin/env node

/*
this is WIP and not quite there; just trying to pull together some comcept of what users like
*/

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

function printUsage() {
	console.log(
		[
			"Build a compact taste profile for a user for LLM context.",
			"",
			"Usage:",
			"  node scripts/user-taste-profile.js (--user-id <id> | --user-name <name>) [--limit 20] [--json] [--output-dir .output/taste_profiles]",
			"",
			"Options:",
			"  --user-id <id>      Numeric user id",
			"  --user-name <name>  Username from prsn_user_profiles.user_name",
			"  --limit <n>         Max sample items per section (default: 20)",
			"  --json              Pretty-print JSON to stdout",
			"  --output-dir <dir>  Also write JS module file to directory (default .output/taste_profiles when set without value)",
			"  --help              Show this help"
		].join("\n")
	);
}

function parseArgs(argv) {
	const opts = {
		userId: null,
		userName: null,
		limit: 20,
		json: false,
		outputDir: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			opts.help = true;
			continue;
		}
		if (arg === "--json") {
			opts.json = true;
			continue;
		}
		if (arg === "--user-id") {
			const next = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(next) || next < 1) {
				throw new Error("Invalid --user-id value");
			}
			opts.userId = next;
			i++;
			continue;
		}
		if (arg === "--user-name") {
			const next = argv[i + 1];
			if (typeof next !== "string" || !next.trim()) {
				throw new Error("Invalid --user-name value");
			}
			opts.userName = next.trim();
			i++;
			continue;
		}
		if (arg === "--output-dir") {
			const next = argv[i + 1];
			if (!next || next.startsWith("--")) {
				// Use default when flag is present without value
				opts.outputDir = ".output/taste_profiles";
				continue;
			}
			opts.outputDir = next;
			i++;
			continue;
		}
		if (arg === "--limit") {
			const next = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(next) || next < 1) {
				throw new Error("Invalid --limit value");
			}
			opts.limit = next;
			i++;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return opts;
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

function normalizeMeta(meta) {
	if (!meta || typeof meta !== "object") return {};
	return meta;
}

async function openServiceClient() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	return createClient(supabaseUrl, serviceRoleKey);
}

async function lookupUserIdByUserName(client, userName) {
	const { data, error } = await client
		.from("prsn_user_profiles")
		.select("user_id")
		.eq("user_name", userName)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return data.user_id ?? null;
}

async function loadUserBasics(client, userId) {
	const { data, error } = await client
		.from("prsn_users")
		.select("id,email,role,created_at,meta")
		.eq("id", userId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		id: data.id,
		email: data.email,
		role: data.role,
		created_at: data.created_at,
		meta: normalizeMeta(data.meta)
	};
}

async function loadUserProfile(client, userId) {
	const { data, error } = await client
		.from("prsn_user_profiles")
		.select("user_name,display_name,about,meta")
		.eq("user_id", userId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		user_name: data.user_name,
		display_name: data.display_name,
		about: data.about,
		meta: normalizeMeta(data.meta)
	};
}

async function loadOwnCreations(client, userId, limit) {
	const { data, error } = await client
		.from("prsn_created_images")
		.select("id,title,description,meta,published,published_at,created_at")
		.eq("user_id", userId)
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw error;
	const rows = Array.isArray(data) ? data : [];
	const published = rows.filter((r) => r.published === true);
	return {
		total_recent: rows.length,
		total_published_recent: published.length,
		samples: rows.map((r) => ({
			id: r.id,
			title: r.title ?? null,
			description: r.description ?? null,
			published: !!r.published,
			published_at: r.published_at,
			created_at: r.created_at,
			meta: normalizeMeta(r.meta)
		}))
	};
}

async function loadLikesGiven(client, userId, limit) {
	const { data, error } = await client
		.from("prsn_likes_created_image")
		.select("created_image_id,created_at,prsn_created_images!inner(id,user_id,title,meta)")
		.eq("user_id", userId)
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw error;
	const rows = Array.isArray(data) ? data : [];
	const byCreator = new Map();
	const samples = [];
	for (const row of rows) {
		const img = row["prsn_created_images"];
		if (!img) continue;
		const creatorId = img.user_id;
		if (creatorId != null) {
			const stats = byCreator.get(creatorId) || { creator_id: creatorId, like_count: 0, sample_titles: [] };
			stats.like_count += 1;
			if (stats.sample_titles.length < 5 && img.title) stats.sample_titles.push(img.title);
			byCreator.set(creatorId, stats);
		}
		samples.push({
			created_image_id: img.id,
			creator_user_id: img.user_id,
			title: img.title ?? null,
			meta: normalizeMeta(img.meta),
			liked_at: row.created_at
		});
	}
	const topCreators = [...byCreator.values()].sort((a, b) => b.like_count - a.like_count).slice(0, 10);
	return {
		total_recent_likes: rows.length,
		top_creators_by_likes: topCreators,
		samples
	};
}

async function loadCommentsGiven(client, userId, limit) {
	const { data, error } = await client
		.from("prsn_comments_created_image")
		.select("created_image_id,text,created_at")
		.eq("user_id", userId)
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw error;
	const rows = Array.isArray(data) ? data : [];
	return {
		total_recent_comments: rows.length,
		samples: rows.map((r) => ({
			created_image_id: r.created_image_id,
			text: r.text,
			created_at: r.created_at
		}))
	};
}

async function loadFollows(client, userId) {
	const { data: followingRows, error: followingErr } = await client
		.from("prsn_user_follows")
		.select("following_id,created_at")
		.eq("follower_id", userId);
	if (followingErr) throw followingErr;
	const { data: followerRows, error: followerErr } = await client
		.from("prsn_user_follows")
		.select("follower_id,created_at")
		.eq("following_id", userId);
	if (followerErr) throw followerErr;
	return {
		following_count: Array.isArray(followingRows) ? followingRows.length : 0,
		follower_count: Array.isArray(followerRows) ? followerRows.length : 0
	};
}

async function buildTasteProfile(client, userId, limit) {
	const [user, profile, own, likes, comments, follows] = await Promise.all([
		loadUserBasics(client, userId),
		loadUserProfile(client, userId),
		loadOwnCreations(client, userId, limit),
		loadLikesGiven(client, userId, limit),
		loadCommentsGiven(client, userId, limit),
		loadFollows(client, userId)
	]);

	if (!user) {
		throw new Error(`User ${userId} not found`);
	}

	return {
		generated_at: new Date().toISOString(),
		user: {
			id: user.id,
			email: user.email,
			role: user.role,
			created_at: user.created_at,
			meta: user.meta,
			profile
		},
		own_creations: own,
		engagement: {
			likes_given: likes,
			comments_given: comments,
			follows
		}
	};
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const client = await openServiceClient();
	let userId = opts.userId;
	if (!userId && opts.userName) {
		userId = await lookupUserIdByUserName(client, opts.userName);
		if (!userId) {
			throw new Error(`No user found for user_name=${opts.userName}`);
		}
	}
	if (!userId) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	const profile = await buildTasteProfile(client, userId, opts.limit);
	const jsonPretty = JSON.stringify(profile, null, 2);

	if (opts.json || !opts.outputDir) {
		console.log(jsonPretty);
	}

	if (opts.outputDir) {
		const outDir = path.resolve(process.cwd(), opts.outputDir);
		fs.mkdirSync(outDir, { recursive: true });
		const baseName = profile?.user?.profile?.user_name
			? profile.user.profile.user_name
			: `user-${userId}`;
		const outPath = path.join(outDir, `${baseName}.js`);
		const jsContent = `export default ${jsonPretty};\n`;
		fs.writeFileSync(outPath, jsContent, "utf8");
		console.error(`Wrote taste profile module to ${outPath}`);
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});

