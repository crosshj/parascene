import express from "express";
import sharp from "sharp";
import { aspectRatioForGroupFirstSource, shouldGenerateFitThumbnail, withGroupAspectRatioFromFirst } from "../services/create/fitThumbnail.js";
import { parseCreationMeta, resolveCreatedImageStorageFilename } from "../services/create/resolveCreatedImageStorageFilename.js";

const parseMeta = parseCreationMeta;

export default function createRepairRoutes({ queries, storage }) {
  const router = express.Router();
  async function requireUser(req, res) {
    if (!req.auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) res.status(404).json({ error: "User not found" });
    return user;
  }
	// POST /api/create/images/repair-group-aspect
	// Fix meta.args.aspect_ratio on group creations from the first source in the list.
	router.post("/api/create/images/repair-group-aspect", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
			const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 50));
			const updated = [];
			const skipped = [];

			/** @type {object[]} */
			let candidates = [];
			if (bodyIds && bodyIds.length > 0) {
				for (const rawId of bodyIds.slice(0, limit)) {
					const id = Number(rawId);
					if (!Number.isFinite(id) || id <= 0) continue;
					const row = await queries.selectCreatedImageById.get(id, user.id);
					if (row) candidates.push(row);
					else skipped.push({ id, reason: "not_found" });
				}
			} else {
				const pages = Math.ceil(limit / 50);
				for (let p = 0; p < pages && candidates.length < limit; p++) {
					const batch = await queries.selectCreatedImagesForUser.all(user.id, {
						limit: 50,
						offset: p * 50,
						viewerEnableNsfw: true
					});
					if (!Array.isArray(batch) || batch.length === 0) break;
					for (const row of batch) {
						const meta = parseMeta(row.meta);
						if (meta?.group?.kind === "group_creations") {
							candidates.push(row);
							if (candidates.length >= limit) break;
						}
					}
					if (batch.length < 50) break;
				}
			}

			for (const row of candidates) {
				const id = Number(row.id);
				const meta = parseMeta(row.meta) || {};
				if (meta?.group?.kind !== "group_creations") {
					skipped.push({ id, reason: "not_group" });
					continue;
				}
				const sources = Array.isArray(meta.group.source_creations)
					? meta.group.source_creations.filter((s) => s && typeof s === "object")
					: [];
				const firstId = Number(
					Array.isArray(meta.group.source_creation_ids)
						? meta.group.source_creation_ids[0]
						: NaN
				);
				const first =
					(Number.isFinite(firstId) && firstId > 0
						? sources.find((s) => Number(s.id) === firstId)
						: null) || sources[0] || null;
				if (!first) {
					skipped.push({ id, reason: "no_sources" });
					continue;
				}
				const nextAspect = aspectRatioForGroupFirstSource(first);
				const current =
					typeof meta?.args?.aspect_ratio === "string"
						? meta.args.aspect_ratio.trim()
						: "";
				if (current === nextAspect) {
					skipped.push({ id, reason: "already_ok", aspect_ratio: current });
					continue;
				}
				const nextMeta = withGroupAspectRatioFromFirst(meta, first);
				const result = await queries.updateCreatedImageMeta.run(id, user.id, nextMeta);
				if (!result || result.changes === 0) {
					skipped.push({ id, reason: "update_failed" });
					continue;
				}
				updated.push({ id, aspect_ratio: nextAspect, previous: current || null });
			}

			return res.json({
				ok: true,
				updated,
				skipped,
				updated_count: updated.length,
				skipped_count: skipped.length
			});
		} catch (error) {
			console.error("repair-group-aspect failed:", error);
			return res.status(500).json({ error: "Failed to repair group aspects" });
		}
	});

	// POST /api/create/images/repair-fit-thumbnails
	// Generate native-aspect fit thumbs for non-square creations missing a fit object.
	router.post("/api/create/images/repair-fit-thumbnails", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			if (typeof storage.uploadFitThumbnail !== "function") {
				return res.status(500).json({ error: "Fit thumbnail storage not available" });
			}
			const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
			const limit = Math.min(50, Math.max(1, parseInt(req.body?.limit, 10) || 25));
			const offset = Math.max(0, parseInt(req.body?.offset, 10) || 0);
			const force = req.body?.force === true;
			const updated = [];
			const skipped = [];
			let scanned = 0;
			let nextOffset = offset;
			let exhausted = false;

			/** @type {object[]} */
			let candidates = [];
			if (bodyIds && bodyIds.length > 0) {
				for (const rawId of bodyIds.slice(0, limit)) {
					const id = Number(rawId);
					if (!Number.isFinite(id) || id <= 0) continue;
					const row = await queries.selectCreatedImageById.get(id, user.id);
					if (row) candidates.push(row);
					else skipped.push({ id, reason: "not_found" });
				}
				exhausted = true;
			} else {
				// Page through the library until we have `limit` candidates past `offset`
				// (not just the newest page — older non-square rows must get repaired too).
				const pageSize = 50;
				while (candidates.length < limit) {
					const batch = await queries.selectCreatedImagesForUser.all(user.id, {
						limit: pageSize,
						offset: nextOffset,
						viewerEnableNsfw: true
					});
					if (!Array.isArray(batch) || batch.length === 0) {
						exhausted = true;
						break;
					}
					for (const row of batch) {
						nextOffset += 1;
						scanned += 1;
						if ((row.status || "completed") !== "completed") continue;
						candidates.push(row);
						if (candidates.length >= limit) break;
					}
					if (batch.length < pageSize) {
						exhausted = true;
						break;
					}
				}
			}

			for (const row of candidates) {
				const id = Number(row.id);
				const w = Number(row.width);
				const h = Number(row.height);
				const meta = parseMeta(row.meta) || {};
				const mediaType =
					typeof meta?.media_type === "string" && meta.media_type.trim()
						? meta.media_type.trim()
						: "image";
				const dimsW = Number.isFinite(w) && w > 0 ? w : null;
				const dimsH = Number.isFinite(h) && h > 0 ? h : null;
				if (dimsW && dimsH && !shouldGenerateFitThumbnail(dimsW, dimsH)) {
					skipped.push({ id, reason: "square" });
					continue;
				}

				const storageFilename = resolveCreatedImageStorageFilename(row);
				if (!storageFilename) {
					skipped.push({ id, reason: "no_storage_filename" });
					continue;
				}

				if (!force && typeof storage.hasFitThumbnail === "function") {
					try {
						const exists = await storage.hasFitThumbnail(storageFilename);
						if (exists) {
							skipped.push({ id, reason: "already_exists" });
							continue;
						}
					} catch {
						// proceed to regenerate
					}
				}

				let fullBuffer;
				try {
					fullBuffer = await storage.getImageBuffer(storageFilename, {
						throwIfMissing: true
					});
				} catch (e) {
					skipped.push({
						id,
						reason: mediaType === "video" ? "video_needs_poster_or_local_fill" : "media_missing",
						detail: e?.message || String(e)
					});
					continue;
				}

				// Re-check dims from bytes when row width/height missing or unreliable.
				try {
					const sharpMeta = await sharp(fullBuffer, { failOn: "none" }).metadata();
					const bw = Number(sharpMeta.width) || 0;
					const bh = Number(sharpMeta.height) || 0;
					if (bw > 0 && bh > 0 && !shouldGenerateFitThumbnail(bw, bh)) {
						// Video posters are often square even when the video is 9:16 — cloud
						// fit can't invent native aspect from a square poster.
						skipped.push({
							id,
							reason: mediaType === "video" ? "square_poster" : "square",
							detail: `${bw}x${bh}`
						});
						continue;
					}
				} catch {
					// continue; buildFitThumbnailBuffer will fail clearly
				}

				try {
					await storage.uploadFitThumbnail(fullBuffer, storageFilename);
					updated.push({ id, filename: storageFilename });
				} catch (e) {
					skipped.push({ id, reason: "upload_failed", detail: e?.message || String(e) });
				}
			}

			return res.json({
				ok: true,
				updated,
				skipped,
				updated_count: updated.length,
				skipped_count: skipped.length,
				scanned: bodyIds ? candidates.length : scanned,
				offset,
				next_offset: nextOffset,
				exhausted: Boolean(exhausted || (bodyIds && bodyIds.length > 0))
			});
		} catch (error) {
			console.error("repair-fit-thumbnails failed:", error);
			return res.status(500).json({ error: "Failed to repair fit thumbnails" });
		}
	});


  return router;
}
