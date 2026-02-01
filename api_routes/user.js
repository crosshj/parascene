import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Busboy from "busboy";
import path from "path";
import sharp from "sharp";
import {
	COOKIE_NAME,
	ONE_WEEK_MS,
	clearAuthCookie,
	getJwtSecret,
	hashToken,
	setAuthCookie,
	shouldLogSession
} from "./auth.js";
import { getThumbnailUrl } from "./utils/url.js";
import { computeWelcome, WELCOME_VERSION } from "./utils/welcome.js";

export default function createProfileRoutes({ queries }) {
	const router = express.Router();

	function getTipperDisplayName(user) {
		const name =
			typeof user?.name === "string"
				? user.name.trim()
				: typeof user?.display_name === "string"
					? user.display_name.trim()
					: "";
		if (name) return name;
		const email = String(user?.email || "").trim();
		const localPart = email.includes("@") ? email.split("@")[0] : email;
		return `@${localPart || "user"}`;
	}

	function sanitizeReturnUrl(raw) {
		const value = typeof raw === "string" ? raw.trim() : "";
		if (!value) return "/";
		if (!value.startsWith("/")) return "/";
		if (value.startsWith("//")) return "/";
		if (value.includes("://")) return "/";
		if (value.includes("\n") || value.includes("\r")) return "/";
		if (value.length > 2048) return "/";
		return value;
	}

	function getReturnUrl(req) {
		const bodyValue = req?.body?.returnUrl;
		const queryValue = req?.query?.returnUrl;
		return sanitizeReturnUrl(typeof bodyValue === "string" ? bodyValue : (typeof queryValue === "string" ? queryValue : ""));
	}

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

	function normalizeUsername(input) {
		const raw = typeof input === "string" ? input.trim() : "";
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		// Simple, stable public handle rules (expand later if needed)
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
		return normalized;
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

	async function suggestAvailableUsername({ base, userId } = {}) {
		const normalizedBase = normalizeUsername(base);
		if (!normalizedBase) return null;

		// Fast path: available already
		if (queries.selectUserProfileByUsername?.get) {
			const existing = await queries.selectUserProfileByUsername.get(normalizedBase);
			if (!existing || Number(existing.user_id) === Number(userId)) {
				return normalizedBase;
			}
		} else {
			// If we can't check availability, just return the base.
			return normalizedBase;
		}

		// Suffix probing: john_1, john_2, ...
		for (let i = 1; i <= 200; i++) {
			const suffix = `_${i}`;
			const maxBaseLen = 24 - suffix.length;
			let candidateBase = normalizedBase.slice(0, Math.max(1, maxBaseLen));
			candidateBase = candidateBase.replace(/_+$/g, "");
			if (!candidateBase) candidateBase = "user";
			const candidate = normalizeUsername(`${candidateBase}${suffix}`);
			if (!candidate) continue;

			const existing = await queries.selectUserProfileByUsername.get(candidate);
			if (!existing || Number(existing.user_id) === Number(userId)) {
				return candidate;
			}
		}

		return null;
	}

	function extractGenericKey(url) {
		const raw = typeof url === "string" ? url.trim() : "";
		if (!raw) return null;
		if (!raw.startsWith("/api/images/generic/")) return null;
		const tail = raw.slice("/api/images/generic/".length);
		if (!tail) return null;
		// Decode each path segment to rebuild the storage key safely.
		const segments = tail.split("/").filter(Boolean).map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		});
		return segments.join("/");
	}

	function buildGenericUrl(key) {
		const segments = String(key || "")
			.split("/")
			.filter(Boolean)
			.map((seg) => encodeURIComponent(seg));
		return `/api/images/generic/${segments.join("/")}`;
	}

	function parseJsonField(raw, fallback, errorMessage) {
		if (raw == null || raw === "") return fallback;
		if (typeof raw === "object") return raw;
		if (typeof raw !== "string") return fallback;
		try {
			return JSON.parse(raw);
		} catch {
			const err = new Error(errorMessage || "Invalid JSON");
			err.code = "INVALID_JSON";
			throw err;
		}
	}

	function parseMultipart(req, { maxFileBytes = 12 * 1024 * 1024 } = {}) {
		return new Promise((resolve, reject) => {
			const busboy = Busboy({
				headers: req.headers,
				limits: {
					fileSize: maxFileBytes,
					files: 2,
					fields: 50
				}
			});

			const fields = {};
			const files = {};

			busboy.on("field", (name, value) => {
				fields[name] = value;
			});

			busboy.on("file", (name, file, info) => {
				const { filename, mimeType } = info || {};
				const chunks = [];
				let total = 0;

				file.on("data", (data) => {
					total += data.length;
					chunks.push(data);
				});

				file.on("limit", () => {
					const err = new Error("File too large");
					err.code = "FILE_TOO_LARGE";
					reject(err);
				});

				file.on("end", () => {
					if (total === 0) return;
					files[name] = {
						filename: filename || "",
						mimeType: mimeType || "application/octet-stream",
						buffer: Buffer.concat(chunks)
					};
				});
			});

			busboy.on("error", (error) => reject(error));
			busboy.on("finish", () => resolve({ fields, files }));

			req.pipe(busboy);
		});
	}

	router.post("/signup", async (req, res) => {
		const email = String(req.body.username || req.body.email || "")
			.trim()
			.toLowerCase();
		const password = String(req.body.password || "");
		const returnUrl = getReturnUrl(req);

		if (!email || !password) {
			return res.status(400).send("Email and password are required.");
		}

		const existingUser = await queries.selectUserByEmail.get(email);
		if (existingUser) {
			return res.status(409).send("Email already registered.");
		}

		const passwordHash = bcrypt.hashSync(password, 12);
		const info = await queries.insertUser.run(email, passwordHash, "consumer");
		// Support both insertId (standardized) and lastInsertRowid (legacy SQLite)
		const userId = info.insertId || info.lastInsertRowid;

		// Initialize credits for new user with 100 starting credits
		try {
			await queries.insertUserCredits.run(userId, 100, null);
		} catch (error) {
			// console.error(`[Signup] Failed to initialize credits for user ${userId}:`, {
			// 	error: error.message,
			// 	stack: error.stack,
			// 	name: error.name
			// });
			// Don't fail signup if credits initialization fails
		}

		const token = jwt.sign({ userId }, getJwtSecret(), { expiresIn: "7d" });
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			if (shouldLogSession()) {
				// console.log(`[Signup] Creating session for new user ${userId}, expires at: ${expiresAt}`);
			}
			try {
				await queries.insertSession.run(userId, tokenHash, expiresAt);
				if (shouldLogSession()) {
					// console.log(`[Signup] Session created successfully for user ${userId}`);
				}
			} catch (error) {
				if (shouldLogSession()) {
					// console.error(`[Signup] Failed to create session for user ${userId}:`, {
					// 	error: error.message,
					// 	stack: error.stack,
					// 	name: error.name
					// });
				}
				// Don't fail signup if session creation fails - cookie is still set
			}
		}

		return res.redirect(returnUrl || "/");
	});

	router.post("/login", async (req, res) => {
		const email = String(req.body.username || req.body.email || "")
			.trim()
			.toLowerCase();
		const password = String(req.body.password || "");
		const returnUrl = getReturnUrl(req);

		if (!email || !password) {
			return res.status(400).send("Email and password are required.");
		}

		const user = await queries.selectUserByEmail.get(email);
		if (!user || !bcrypt.compareSync(password, user.password_hash)) {
			const qs = new URLSearchParams();
			if (returnUrl && returnUrl !== "/") {
				qs.set("returnUrl", returnUrl);
			}
			const queryString = qs.toString();
			const url = queryString ? `/auth.html?${queryString}#fail` : "/auth.html#fail";
			return res.redirect(url);
		}

		const token = jwt.sign({ userId: user.id }, getJwtSecret(), {
			expiresIn: "7d"
		});
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			if (shouldLogSession()) {
				// console.log(`[Login] Creating session for user ${user.id}, expires at: ${expiresAt}`);
			}
			try {
				await queries.insertSession.run(user.id, tokenHash, expiresAt);
				if (shouldLogSession()) {
					// console.log(`[Login] Session created successfully for user ${user.id}`);
				}
			} catch (error) {
				if (shouldLogSession()) {
					// console.error(`[Login] Failed to create session for user ${user.id}:`, {
					// 	error: error.message,
					// 	stack: error.stack,
					// 	name: error.name
					// });
				}
				// Don't fail login if session creation fails - cookie is still set
			}
		}
		return res.redirect(returnUrl || "/");
	});

	router.post("/logout", async (req, res) => {
		if (queries.deleteSessionByTokenHash) {
			const token = req.cookies?.[COOKIE_NAME];
			if (token) {
				const tokenHash = hashToken(token);
				await queries.deleteSessionByTokenHash.run(
					tokenHash,
					req.auth?.userId
				);
			}
		}
		clearAuthCookie(res, req);
		res.redirect("/auth");
	});

	router.get("/me", (req, res) => {
		res.json({ userId: req.auth?.userId || null });
	});

	// Username availability helper (used by /welcome)
	router.get("/api/username-suggest", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const raw = req.query?.user_name ?? req.query?.username ?? "";
		const base = typeof raw === "string" ? raw.trim() : "";
		const normalizedBase = normalizeUsername(base);
		if (!normalizedBase) {
			return res.status(400).json({
				error: "Invalid username",
				message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
			});
		}

		const suggested = await suggestAvailableUsername({ base: normalizedBase, userId: req.auth.userId });
		if (!suggested) {
			return res.status(409).json({
				error: "No usernames available",
				message: "Unable to suggest an available username. Please try a different one."
			});
		}

		return res.json({
			ok: true,
			input: normalizedBase,
			suggested,
			available: suggested === normalizedBase
		});
	});

	router.get("/api/profile", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const profileRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
		const profile = normalizeProfileRow(profileRow);
		const welcome = computeWelcome({ profileRow });

		// Get credits balance
		let credits = await queries.selectUserCredits.get(req.auth.userId);
		// If no credits record exists, initialize with 100 for existing users
		if (!credits) {
			try {
				await queries.insertUserCredits.run(req.auth.userId, 100, null);
				credits = { balance: 100 };
			} catch (error) {
				// console.error(`[Profile] Failed to initialize credits for user ${req.auth.userId}:`, error);
				credits = { balance: 0 };
			}
		}

		return res.json({ ...user, credits: credits.balance, profile, welcome });
	});

	// Update current user's profile (user_profiles table)
	router.put("/api/profile", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const existingUserName = typeof existingProfile.user_name === "string"
				? existingProfile.user_name.trim()
				: "";

			const rawUserName = req.body?.user_name ?? req.body?.username;
			const userName = normalizeUsername(rawUserName);
			const hasExistingUserName = Boolean(existingUserName);
			const hasUserNameInput = rawUserName !== undefined && rawUserName !== null;
			if (hasExistingUserName && hasUserNameInput) {
				// Username is permanent once set (admin override is a separate endpoint).
				if (!userName || userName !== existingUserName) {
					return res.status(409).json({
						error: "Username is permanent",
						message: "Username cannot be changed after it is set."
					});
				}
			} else if (typeof rawUserName === "string" && !userName) {
				return res.status(400).json({
					error: "Invalid username",
					message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
				});
			}

			// Enforce uniqueness if username provided
			if (!hasExistingUserName && userName && queries.selectUserProfileByUsername?.get) {
				const existing = await queries.selectUserProfileByUsername.get(userName);
				if (existing && Number(existing.user_id) !== Number(req.auth.userId)) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			const requestedMeta = typeof req.body?.meta === "object" && req.body.meta && !Array.isArray(req.body.meta)
				? req.body.meta
				: null;
			const nextMeta = {
				...(typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {}),
				...(requestedMeta || {})
			};

			const finalUserName = hasExistingUserName
				? existingUserName
				: userName;

			if (finalUserName) {
				const legacy = nextMeta?.["onb_version"];
				const prev = Number(nextMeta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				nextMeta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete nextMeta["onb_version"];
			}

			const payload = {
				user_name: finalUserName,
				display_name: typeof req.body?.display_name === "string" ? req.body.display_name.trim() : null,
				about: typeof req.body?.about === "string" ? req.body.about.trim() : null,
				socials: typeof req.body?.socials === "object" && req.body.socials ? req.body.socials : {},
				avatar_url: typeof req.body?.avatar_url === "string" ? req.body.avatar_url.trim() : null,
				cover_image_url: typeof req.body?.cover_image_url === "string" ? req.body.cover_image_url.trim() : null,
				badges: Array.isArray(req.body?.badges) ? req.body.badges : [],
				meta: nextMeta
			};

			if (!queries.upsertUserProfile?.run) {
				return res.status(500).json({ error: "Profile storage not available" });
			}

			await queries.upsertUserProfile.run(req.auth.userId, payload);
			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);
			return res.json({ ok: true, profile });
		} catch (error) {
			// console.error("Error updating profile:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Update current user's profile via multipart form (server uploads images and deletes previous)
	router.post("/api/profile", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			if (!queries.upsertUserProfile?.run) {
				return res.status(500).json({ error: "Profile storage not available" });
			}

			const { fields, files } = await parseMultipart(req);

			const rawUserName = fields?.user_name ?? fields?.username;
			const userName = normalizeUsername(rawUserName);
			if (typeof rawUserName === "string" && rawUserName.trim() && !userName) {
				return res.status(400).json({
					error: "Invalid username",
					message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
				});
			}

			if (userName && queries.selectUserProfileByUsername?.get) {
				const existing = await queries.selectUserProfileByUsername.get(userName);
				if (existing && Number(existing.user_id) !== Number(req.auth.userId)) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const existingUserName = typeof existingProfile.user_name === "string"
				? existingProfile.user_name.trim()
				: "";
			const hasExistingUserName = Boolean(existingUserName);
			const hasUserNameInput = rawUserName !== undefined && rawUserName !== null && String(rawUserName).trim() !== "";
			if (hasExistingUserName && hasUserNameInput) {
				if (!userName || userName !== existingUserName) {
					return res.status(409).json({
						error: "Username is permanent",
						message: "Username cannot be changed after it is set."
					});
				}
			}

			const avatarRemove = Boolean(fields?.avatar_remove);
			const coverRemove = Boolean(fields?.cover_remove);
			const avatarFile = files?.avatar_file || null;
			const coverFile = files?.cover_file || null;

			const oldAvatarUrl = existingProfile.avatar_url || null;
			const oldCoverUrl = existingProfile.cover_image_url || null;
			const oldAvatarKey = extractGenericKey(oldAvatarUrl);
			const oldCoverKey = extractGenericKey(oldCoverUrl);

			const nextSocials = {
				...(typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {})
			};
			if (typeof fields?.social_website === "string") {
				const website = fields.social_website.trim();
				if (website) nextSocials.website = website;
				else delete nextSocials.website;
			}

			const badges = parseJsonField(fields?.badges, existingProfile.badges || [], "Badges must be valid JSON.");
			if (!Array.isArray(badges)) {
				return res.status(400).json({ error: "Badges must be a JSON array" });
			}
			const meta = parseJsonField(fields?.meta, existingProfile.meta || {}, "Meta must be valid JSON.");
			if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
				return res.status(400).json({ error: "Meta must be a JSON object" });
			}
			if (hasExistingUserName) {
				const legacy = meta?.["onb_version"];
				const prev = Number(meta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				meta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete meta["onb_version"];
			} else if (userName) {
				const legacy = meta?.["onb_version"];
				const prev = Number(meta.welcome_version ?? legacy);
				const prevVersion = Number.isFinite(prev) ? prev : 0;
				meta.welcome_version = Math.max(prevVersion, WELCOME_VERSION);
				delete meta["onb_version"];
			}

			let avatar_url = avatarRemove ? null : (oldAvatarUrl || null);
			let cover_image_url = coverRemove ? null : (oldCoverUrl || null);

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);

			const pendingDeletes = [];

			const storage = req.app?.locals?.storage;
			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			if (!avatarRemove && avatarFile?.buffer?.length) {
				let resized;
				try {
					resized = await sharp(avatarFile.buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
				} catch {
					return res.status(400).json({ error: "Invalid avatar image" });
				}
				const key = `profile/${req.auth.userId}/avatar_${now}_${rand}.png`;
				const stored = await storage.uploadGenericImage(resized, key, {
					contentType: "image/png"
				});
				avatar_url = buildGenericUrl(stored);
				if (oldAvatarKey && storage.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
			} else if (avatarRemove && oldAvatarKey && storage.deleteGenericImage) {
				pendingDeletes.push(oldAvatarKey);
			}

			if (!coverRemove && coverFile?.buffer?.length) {
				const ext = path.extname(coverFile.filename) || ".png";
				const key = `profile/${req.auth.userId}/cover_${now}_${rand}${ext}`;
				const stored = await storage.uploadGenericImage(coverFile.buffer, key, {
					contentType: coverFile.mimeType
				});
				cover_image_url = buildGenericUrl(stored);
				if (oldCoverKey && storage.deleteGenericImage) pendingDeletes.push(oldCoverKey);
			} else if (coverRemove && oldCoverKey && storage.deleteGenericImage) {
				pendingDeletes.push(oldCoverKey);
			}

			const payload = {
				user_name: hasExistingUserName ? existingUserName : (userName || null),
				display_name: typeof fields?.display_name === "string" ? fields.display_name.trim() : existingProfile.display_name || null,
				about: typeof fields?.about === "string" ? fields.about.trim() : existingProfile.about || null,
				socials: nextSocials,
				avatar_url,
				cover_image_url,
				badges,
				meta
			};

			await queries.upsertUserProfile.run(req.auth.userId, payload);
			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);

			// Best-effort delete old images after profile update.
			if (storage.deleteGenericImage && pendingDeletes.length > 0) {
				for (const key of pendingDeletes) {
					try {
						await storage.deleteGenericImage(key);
					} catch (error) {
						// console.warn("Failed to delete previous profile image:", error?.message || error);
					}
				}
			}

			return res.json({ ok: true, profile });
		} catch (error) {
			if (error?.code === "FILE_TOO_LARGE") {
				return res.status(413).json({ error: "Image too large" });
			}
			if (error?.code === "INVALID_JSON") {
				return res.status(400).json({ error: error.message || "Invalid JSON" });
			}
			// console.error("Error updating profile (multipart):", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Public-ish profile summary (auth required for now)
	router.get("/api/users/:id/profile", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const targetUserId = Number.parseInt(req.params.id, 10);
			if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
				return res.status(400).json({ error: "Invalid user id" });
			}

			const target = await queries.selectUserById.get(targetUserId);
			if (!target) {
				return res.status(404).json({ error: "User not found" });
			}

			const emailPrefix = (() => {
				const email = String(target?.email || "").trim();
				if (!email) return null;
				const local = email.includes("@") ? email.split("@")[0] : email;
				const trimmed = local.trim();
				return trimmed || null;
			})();

			const isSelf = Number(targetUserId) === Number(req.auth.userId);
			const profileRow = await queries.selectUserProfileByUserId?.get(targetUserId);
			const profile = normalizeProfileRow(profileRow);

			const allCountRow = await queries.selectAllCreatedImageCountForUser?.get(targetUserId);
			const publishedCountRow = await queries.selectPublishedCreatedImageCountForUser?.get(targetUserId);
			const likesCountRow = await queries.selectLikesReceivedForUserPublished?.get(targetUserId);

			const stats = {
				creations_total: Number(allCountRow?.count ?? 0),
				creations_published: Number(publishedCountRow?.count ?? 0),
				likes_received: Number(likesCountRow?.count ?? 0),
				member_since: target.created_at ?? null
			};

			const viewerFollowsRow = isSelf
				? null
				: queries.selectUserFollowStatus?.get
					? await queries.selectUserFollowStatus.get(req.auth.userId, targetUserId)
					: null;
			const viewerFollows = Boolean(viewerFollowsRow?.viewer_follows);

			const publicUser = isSelf
				? { id: target.id, email: target.email, role: target.role, created_at: target.created_at }
				: { id: target.id, role: target.role, created_at: target.created_at, email_prefix: emailPrefix };

			return res.json({
				user: publicUser,
				profile,
				stats,
				is_self: isSelf,
				viewer_follows: viewerFollows
			});
		} catch (error) {
			// console.error("Error loading user profile summary:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// Created images for a user (published-only unless viewer is owner and include=all)
	router.get("/api/users/:id/created-images", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const targetUserId = Number.parseInt(req.params.id, 10);
			if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
				return res.status(400).json({ error: "Invalid user id" });
			}

			const target = await queries.selectUserById.get(targetUserId);
			if (!target) {
				return res.status(404).json({ error: "User not found" });
			}

			const isSelf = Number(targetUserId) === Number(req.auth.userId);
			const isAdmin = viewer?.role === 'admin';
			const include = String(req.query?.include || "").toLowerCase();
			const wantAll = include === "all";

			let images = [];
			if ((isSelf || isAdmin) && wantAll && queries.selectCreatedImagesForUser?.all) {
				images = await queries.selectCreatedImagesForUser.all(targetUserId);
			} else if (queries.selectPublishedCreatedImagesForUser?.all) {
				images = await queries.selectPublishedCreatedImagesForUser.all(targetUserId);
			} else if (queries.selectCreatedImagesForUser?.all) {
				// Fallback: filter in memory
				const all = await queries.selectCreatedImagesForUser.all(targetUserId);
				images = Array.isArray(all) ? all.filter((img) => img?.published === 1 || img?.published === true) : [];
			}

			const mapped = (Array.isArray(images) ? images : []).map((img) => {
				const url = img.file_path || (img.filename ? `/api/images/created/${img.filename}` : null);
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: getThumbnailUrl(url),
					width: img.width,
					height: img.height,
					color: img.color,
					status: img.status || "completed",
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null
				};
			});

			return res.json({ images: mapped, is_self: isSelf, scope: isSelf && wantAll ? "all" : "published" });
		} catch (error) {
			// console.error("Error loading user created images:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/notifications", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const notifications = await queries.selectNotificationsForUser.all(
				user.id,
				user.role
			);
			return res.json({ notifications });
		} catch (error) {
			// console.error("Error loading notifications:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/notifications/unread-count", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.json({ count: 0 });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.json({ count: 0 });
			}

			const result = await queries.selectUnreadNotificationCount.get(
				user.id,
				user.role
			);
			return res.json({ count: result?.count ?? 0 });
		} catch (error) {
			// console.error("Error loading unread notification count:", error);
			return res.json({ count: 0 });
		}
	});

	router.post("/api/notifications/acknowledge", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const id = Number(req.body?.id);
			if (!id) {
				return res.status(400).json({ error: "Notification id required" });
			}

			const result = await queries.acknowledgeNotificationById.run(
				id,
				user.id,
				user.role
			);
			return res.json({ ok: true, updated: result.changes });
		} catch (error) {
			// console.error("Error acknowledging notification:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/credits", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const credits = await queries.selectUserCredits.get(req.auth.userId);

			// If no credits record exists, initialize with 100
			if (!credits) {
				try {
					await queries.insertUserCredits.run(req.auth.userId, 100, null);
					const newCredits = await queries.selectUserCredits.get(req.auth.userId);
					return res.json({
						balance: newCredits.balance,
						canClaim: true,
						lastClaimDate: null
					});
				} catch (error) {
					// console.error("Error initializing credits:", error);
					return res.status(500).json({ error: "Internal server error" });
				}
			}

			// Check if can claim (last claim was not today in UTC)
			const canClaim = (() => {
				if (!credits.last_daily_claim_at) return true;
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const lastClaimDate = new Date(credits.last_daily_claim_at);
				const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
				return lastClaimUTC.getTime() < todayUTC.getTime();
			})();

			return res.json({
				balance: credits.balance,
				canClaim,
				lastClaimDate: credits.last_daily_claim_at
			});
		} catch (error) {
			// console.error("Error loading credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/claim", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const result = await queries.claimDailyCredits.run(req.auth.userId, 10);

			if (!result.success) {
				return res.status(400).json({
					success: false,
					balance: result.balance,
					message: result.message || "Daily credits already claimed today"
				});
			}

			return res.json({
				success: true,
				balance: result.balance,
				message: "Daily credits claimed successfully"
			});
		} catch (error) {
			// console.error("Error claiming daily credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/tip", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			if (!queries.transferCredits?.run) {
				return res.status(500).json({ error: "Credits transfer not available" });
			}

			const fromUserId = Number(req.auth.userId);
			const toUserId = Number(req.body?.toUserId);
			const rawAmount = Number(req.body?.amount);
			const amount = Math.round(rawAmount * 10) / 10;

			if (!Number.isFinite(toUserId) || toUserId <= 0) {
				return res.status(400).json({ error: "Invalid recipient user id" });
			}
			if (!Number.isFinite(amount) || amount <= 0) {
				return res.status(400).json({ error: "Invalid amount" });
			}
			if (toUserId === fromUserId) {
				return res.status(400).json({ error: "Cannot tip yourself" });
			}

			const sender = await queries.selectUserById.get(fromUserId);
			if (!sender) {
				return res.status(404).json({ error: "User not found" });
			}

			const recipient = await queries.selectUserById.get(toUserId);
			if (!recipient) {
				return res.status(404).json({ error: "Recipient not found" });
			}

			let transferResult;
			try {
				transferResult = await queries.transferCredits.run(fromUserId, toUserId, amount);
			} catch (error) {
				const message = String(error?.message || "");
				const code = error?.code || "";
				const isInsufficient =
					code === "INSUFFICIENT_CREDITS" ||
					message.toLowerCase().includes("insufficient");
				if (isInsufficient) {
					return res.status(400).json({ error: "Insufficient credits" });
				}
				const isSelfTip = message.toLowerCase().includes("tip yourself");
				if (isSelfTip) {
					return res.status(400).json({ error: "Cannot tip yourself" });
				}
				// console.error("Error transferring credits:", error);
				return res.status(500).json({ error: "Internal server error" });
			}

			// Best-effort notification (no link, no new tables)
			try {
				if (queries.insertNotification?.run) {
					const tipperName = getTipperDisplayName(sender);
					const title = "You received a tip";
					const message = `${tipperName} tipped you ${amount.toFixed(1)} credits.`;
					await queries.insertNotification.run(toUserId, null, title, message, null);
				}
			} catch (error) {
				// console.error("Failed to insert tip notification:", error);
				// do not fail the transfer
			}

			const fromBalance =
				transferResult && typeof transferResult.fromBalance === "number"
					? transferResult.fromBalance
					: transferResult && typeof transferResult.from_balance === "number"
						? transferResult.from_balance
						: null;
			const toBalance =
				transferResult && typeof transferResult.toBalance === "number"
					? transferResult.toBalance
					: transferResult && typeof transferResult.to_balance === "number"
						? transferResult.to_balance
						: null;

			return res.json({
				success: true,
				fromBalance,
				toBalance
			});
		} catch (error) {
			// console.error("Error tipping credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
