#!/usr/bin/env node
/**
 * Generate 16:9 WebP challenge hero previews for creations attached as
 * challenge_config hero_image_url. Stamps meta.challenge_hero_preview_url and
 * challenge_config.hero_preview_url. Originals stay.
 *
 * Usage:
 *   node scripts/backfill-challenge-hero-previews.js --dry-run
 *   node scripts/backfill-challenge-hero-previews.js
 *   node scripts/backfill-challenge-hero-previews.js --force
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./repo-root.cjs";
import {
	isChallengeConfigPurged,
	isChallengeConfigSoftDeleted,
	mergeFullChallengeConfigForChallenge,
	pickChallengeHeroImageUrl
} from "../src/chat/challenges/challengeAdmin.js";
import {
	findChallengesChannelThreadId,
	fetchThreadMessagesNewestFirst,
	parseCreationIdFromChallengeHeroRef,
	tryParseChallengeJsonBody
} from "../api_routes/utils/challengeSubmitShared.js";
import {
	CHALLENGE_HERO_PREVIEW_CONTENT_TYPE,
	challengeHeroPreviewStorageKey,
	ensureChallengeHeroPreview,
	persistChallengeHeroPreviewUrlOnConfig,
	processChallengeHeroPreviewBuffer,
	readChallengeHeroPreviewUrlFromMeta
} from "../api_routes/utils/challengeHeroPreview.js";
import { buildGenericImageUrl } from "../api_routes/utils/profileAvatar.js";

loadEnv();

const CREATED_TABLE = "prsn_created_images";
const CREATED_BUCKET = "prsn_created-images";
const GENERIC_BUCKET = "prsn_generic-images";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
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

	const queries = {
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				const { data, error } = await supabase
					.from(CREATED_TABLE)
					.select("id, filename, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data;
			}
		},
		updateCreatedImageMetaAnyUser: {
			run: async (id, meta) => {
				const { error } = await supabase.from(CREATED_TABLE).update({ meta }).eq("id", id);
				if (error) throw error;
				return { changes: 1 };
			}
		}
	};

	const storage = {
		getImageBuffer: async (filename) => {
			const { data, error } = await supabase.storage.from(CREATED_BUCKET).download(filename);
			if (error || !data) throw new Error(error?.message || `not found: ${filename}`);
			return Buffer.from(await data.arrayBuffer());
		},
		uploadGenericImage: async (buffer, key, options = {}) => {
			const { error } = await supabase.storage.from(GENERIC_BUCKET).upload(key, buffer, {
				contentType: options.contentType || CHALLENGE_HERO_PREVIEW_CONTENT_TYPE,
				upsert: true
			});
			if (error) throw error;
			return key;
		}
	};

	const threadId = await findChallengesChannelThreadId(supabase);
	if (!threadId) throw new Error("Challenges channel thread not found");
	const messages = await fetchThreadMessagesNewestFirst(supabase, threadId);

	/** @type {Map<string, { msg: object, payload: object }[]>} */
	const entriesByChallenge = new Map();
	for (const m of messages || []) {
		const p = tryParseChallengeJsonBody(m?.body);
		if (!p || String(p.kind || "").trim() !== "challenge_config") continue;
		const cid = String(p.challenge_id || "").trim();
		if (!cid) continue;
		if (!entriesByChallenge.has(cid)) entriesByChallenge.set(cid, []);
		entriesByChallenge.get(cid)?.push({ msg: m, payload: p });
	}

	console.log(
		[
			dryRun ? "[dry-run]" : "[write]",
			`challenge hero previews (${CHALLENGE_HERO_PREVIEW_CONTENT_TYPE})`,
			force ? "(force)" : "(skip existing)",
			`challenges=${entriesByChallenge.size}`
		].join(" ")
	);

	let scanned = 0;
	let skipped = 0;
	let updated = 0;
	let failed = 0;

	for (const [challengeId, newestFirstEntries] of entriesByChallenge.entries()) {
		const chronological = [...newestFirstEntries].reverse();
		const merged = mergeFullChallengeConfigForChallenge(chronological, challengeId);
		if (isChallengeConfigSoftDeleted(merged) || isChallengeConfigPurged(merged)) continue;
		const heroRef = pickChallengeHeroImageUrl(merged);
		const creationId = parseCreationIdFromChallengeHeroRef(heroRef);
		if (!Number.isFinite(creationId) || creationId <= 0) continue;

		scanned += 1;
		const messageIds = newestFirstEntries
			.map((e) => Number(e?.msg?.id))
			.filter((id) => Number.isFinite(id) && id > 0);

		try {
			if (dryRun) {
				const row = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				const existing = readChallengeHeroPreviewUrlFromMeta(
					row?.meta && typeof row.meta === "object" ? row.meta : {}
				);
				const expected = buildGenericImageUrl(challengeHeroPreviewStorageKey(creationId));
				if (!force && existing === expected) {
					skipped += 1;
					continue;
				}
				const filename = typeof row?.filename === "string" ? row.filename.trim() : "";
				if (!filename) throw new Error("missing filename");
				const sourceBuffer = await storage.getImageBuffer(filename);
				const processed = await processChallengeHeroPreviewBuffer(sourceBuffer);
				console.log(
					`  [dry-run] ${challengeId} creation ${creationId}: ${formatBytes(sourceBuffer.length)} → ${formatBytes(processed.length)}`
				);
				updated += 1;
				continue;
			}

			const url = await ensureChallengeHeroPreview({
				storage,
				queries,
				creationId,
				force
			});
			if (!url) throw new Error("preview not generated");
			await persistChallengeHeroPreviewUrlOnConfig({
				sb: supabase,
				threadId,
				challengeId,
				messageIds,
				merged,
				url
			});
			console.log(`  ${challengeId} creation ${creationId}: ${url}`);
			updated += 1;
		} catch (err) {
			failed += 1;
			console.error(`  ${challengeId} creation ${creationId}: ${err?.message || err}`);
		}
	}

	console.log(`done scanned=${scanned} updated=${updated} skipped=${skipped} failed=${failed}`);
	if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
