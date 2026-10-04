import {parseCreationMeta} from '../services/create/resolveCreatedImageStorageFilename.js';
import {normalizeTag} from '../services/account/tag.js';
function normalizePersonality(input){const v=String(input||'').trim().replace(/^@/,'').toLowerCase();return /^[a-z0-9][a-z0-9_-]{2,23}$/.test(v)?v:null}
import express from 'express';
import {mapCreatedImageRowMediaFields} from '../services/create/resolveCreationDisplayMedia.js';
export default function createProfileBrowseRoutes({queries}){const router=express.Router();
router.get("/api/personalities/:personality/creations", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth?.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const personality = normalizePersonality(req.params?.personality);
			if (!personality) {
				return res.status(400).json({ error: "Invalid personality" });
			}
			const personalityQueries = queries.selectPublishedCreationsByPersonalityMention;
			if (typeof personalityQueries?.all !== "function") {
				return res.status(500).json({ error: "Personality search not available" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 24), 200);
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
			const rows = await personalityQueries.all(personality, { limit: limit + 1, offset });
			const list = Array.isArray(rows) ? rows : [];
			const has_more = list.length > limit;
			const page = has_more ? list.slice(0, limit) : list;

			const images = page.map((img) => {
				const meta = parseCreationMeta(img?.meta);
				const mediaFields = mapCreatedImageRowMediaFields(img, { includeMeta: true });
				const nsfw = !!(meta && meta.nsfw);
				return {
					id: img?.id,
					filename: img?.filename ?? null,
					url: mediaFields.url,
					thumbnail_url: mediaFields.thumbnail_url,
					width: img?.width ?? null,
					height: img?.height ?? null,
					color: img?.color ?? null,
					status: img?.status || "completed",
					created_at: img?.created_at ?? null,
					published: img?.published === 1 || img?.published === true,
					published_at: img?.published_at || null,
					title: img?.title || null,
					description: img?.description || null,
					user_id: img?.user_id ?? null,
					nsfw,
					media_type: mediaFields.media_type,
					video_url: mediaFields.video_url,
					audio_url: mediaFields.audio_url,
					meta: mediaFields.meta
				};
			});

			return res.json({ images, has_more, personality });
		} catch (err) {
			console.error("[personality creations] Error:", err);
			if (!res.headersSent) {
				res.status(500).json({ error: "Unable to load personality creations." });
			}
		}
	});
router.get("/api/tags/:tag/creations", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth?.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const tag = normalizeTag(req.params?.tag);
			if (!tag) {
				return res.status(400).json({ error: "Invalid tag" });
			}
			const tagQueries = queries.selectPublishedCreationsByTagMention;
			if (typeof tagQueries?.all !== "function") {
				return res.status(500).json({ error: "Tag search not available" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 24), 200);
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
			const rows = await tagQueries.all(tag, { limit: limit + 1, offset });
			const list = Array.isArray(rows) ? rows : [];
			const has_more = list.length > limit;
			const page = has_more ? list.slice(0, limit) : list;

			const images = page.map((img) => {
				const meta = parseCreationMeta(img?.meta);
				const mediaFields = mapCreatedImageRowMediaFields(img, { includeMeta: true });
				const nsfw = !!(meta && meta.nsfw);
				return {
					id: img?.id,
					filename: img?.filename ?? null,
					url: mediaFields.url,
					thumbnail_url: mediaFields.thumbnail_url,
					width: img?.width ?? null,
					height: img?.height ?? null,
					color: img?.color ?? null,
					status: img?.status || "completed",
					created_at: img?.created_at ?? null,
					published: img?.published === 1 || img?.published === true,
					published_at: img?.published_at || null,
					title: img?.title || null,
					description: img?.description || null,
					user_id: img?.user_id ?? null,
					nsfw,
					media_type: mediaFields.media_type,
					video_url: mediaFields.video_url,
					audio_url: mediaFields.audio_url,
					meta: mediaFields.meta
				};
			});

			return res.json({ images, has_more, tag });
		} catch (err) {
			console.error("[tag creations] Error:", err);
			if (!res.headersSent) {
				res.status(500).json({ error: "Unable to load tag creations." });
			}
		}
	});
return router;}
