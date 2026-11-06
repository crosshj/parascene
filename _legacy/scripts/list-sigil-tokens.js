#!/usr/bin/env node
/**
 * Sigil-token exercise: list unique #… and @… tokens from comments, creation
 * titles/descriptions, and all string values in prsn_created_images.meta.
 * Rules match public/shared/userText.js. #rgb / #rrgbb are skipped (hex colors).
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function makeSigilTokenRe(sigil) {
	const escaped = sigil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`(^|[^a-zA-Z0-9_-])(${escaped})([a-zA-Z0-9][a-zA-Z0-9_-]{1,31})(?=$|[^a-zA-Z0-9_-])`,
		"g"
	);
}

const HASH_TOKEN_RE = makeSigilTokenRe("#");
const AT_TOKEN_RE = makeSigilTokenRe("@");

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

function isValidHashtagBody(normalized) {
	return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized);
}

function isValidAtMentionBody(normalized) {
	return /^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized);
}

function isLikelyHexColorTag(canonicalHash) {
	const body = canonicalHash.slice(1);
	if (!/^[0-9a-f]+$/i.test(body)) return false;
	return body.length === 3 || body.length === 6;
}

function extractHashtagsFromText(text) {
	const out = [];
	if (typeof text !== "string" || !text) return out;
	const seen = new Set();
	HASH_TOKEN_RE.lastIndex = 0;
	let match;
	while ((match = HASH_TOKEN_RE.exec(text)) !== null) {
		const rawToken = match[3] || "";
		const normalized = rawToken.toLowerCase();
		if (!isValidHashtagBody(normalized)) continue;
		const key = `#${normalized}`;
		if (isLikelyHexColorTag(key)) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

function extractAtMentionsFromText(text) {
	const out = [];
	if (typeof text !== "string" || !text) return out;
	const seen = new Set();
	AT_TOKEN_RE.lastIndex = 0;
	let match;
	while ((match = AT_TOKEN_RE.exec(text)) !== null) {
		const rawToken = match[3] || "";
		const normalized = rawToken.toLowerCase();
		if (!isValidAtMentionBody(normalized)) continue;
		const key = `@${normalized}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

function collectJsonStrings(value, acc) {
	if (value == null) return;
	if (typeof value === "string") {
		acc.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectJsonStrings(item, acc);
		return;
	}
	if (typeof value === "object") {
		for (const k of Object.keys(value)) collectJsonStrings(value[k], acc);
	}
}

function extractFromMeta(meta) {
	const hashtags = new Set();
	const atMentions = new Set();
	if (meta == null || typeof meta !== "object") {
		return { hashtags, atMentions };
	}
	const strings = [];
	collectJsonStrings(meta, strings);
	for (const s of strings) {
		for (const t of extractHashtagsFromText(s)) hashtags.add(t);
		for (const t of extractAtMentionsFromText(s)) atMentions.add(t);
	}
	return { hashtags, atMentions };
}

function sortUnique(set) {
	return [...set].sort((a, b) => a.localeCompare(b));
}

async function fetchAllRows(client, table, selectColumns) {
	const pageSize = 1000;
	let from = 0;
	const rows = [];
	while (true) {
		const to = from + pageSize - 1;
		const { data, error } = await client.from(table).select(selectColumns).range(from, to);
		if (error) throw error;
		if (!data || data.length === 0) break;
		rows.push(...data);
		if (data.length < pageSize) break;
		from += data.length;
	}
	return rows;
}

async function main() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	const client = createClient(supabaseUrl, serviceRoleKey);

	const hashtags = new Set();
	const atMentions = new Set();

	const comments = await fetchAllRows(client, "prsn_comments_created_image", "text");
	for (const row of comments) {
		for (const t of extractHashtagsFromText(row.text)) hashtags.add(t);
		for (const t of extractAtMentionsFromText(row.text)) atMentions.add(t);
	}

	const images = await fetchAllRows(
		client,
		"prsn_created_images",
		"title, description, meta"
	);
	for (const row of images) {
		for (const t of extractHashtagsFromText(row.title)) hashtags.add(t);
		for (const t of extractHashtagsFromText(row.description)) hashtags.add(t);
		for (const t of extractAtMentionsFromText(row.title)) atMentions.add(t);
		for (const t of extractAtMentionsFromText(row.description)) atMentions.add(t);
		const fromMeta = extractFromMeta(row.meta);
		for (const t of fromMeta.hashtags) hashtags.add(t);
		for (const t of fromMeta.atMentions) atMentions.add(t);
	}

	const hSorted = sortUnique(hashtags);
	const aSorted = sortUnique(atMentions);

	console.log(
		JSON.stringify(
			{
				hashtags: { count: hSorted.length, values: hSorted },
				at_mentions: { count: aSorted.length, values: aSorted }
			},
			null,
			2
		)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
