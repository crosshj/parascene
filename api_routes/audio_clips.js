import express from "express";
import {
	AUDIO_CLIP_MAX_BYTES,
	AUDIO_CLIP_SOURCE_TYPES,
	buildAudioClipCreationSnapshot,
	buildClipOwnersMeta,
	buildGenericAudioUrl,
	canEditClip,
	clipExtFromContentType,
	formatAudioClipListRow,
	getClipOwners,
	isClipOwner,
	isFounderOrAdmin,
	mergeClipOwnersMeta,
	normalizeClipContentType,
	parseClipMeta
} from "./utils/audioClips.js";
import { mapCreatedImageRowMediaFields } from "./utils/resolveCreationDisplayMedia.js";

function parsePositiveInt(raw, fallback) {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.floor(n);
}

export default function createAudioClipsRoutes({ queries, storage }) {
	const router = express.Router();

	router.get("/api/audio-clips", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const fn = queries.selectAudioClipsForOwner?.page;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Audio clips are not available" });
			}
			const limit = parsePositiveInt(req.query?.limit, 24);
			const offset = Math.max(0, Number(req.query?.offset) || 0);
			const sortRaw = String(req.query?.sort ?? "last_used_at").trim().toLowerCase();
			const sort = ["last_used_at", "usage_count", "created_at"].includes(sortRaw)
				? sortRaw
				: "last_used_at";
			const { items, total } = await fn(req.auth.userId, { limit, offset, sort });
			const rows = (Array.isArray(items) ? items : [])
				.map((row) => formatAudioClipListRow(row, { includeAudioUrl: true }))
				.filter(Boolean);
			res.set("Cache-Control", "private, max-age=15");
			return res.json({ items: rows, total, limit, offset, sort });
		} catch (err) {
			console.error("[audio-clips list]", err);
			return res.status(500).json({ error: "Failed to load audio clips" });
		}
	});

	router.get("/api/audio-clips/:id", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const clipId = Number(req.params.id);
			if (!Number.isFinite(clipId) || clipId <= 0) {
				return res.status(400).json({ error: "Invalid clip id" });
			}
			const clip = await queries.selectAudioClipById?.get(clipId);
			if (!clip) {
				return res.status(404).json({ error: "Clip not found" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			const owner = isClipOwner(clip, user?.id) || isFounderOrAdmin(user);
			if (!owner) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const meta = parseClipMeta(clip.meta);
			const ownerIds = getClipOwners(meta);
			const ownerUserIds = [ownerIds.creator, ownerIds.source].filter(Boolean);
			let ownerProfiles = [];
			if (ownerUserIds.length) {
				const profileMap = await queries.selectUserProfilesByUserIds(ownerUserIds);
				ownerProfiles = ownerUserIds.map((id) => {
					const p = profileMap.get(Number(id));
					return {
						user_id: id,
						display_name: p?.display_name ?? "",
						user_name: p?.user_name ?? "",
						avatar_url: p?.avatar_url ?? ""
					};
				});
			}
			res.set("Cache-Control", "private, no-store");
			return res.json({
				clip: {
					id: clip.id,
					title: clip.title,
					description: clip.description ?? "",
					duration_sec: clip.duration_sec,
					source_type: clip.source_type,
					source_created_image_id: clip.source_created_image_id,
					usage_count: clip.usage_count,
					last_used_at: clip.last_used_at,
					content_type: clip.content_type,
					audio_url: buildGenericAudioUrl(clip.storage_key),
					meta,
					owners: ownerIds,
					owner_profiles: ownerProfiles,
					created_at: clip.created_at,
					updated_at: clip.updated_at,
					can_edit: canEditClip(user, clip)
				}
			});
		} catch (err) {
			console.error("[audio-clips detail]", err);
			return res.status(500).json({ error: "Failed to load audio clip" });
		}
	});

	router.get("/api/audio-clips/:id/creations", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const clipId = Number(req.params.id);
			if (!Number.isFinite(clipId) || clipId <= 0) {
				return res.status(400).json({ error: "Invalid clip id" });
			}
			const clip = await queries.selectAudioClipById?.get(clipId);
			if (!clip) {
				return res.status(404).json({ error: "Clip not found" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			const owner = isClipOwner(clip, user?.id) || isFounderOrAdmin(user);
			if (!owner) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const limit = parsePositiveInt(req.query?.limit, 24);
			const offset = Math.max(0, Number(req.query?.offset) || 0);
			const fn = queries.selectAudioClipUsagesForClip?.page;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Audio clip usages are not available" });
			}
			const { items, total } = await fn(clipId, { limit, offset });
			const creations = (Array.isArray(items) ? items : []).map((row) => {
				const creation = row.prsn_created_images ?? null;
				if (!creation) return null;
				const media = mapCreatedImageRowMediaFields(creation, { storage, includeMeta: false });
				return {
					usage_id: row.id,
					used_at: row.used_at,
					created_image_id: creation.id,
					title: creation.title ?? "",
					published: creation.published === true || creation.published === 1,
					status: creation.status ?? "",
					media_type: media.media_type,
					thumbnail_url: media.thumbnail_url || media.url || "",
					created_at: creation.created_at
				};
			}).filter(Boolean);
			res.set("Cache-Control", "private, max-age=30");
			return res.json({ items: creations, total, limit, offset });
		} catch (err) {
			console.error("[audio-clips creations]", err);
			return res.status(500).json({ error: "Failed to load clip usages" });
		}
	});

	router.post(
		"/api/audio-clips/record",
		express.raw({ type: () => true, limit: `${AUDIO_CLIP_MAX_BYTES}b` }),
		async (req, res) => {
			try {
				if (!req.auth?.userId) {
					return res.status(401).json({ error: "Unauthorized" });
				}
				if (typeof storage?.uploadGenericImage !== "function") {
					return res.status(503).json({ error: "Audio storage not available" });
				}
				const insertFn = queries.insertAudioClip?.run;
				if (typeof insertFn !== "function") {
					return res.status(501).json({ error: "Audio clips are not available" });
				}
				const audioBuffer = req.body;
				if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
					return res.status(400).json({ error: "Empty audio upload" });
				}
				if (audioBuffer.length > AUDIO_CLIP_MAX_BYTES) {
					return res.status(413).json({
						error: "Audio file too large",
						message: "Audio must be 20 MB or smaller.",
						max_bytes: AUDIO_CLIP_MAX_BYTES
					});
				}
				const titleRaw =
					typeof req.query?.title === "string"
						? req.query.title.trim()
						: typeof req.headers["x-audio-clip-title"] === "string"
							? req.headers["x-audio-clip-title"].trim()
							: "";
				const title = titleRaw || `Recording ${new Date().toLocaleString()}`;
				const durationRaw =
					req.query?.duration_sec ?? req.headers["x-audio-clip-duration-sec"] ?? null;
				const durationNum = durationRaw != null ? Number(durationRaw) : null;
				const duration_sec =
					Number.isFinite(durationNum) && durationNum > 0 ? durationNum : null;
				const sourceRaw = String(
					req.query?.source_type ?? req.headers["x-audio-clip-source-type"] ?? "recorded"
				)
					.trim()
					.toLowerCase();
				const source_type = AUDIO_CLIP_SOURCE_TYPES.has(sourceRaw) ? sourceRaw : "recorded";
				if (source_type === "video_extract") {
					return res.status(400).json({
						error: "Use share-audio on a video creation to extract audio"
					});
				}
				const mimeType = normalizeClipContentType(req.headers["content-type"]);
				const safeExt = clipExtFromContentType(mimeType);
				const userId = Number(req.auth.userId);
				const timestamp = Date.now();
				const random = Math.random().toString(36).substring(2, 9);
				const storageKey = `prompt-audio/${userId}_${timestamp}_${random}.${safeExt}`;
				await storage.uploadGenericImage(audioBuffer, storageKey, { contentType: mimeType });
				const meta = buildClipOwnersMeta({ creatorUserId: userId });
				const clip = await insertFn({
					title,
					description: null,
					storage_key: storageKey,
					content_type: mimeType,
					byte_size: audioBuffer.length,
					duration_sec,
					source_type,
					source_created_image_id: null,
					meta
				});
				res.set("Cache-Control", "private, no-store");
				return res.status(201).json({
					ok: true,
					item: formatAudioClipListRow(clip, { includeAudioUrl: true })
				});
			} catch (err) {
				console.error("[audio-clips record]", err);
				const raw =
					err?.message && typeof err.message === "string"
						? err.message
						: "Failed to save audio clip";
				const message = raw.replace(/^Failed to upload generic image:\s*/i, "");
				return res.status(500).json({ error: "Failed to save audio clip", message });
			}
		}
	);

	router.patch("/api/audio-clips/:id", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const clipId = Number(req.params.id);
			if (!Number.isFinite(clipId) || clipId <= 0) {
				return res.status(400).json({ error: "Invalid clip id" });
			}
			const clip = await queries.selectAudioClipById?.get(clipId);
			if (!clip) {
				return res.status(404).json({ error: "Clip not found" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!canEditClip(user, clip)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const patch = {};
			if (body.title != null) {
				const t = String(body.title).trim();
				if (!t) return res.status(400).json({ error: "Title cannot be empty" });
				patch.title = t;
			}
			if (body.description != null) {
				patch.description = String(body.description).trim() || null;
			}
			if (body.meta != null && typeof body.meta === "object" && !Array.isArray(body.meta)) {
				const existing = parseClipMeta(clip.meta);
				const incoming = { ...body.meta };
				delete incoming.owners;
				patch.meta = { ...existing, ...incoming, owners: existing.owners ?? getClipOwners(existing) };
				if (patch.meta.owners && typeof patch.meta.owners === "object") {
					patch.meta = mergeClipOwnersMeta(clip.meta, { owners: patch.meta.owners });
				}
			}
			if (!Object.keys(patch).length) {
				return res.status(400).json({ error: "No changes provided" });
			}
			const updated = await queries.updateAudioClip?.run(clipId, patch);
			if (!updated) {
				return res.status(500).json({ error: "Failed to update clip" });
			}
			res.set("Cache-Control", "private, no-store");
			return res.json({
				ok: true,
				item: formatAudioClipListRow(updated, { includeAudioUrl: true })
			});
		} catch (err) {
			console.error("[audio-clips patch]", err);
			return res.status(500).json({ error: "Failed to update audio clip" });
		}
	});

	router.delete("/api/audio-clips/:id", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const clipId = Number(req.params.id);
			if (!Number.isFinite(clipId) || clipId <= 0) {
				return res.status(400).json({ error: "Invalid clip id" });
			}
			const clip = await queries.selectAudioClipById?.get(clipId);
			if (!clip) {
				return res.status(404).json({ error: "Clip not found" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!canEditClip(user, clip)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			await queries.softDeleteAudioClip?.run(clipId);
			res.set("Cache-Control", "private, no-store");
			return res.json({ ok: true });
		} catch (err) {
			console.error("[audio-clips delete]", err);
			return res.status(500).json({ error: "Failed to delete audio clip" });
		}
	});

	return router;
}

export { buildAudioClipCreationSnapshot };
