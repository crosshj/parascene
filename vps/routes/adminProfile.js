import express from 'express';import path from 'node:path';import Busboy from 'busboy';import {shouldDeleteOldProfileAvatarKey,storeProcessedProfileAvatar} from '../services/account/profileAvatar.js';import {applySocialFieldUpdates} from '../client/shared/profileSocials.js';import {bumpFeedVersionCounter} from '../services/feed/feedVersion.js';
export default function createAdminProfileRoutes({queries,storage,users}){const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');res.on('finish',()=>{if(req.method!=='GET'&&res.statusCode<400)users?.invalidateCache?.(Number(req.params.id))});next()});
function safeJsonParse(value, fallback) {
		if (value == null) return fallback;
		if (typeof value === "object") return value;
		if (typeof value !== "string") return fallback;
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		try {
			return JSON.parse(trimmed);
		} catch {
			return fallback;
		}
	}
function normalizeProfileRow(row) {
		if (!row) {
			return {
				user_name: null,
				display_name: null,
				about: null,
				socials: {},
				avatar_url: null,
				cover_image_url: null,
				badges: [],
				meta: {},
				created_at: null,
				updated_at: null
			};
		}
		return {
			user_name: row.user_name ?? null,
			display_name: row.display_name ?? null,
			about: row.about ?? null,
			socials: safeJsonParse(row.socials, {}),
			avatar_url: row.avatar_url ?? null,
			cover_image_url: row.cover_image_url ?? null,
			badges: safeJsonParse(row.badges, []),
			meta: safeJsonParse(row.meta, {}),
			created_at: row.created_at ?? null,
			updated_at: row.updated_at ?? null
		};
	}
function normalizeUsername(input) {
		const raw = typeof input === "string" ? input.trim() : "";
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
		return normalized;
	}
async function requireAdmin(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		if (user.role !== 'admin') {
			res.status(403).json({ error: "Forbidden: Admin role required" });
			return null;
		}

		return user;
	}
function buildGenericUrl(key) {
		const segments = String(key || "")
			.split("/")
			.filter(Boolean)
			.map((seg) => encodeURIComponent(seg));
		return `/api/images/generic/${segments.join("/")}`;
	}
function parseMultipart(req, { maxFileBytes = 12 * 1024 * 1024 } = {}) {
		return new Promise((resolve, reject) => {
			const busboy = Busboy({
				headers: req.headers,
				limits: { fileSize: maxFileBytes, files: 2, fields: 50 }
			});
			const fields = {};
			const files = {};
			busboy.on("field", (name, value) => { fields[name] = value; });
			busboy.on("file", (name, file, info) => {
				const { filename, mimeType } = info || {};
				const chunks = [];
				let total = 0;
				file.on("data", (data) => { total += data.length; chunks.push(data); });
				file.on("limit", () => reject(new Error("File too large")));
				file.on("end", () => {
					if (total > 0) {
						files[name] = {
							filename: filename || "",
							mimeType: mimeType || "application/octet-stream",
							buffer: Buffer.concat(chunks)
						};
					}
				});
			});
			busboy.on("error", reject);
			busboy.on("finish", () => resolve({ fields, files }));
			req.pipe(busboy);
		});
	}
function extractGenericKey(url) {
		const raw = typeof url === "string" ? url.trim() : "";
		if (!raw) return null;
		if (!raw.startsWith("/api/images/generic/")) return null;
		const tail = raw.slice("/api/images/generic/".length);
		if (!tail) return null;
		// Decode each path segment to rebuild the storage key safely.
		const segments = tail
			.split("/")
			.filter(Boolean)
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			});
		return segments.join("/");
	}router.post("/admin/users/:id/profile", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		if (!queries.upsertUserProfile?.run) {
			return res.status(500).json({ error: "Profile storage not available" });
		}

		let fields, files;
		try {
			const parsed = await parseMultipart(req);
			fields = parsed.fields;
			files = parsed.files;
		} catch (err) {
			if (err?.code === "FILE_TOO_LARGE" || err?.message === "File too large") {
				return res.status(413).json({ error: "Image too large" });
			}
			return res.status(400).json({ error: "Invalid request", message: err?.message });
		}

		const existingRow = await queries.selectUserProfileByUserId?.get(targetUserId);
		const existingProfile = normalizeProfileRow(existingRow);
		const existingMeta = typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {};

		const avatarRemove = Boolean(fields?.avatar_remove);
		const coverRemove = Boolean(fields?.cover_remove);
		const avatarFile = files?.avatar_file || null;
		const coverFile = files?.cover_file || null;

		const oldAvatarUrl = existingProfile.avatar_url || null;
		const oldCoverUrl = existingProfile.cover_image_url || null;
		const oldAvatarKey = extractGenericKey(oldAvatarUrl);
		const oldCoverKey = extractGenericKey(oldCoverUrl);

		const nextSocialsResult = applySocialFieldUpdates(existingProfile.socials, fields);
		if (!nextSocialsResult.ok) {
			return res.status(400).json({ error: nextSocialsResult.error || "Invalid social link" });
		}
		const nextSocials = nextSocialsResult.socials;

		const character_description = typeof fields?.character_description === "string" ? fields.character_description.trim() || null : (existingMeta.character_description ?? null);
		const nextMeta = { ...existingMeta, character_description };

		let avatar_url = avatarRemove ? null : (oldAvatarUrl || null);
		let cover_image_url = coverRemove ? null : (oldCoverUrl || null);

		const now = Date.now();
		const rand = Math.random().toString(36).slice(2, 9);
		const pendingDeletes = [];

		const storageInst = req.app?.locals?.storage ?? storage;
		if (!storageInst?.uploadGenericImage) {
			return res.status(500).json({ error: "Generic images storage not available" });
		}

		if (!avatarRemove && avatarFile?.buffer?.length) {
			try {
				const storedAvatar = await storeProcessedProfileAvatar(storageInst, targetUserId, avatarFile.buffer);
				avatar_url = storedAvatar.url;
			} catch {
				return res.status(400).json({ error: "Invalid avatar image" });
			}
			if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, targetUserId) && storageInst.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
		} else if (!avatarRemove && !avatarFile?.buffer?.length) {
			const tryUrl = typeof fields?.avatar_try_url === "string" ? fields.avatar_try_url.trim() : "";
			const tryPrefix = "/api/try/images/";
			if (tryUrl.startsWith(tryPrefix)) {
				const afterPrefix = tryUrl.slice(tryPrefix.length);
				const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
				if (filename && !filename.includes("..") && !filename.includes("/") && storageInst.getImageBufferAnon) {
					try {
						const buffer = await storageInst.getImageBufferAnon(filename);
						const storedAvatar = await storeProcessedProfileAvatar(storageInst, targetUserId, buffer);
						avatar_url = storedAvatar.url;
						if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, targetUserId) && storageInst.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
						if (queries.selectCreatedImageAnonByFilename?.get && queries.deleteCreatedImageAnon?.run && storageInst.deleteImageAnon) {
							try {
								const anonRow = await queries.selectCreatedImageAnonByFilename.get(filename);
								if (anonRow?.id) {
									await queries.deleteCreatedImageAnon.run(anonRow.id);
									await storageInst.deleteImageAnon(filename);
								}
							} catch {
								// ignore
							}
						}
					} catch {
						// non-fatal
					}
				}
			}
		}
		if (avatarRemove && oldAvatarKey && storageInst.deleteGenericImage) {
			pendingDeletes.push(oldAvatarKey);
		}

		if (!coverRemove && coverFile?.buffer?.length) {
			const ext = path.extname(coverFile.filename) || ".png";
			const key = `profile/${targetUserId}/cover_${now}_${rand}${ext}`;
			const stored = await storageInst.uploadGenericImage(coverFile.buffer, key, {
				contentType: coverFile.mimeType
			});
			cover_image_url = buildGenericUrl(stored ?? key);
			if (oldCoverKey && storageInst.deleteGenericImage) pendingDeletes.push(oldCoverKey);
		} else if (coverRemove && oldCoverKey && storageInst.deleteGenericImage) {
			pendingDeletes.push(oldCoverKey);
		}

		const payload = {
			user_name: existingProfile.user_name ?? null,
			display_name: typeof fields?.display_name === "string" ? fields.display_name.trim() || null : existingProfile.display_name,
			about: typeof fields?.about === "string" ? fields.about.trim() || null : existingProfile.about,
			socials: nextSocials,
			avatar_url,
			cover_image_url,
			badges: Array.isArray(existingProfile.badges) ? existingProfile.badges : [],
			meta: nextMeta
		};

		await queries.upsertUserProfile.run(targetUserId, payload);

		if (storageInst.deleteGenericImage && pendingDeletes.length > 0) {
			for (const k of pendingDeletes) {
				try {
					await storageInst.deleteGenericImage(k);
				} catch {
					// ignore
				}
			}
		}

		const updated = await queries.selectUserProfileByUserId?.get(targetUserId);
		return res.json({ ok: true, profile: normalizeProfileRow(updated) });
	});
return router;}
