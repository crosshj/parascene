#!/usr/bin/env node
/**
 * Write a square WebP copy (max 256) at profile/{userId}/avatar_{ts}_{rand}.webp
 * and point avatar_url at that copy. Source images stay. Existing 128 PNGs are
 * rebuilt from meta.avatar_source_url when present. Already-processed WebP
 * avatars are skipped unless --force.
 *
 * Usage:
 *   node scripts/normalize-profile-avatars.js --dry-run
 *   node scripts/normalize-profile-avatars.js
 *   node scripts/normalize-profile-avatars.js --force
 *   node scripts/normalize-profile-avatars.js --user-id 123
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./repo-root.cjs";
import {
	PROFILE_AVATAR_CONTENT_TYPE,
	PROFILE_AVATAR_SIZE,
	buildGenericImageUrl,
	extractGenericImageKey,
	isProcessedProfileAvatarUrl,
	newProfileAvatarStorageKey,
	processProfileAvatarBuffer
} from "../api_routes/utils/profileAvatar.js";

loadEnv();

const TABLE = "prsn_user_profiles";
const GENERIC_BUCKET = "prsn_generic-images";
const CREATED_BUCKET = "prsn_created-images";
const ANON_BUCKET = "prsn_created-images-anon";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const userIdArg = readFlagValue(args, "--user-id");
const pageSize = 100;

function readFlagValue(list, flag) {
	const idx = list.indexOf(flag);
	if (idx < 0) return null;
	const value = list[idx + 1];
	if (!value || value.startsWith("--")) return null;
	return value;
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function toPathname(url) {
	const raw = String(url || "").trim();
	if (!raw) return "";
	try {
		if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname;
	} catch {
		return raw;
	}
	return raw;
}

function parseCreatedFilename(url) {
	const path = toPathname(url);
	const prefix = "/api/images/created/";
	const idx = path.indexOf(prefix);
	if (idx < 0) return null;
	const tail = path.slice(idx + prefix.length).split(/[?#]/)[0];
	const filename = tail.split("/").filter(Boolean).map((seg) => {
		try {
			return decodeURIComponent(seg);
		} catch {
			return seg;
		}
	}).join("/");
	if (!filename || filename.includes("..")) return null;
	return filename;
}

function parseTryFilename(url) {
	const path = toPathname(url);
	const prefix = "/api/try/images/";
	const idx = path.indexOf(prefix);
	if (idx < 0) return null;
	const filename = path.slice(idx + prefix.length).split("/")[0].split("?")[0].trim();
	if (!filename || filename.includes("..") || filename.includes("/")) return null;
	return filename;
}

function rememberSourceMeta(meta, sourceUrl) {
	const next = meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
	const existing = typeof next.avatar_source_url === "string" ? next.avatar_source_url.trim() : "";
	if (!existing && sourceUrl) next.avatar_source_url = sourceUrl;
	return next;
}

async function downloadBucketFile(supabase, bucket, key) {
	const { data, error } = await supabase.storage.from(bucket).download(key);
	if (error || !data) {
		throw new Error(error?.message || `not found in ${bucket}: ${key}`);
	}
	const arrayBuffer = await data.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

async function fetchHttpBuffer(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
	const arrayBuffer = await res.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

async function loadSourceBuffer(supabase, url) {
	const genericKey = extractGenericImageKey(url);
	if (genericKey) return downloadBucketFile(supabase, GENERIC_BUCKET, genericKey);

	const createdFilename = parseCreatedFilename(url);
	if (createdFilename) return downloadBucketFile(supabase, CREATED_BUCKET, createdFilename);

	const tryFilename = parseTryFilename(url);
	if (tryFilename) return downloadBucketFile(supabase, ANON_BUCKET, tryFilename);

	if (/^https?:\/\//i.test(String(url || "").trim())) {
		return fetchHttpBuffer(String(url).trim());
	}

	throw new Error(`unsupported avatar_url: ${url}`);
}

function formatBytes(n) {
	if (!Number.isFinite(n)) return "?";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
	const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
		auth: { persistSession: false }
	});

	const filterUserId = userIdArg != null ? Number(userIdArg) : null;
	if (userIdArg != null && (!Number.isFinite(filterUserId) || filterUserId <= 0)) {
		throw new Error("Invalid --user-id");
	}

	console.log(
		[
			dryRun ? "[dry-run]" : "[write]",
			`normalize profile avatars to max ${PROFILE_AVATAR_SIZE}x${PROFILE_AVATAR_SIZE} webp`,
			force ? "(force)" : "(skip processed webp avatars)",
			filterUserId != null ? `user_id=${filterUserId}` : ""
		]
			.filter(Boolean)
			.join(" ")
	);

	let lastUserId = 0;
	let scanned = 0;
	let skipped = 0;
	let updated = 0;
	let failed = 0;

	while (true) {
		let query = supabase
			.from(TABLE)
			.select("user_id, avatar_url, meta")
			.not("avatar_url", "is", null)
			.gt("user_id", lastUserId)
			.order("user_id", { ascending: true })
			.limit(pageSize);

		if (filterUserId != null) {
			query = supabase
				.from(TABLE)
				.select("user_id, avatar_url, meta")
				.eq("user_id", filterUserId)
				.limit(1);
		}

		const { data, error } = await query;
		if (error) throw error;
		const rows = data ?? [];
		if (!rows.length) break;

		for (const row of rows) {
			const userId = Number(row.user_id);
			lastUserId = userId;
			scanned += 1;

			const currentUrl = typeof row.avatar_url === "string" ? row.avatar_url.trim() : "";
			if (!currentUrl) {
				skipped += 1;
				continue;
			}

			const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {};
			const sourceFromMeta =
				typeof meta.avatar_source_url === "string" ? meta.avatar_source_url.trim() : "";
			const sourceUrl = sourceFromMeta || currentUrl;

			if (!force && isProcessedProfileAvatarUrl(currentUrl, userId)) {
				skipped += 1;
				continue;
			}

			const destKey = newProfileAvatarStorageKey(userId);
			const destUrl = buildGenericImageUrl(destKey);

			try {
				const sourceBuffer = await loadSourceBuffer(supabase, sourceUrl);
				const processed = await processProfileAvatarBuffer(sourceBuffer);

				if (dryRun) {
					console.log(
						`  [dry-run] user ${userId}: ${formatBytes(sourceBuffer.length)} → ${formatBytes(processed.length)} ${destKey}`
					);
					updated += 1;
					continue;
				}

				const { error: uploadError } = await supabase.storage.from(GENERIC_BUCKET).upload(destKey, processed, {
					contentType: PROFILE_AVATAR_CONTENT_TYPE,
					upsert: false
				});
				if (uploadError) throw uploadError;

				const nextMeta = isProcessedProfileAvatarUrl(currentUrl, userId)
					? meta
					: rememberSourceMeta(meta, currentUrl);
				const { error: updateError } = await supabase
					.from(TABLE)
					.update({
						avatar_url: destUrl,
						meta: nextMeta,
						updated_at: new Date().toISOString()
					})
					.eq("user_id", userId);
				if (updateError) throw updateError;

				console.log(
					`  user ${userId}: ${formatBytes(sourceBuffer.length)} → ${formatBytes(processed.length)} ${destUrl}`
				);
				updated += 1;
			} catch (err) {
				failed += 1;
				console.error(`  user ${userId}: ${err?.message || err}`);
			}
		}

		if (filterUserId != null || rows.length < pageSize) break;
	}

	console.log(`done scanned=${scanned} updated=${updated} skipped=${skipped} failed=${failed}`);
	if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
