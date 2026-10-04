import sharp from "sharp";
import { buildGenericImageUrl } from "./profileAvatar.js";
import { persistSingleChallengeConfigMessage } from "./challengeConfigMessage.js";

/** 16:9 strip used on the challenges page (~600–720 CSS px; 1280 covers 2x). */
export const CHALLENGE_HERO_PREVIEW_WIDTH = 1280;
export const CHALLENGE_HERO_PREVIEW_HEIGHT = 720;
export const CHALLENGE_HERO_PREVIEW_CONTENT_TYPE = "image/webp";
export const CHALLENGE_HERO_PREVIEW_WEBP_QUALITY = 82;

export function challengeHeroPreviewStorageKey(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error("Invalid creation id");
	}
	return `challenge-heroes/${id}.webp`;
}

export function readChallengeHeroPreviewUrlFromMeta(meta) {
	const raw =
		meta && typeof meta === "object" && typeof meta.challenge_hero_preview_url === "string"
			? meta.challenge_hero_preview_url.trim()
			: "";
	return raw;
}

export async function processChallengeHeroPreviewBuffer(buffer) {
	return sharp(buffer, { failOn: "none" })
		.rotate()
		.resize(CHALLENGE_HERO_PREVIEW_WIDTH, CHALLENGE_HERO_PREVIEW_HEIGHT, {
			fit: "cover",
			position: "centre"
		})
		.webp({ quality: CHALLENGE_HERO_PREVIEW_WEBP_QUALITY })
		.toBuffer();
}

function parseCreationMeta(meta) {
	if (meta && typeof meta === "object" && !Array.isArray(meta)) return { ...meta };
	if (typeof meta === "string") {
		try {
			const o = JSON.parse(meta);
			if (o && typeof o === "object" && !Array.isArray(o)) return { ...o };
		} catch {
			// ignore
		}
	}
	return {};
}

/**
 * Build (or reuse) a 16:9 WebP hero preview for a creation and stamp
 * `meta.challenge_hero_preview_url`. Original creation bytes are not modified.
 *
 * @param {{
 *   storage: { getImageBuffer?: Function, uploadGenericImage?: Function },
 *   queries: object,
 *   creationId: number,
 *   force?: boolean
 * }} args
 * @returns {Promise<string|null>}
 */
export async function ensureChallengeHeroPreview(args) {
	const storage = args?.storage;
	const queries = args?.queries;
	const creationId = Number(args?.creationId);
	const force = args?.force === true;
	if (!Number.isFinite(creationId) || creationId <= 0) return null;
	if (typeof storage?.getImageBuffer !== "function" || typeof storage?.uploadGenericImage !== "function") {
		return null;
	}
	if (typeof queries?.selectCreatedImageByIdAnyUser?.get !== "function") return null;
	if (typeof queries?.updateCreatedImageMetaAnyUser?.run !== "function") return null;

	const row = await queries.selectCreatedImageByIdAnyUser.get(creationId);
	const filename = typeof row?.filename === "string" ? row.filename.trim() : "";
	if (!filename || filename.includes("..")) return null;

	const meta = parseCreationMeta(row.meta);
	const existing = readChallengeHeroPreviewUrlFromMeta(meta);
	const expectedUrl = buildGenericImageUrl(challengeHeroPreviewStorageKey(creationId));
	if (!force && existing === expectedUrl) return existing;

	const sourceBuffer = await storage.getImageBuffer(filename);
	if (!sourceBuffer || !Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
		return existing || null;
	}

	const processed = await processChallengeHeroPreviewBuffer(sourceBuffer);
	const key = challengeHeroPreviewStorageKey(creationId);
	await storage.uploadGenericImage(processed, key, {
		contentType: CHALLENGE_HERO_PREVIEW_CONTENT_TYPE
	});

	const url = buildGenericImageUrl(key);
	if (existing !== url) {
		await queries.updateCreatedImageMetaAnyUser.run(creationId, {
			...meta,
			challenge_hero_preview_url: url
		});
	}
	return url;
}

/**
 * Write `hero_preview_url` onto the canonical challenge_config message.
 *
 * @param {{
 *   sb: object,
 *   threadId: number,
 *   challengeId: string,
 *   messageIds: Iterable<number|string>,
 *   merged: object,
 *   url: string
 * }} args
 */
export async function persistChallengeHeroPreviewUrlOnConfig(args) {
	const url = typeof args?.url === "string" ? args.url.trim() : "";
	const challengeId = String(args?.challengeId || "").trim();
	const threadId = Number(args?.threadId);
	if (!challengeId || !args?.sb || !Number.isFinite(threadId) || threadId <= 0) return;
	const merged = args?.merged && typeof args.merged === "object" ? args.merged : {};
	if (String(merged.hero_preview_url || "").trim() === url) return;
	await persistSingleChallengeConfigMessage({
		sb: args.sb,
		threadId,
		challengeId,
		messageIds: args.messageIds,
		merged,
		patch: { hero_preview_url: url }
	});
}
