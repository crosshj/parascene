import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import Busboy from 'busboy';
import path from 'node:path';
import {shouldDeleteOldProfileAvatarKey,storeProcessedProfileAvatar} from '../services/account/profileAvatar.js';
import {bumpFeedVersionCounter} from '../services/feed/feedVersion.js';
import {getThumbnailUrl} from '../services/create/url.js';
import {mapCreatedImageRowMediaFields} from '../services/create/resolveCreationDisplayMedia.js';
import {parseCreationMeta} from '../services/create/resolveCreatedImageStorageFilename.js';
import {computeWelcome,WELCOME_VERSION} from '../services/account/welcome.js';
import {getClientIdFromRequest,mergePrsnCidsIntoProfileMeta,prsnCidFromMeta} from '../services/account/prsnCids.js';
import {appendPrsnCidsForUserId,tryRequestMetaFromRow} from '../services/account/userPrsnCids.js';
import {applySocialFieldUpdates,applySocialObjectUpdates} from '../client/shared/profileSocials.js';
import {creationMetaHasChallengeSubmission} from '../client/shared/challengeSubmitMeta.js';
import {enrichCreationComments} from '../db/creations.js';
export default function createProfileRoutes({queries,storage:storageAdapter,users,client}) {
async function getReactionsForCommentIds(_queries,ids,viewerId){return new Map((await enrichCreationComments(client,ids.map(id=>({id})),viewerId)).map(row=>[Number(row.id),row]));}

	const router = express.Router();
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');res.on('finish',()=>{if(req.auth?.userId&&req.method!=='GET'&&res.statusCode<400)users?.invalidateCache?.(req.auth.userId)});next()});

	function sanitizeUserMetaForClient(meta) {
		if (!meta || typeof meta !== "object") return meta;
		const {
			apiKeyHash: _h,
			vynlyBearerToken: _v,
			presence_last_seen_at: _p,
			appear_offline: _a,
			chat_private_keys: _c,
			...rest
		} = meta;
		return rest;
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
				character_description: null,
				socials: {},
				avatar_url: null,
				cover_image_url: null,
				badges: [],
				meta: {},
				prsn_cids: [],
				created_at: null,
				updated_at: null
			};
		}
		const meta = safeJsonParse(row.meta, {});
		const prsn_cids = Array.isArray(meta.prsn_cids)
			? [...new Set(meta.prsn_cids.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))]
			: [];
		return {
			user_name: row.user_name ?? null,
			display_name: row.display_name ?? null,
			about: row.about ?? null,
			character_description: typeof meta.character_description === "string" ? meta.character_description : null,
			socials: safeJsonParse(row.socials, {}),
			avatar_url: row.avatar_url ?? null,
			cover_image_url: row.cover_image_url ?? null,
			badges: safeJsonParse(row.badges, []),
			meta,
			prsn_cids,
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

	async function resolveTargetUserFromParams(req, { allowUsername = false } = {}) {
		if (allowUsername && typeof req.params?.username === "string" && req.params.username.trim()) {
			// Public /p/:username routes also address persona slugs, which may contain
			// hyphens. Keep account mutation rules in normalizeUsername unchanged, but
			// allow this read-only lookup to return 404 so the client can resolve a
			// matching Library persona after the user lookup misses.
			const normalizedUserName = req.params.username.trim().toLowerCase();
			if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalizedUserName)) {
				return { error: { status: 400, body: { error: "Invalid username" } } };
			}
			if (!queries.selectUserProfileByUsername?.get) {
				return { error: { status: 500, body: { error: "Username lookup unavailable" } } };
			}
			const profile = await queries.selectUserProfileByUsername.get(normalizedUserName);
			const targetUserId = Number.parseInt(String(profile?.user_id ?? ""), 10);
			if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
				return { error: { status: 404, body: { error: "User not found" } } };
			}
			const target = await queries.selectUserById.get(targetUserId);
			if (!target) {
				return { error: { status: 404, body: { error: "User not found" } } };
			}
			return { targetUserId, target };
		}

		const targetUserId = Number.parseInt(String(req.params?.id ?? ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return { error: { status: 400, body: { error: "Invalid user id" } } };
		}
		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return { error: { status: 404, body: { error: "User not found" } } };
		}
		return { targetUserId, target };
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

	async function bumpFeedAfterAvatarChange() {
		try {
			await bumpFeedVersionCounter(queries);
		} catch {
			// ignore
		}
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
router.get("/api/users/usernames", async (req, res) => {
		try {
			if (!queries.selectPublicUsernames?.all) {
				return res.status(500).json({ error: "Username list unavailable" });
			}

			const rows = await queries.selectPublicUsernames.all();
			const usernames = (Array.isArray(rows) ? rows : [])
				.map((row) => (typeof row?.user_name === "string" ? row.user_name.trim() : ""))
				.filter(Boolean);
			const personaRows = queries.selectPublicPersonaUsernames?.all
				? await queries.selectPublicPersonaUsernames.all()
				: [];
			const personas = (Array.isArray(personaRows) ? personaRows : [])
				.map((row) => (typeof row?.user_name === "string" ? row.user_name.trim() : ""))
				.filter(Boolean);

			res.set("Cache-Control", "public, max-age=300");
			return res.json({ usernames, personas });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	});
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

		// Client ids: merge runs in `prsnCidPersistMiddleware` (throttled + skip static assets) and on login/signup / profile saves.

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

		const plan = user.meta?.plan ?? "free";
		const pendingPlanActivation = Boolean(user.meta?.pendingCheckoutSessionId);
		const enableNsfw = user.meta?.enableNsfw === true;
		const showOwnPostsInFeed = user.meta?.showOwnPostsInFeed === true;
		const audibleNotifications = user.meta?.audibleNotifications !== false;
		const hasApiKey = Boolean(user.meta?.apiKeyHash);
		const apiKeyPrefix = typeof user.meta?.apiKeyPrefix === "string" ? user.meta.apiKeyPrefix : null;
		const hasVynlyToken = Boolean(
			user.meta && typeof user.meta.vynlyBearerToken === "string" && user.meta.vynlyBearerToken.trim()
		);
		const vynlyTokenPrefix =
			typeof user.meta?.vynlyTokenPrefix === "string" && user.meta.vynlyTokenPrefix.trim()
				? user.meta.vynlyTokenPrefix.trim()
				: null;
		const appearOffline = user.meta?.appear_offline === true;
		const forceLegacyFeed = user.meta?.forceLegacyFeed === true;
		const metaPublic = sanitizeUserMetaForClient(user.meta);
		return res.json({
			...user,
			meta: metaPublic,
			credits: credits.balance,
			plan,
			pendingPlanActivation,
			profile,
			welcome,
			enableNsfw,
			showOwnPostsInFeed,
			audibleNotifications,
			forceLegacyFeed,
			hasApiKey,
			apiKeyPrefix,
			hasVynlyToken,
			vynlyTokenPrefix,
			appear_offline: appearOffline
		});
	});
router.put("/api/profile/vynly-token", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(403).json({
				error: "Forbidden",
				message: "Manage your Vynly token while signed in on the website."
			});
		}
		if (!queries.updateUserVynlyBearerToken?.run) {
			return res.status(500).json({ error: "Not available", message: "Profile storage is not available." });
		}
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const raw = typeof body.token === "string" ? body.token.trim() : "";
		if (raw === "") {
			try {
				await queries.updateUserVynlyBearerToken.run(req.auth.userId, { bearerToken: "", tokenPrefix: "" });
				return res.json({ ok: true, hasVynlyToken: false, vynlyTokenPrefix: null });
			} catch (err) {
				console.error("[PUT /api/profile/vynly-token]", err);
				return res.status(500).json({ error: "Failed to clear token", message: err?.message || "Could not update." });
			}
		}
		if (!/^vln_[A-Za-z0-9_.-]+$/.test(raw)) {
			return res.status(400).json({
				error: "Invalid token",
				message: "Use your Vynly token from Settings or https://vynly.co/agents — it should start with vln_."
			});
		}
		const tokenPrefix = raw.length <= 12 ? `${raw}…` : `${raw.slice(0, 10)}…`;
		try {
			await queries.updateUserVynlyBearerToken.run(req.auth.userId, { bearerToken: raw, tokenPrefix });
			return res.json({ ok: true, hasVynlyToken: true, vynlyTokenPrefix: tokenPrefix });
		} catch (err) {
			console.error("[PUT /api/profile/vynly-token]", err);
			return res.status(500).json({ error: "Failed to save token", message: err?.message || "Could not update." });
		}
	});
router.post("/api/profile/api-key", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(403).json({
				error: "Forbidden",
				message: "Manage API keys while signed in on the website."
			});
		}
		if (!queries.updateUserApiKey?.run) {
			return res.status(500).json({ error: "Not available", message: "API keys are not available." });
		}
		const raw = crypto.randomBytes(32).toString("base64url");
		const apiKey = `psn_${raw}`;
		const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
		const apiKeyPrefix = `${apiKey.slice(0, 10)}…`;
		try {
			await queries.updateUserApiKey.run(req.auth.userId, { apiKeyHash, apiKeyPrefix });
			return res.json({ ok: true, apiKey });
		} catch (err) {
			console.error("[POST /api/profile/api-key]", err);
			return res.status(500).json({ error: "Failed to save API key", message: err?.message });
		}
	});
router.delete("/api/profile/api-key", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (req.auth?.apiKeyAuth || req.auth?.integrationAccess) {
			return res.status(403).json({
				error: "Forbidden",
				message: "Manage API keys while signed in on the website."
			});
		}
		if (!queries.updateUserApiKey?.run) {
			return res.status(500).json({ error: "Not available", message: "API keys are not available." });
		}
		try {
			await queries.updateUserApiKey.run(req.auth.userId, { apiKeyHash: null, apiKeyPrefix: null });
			return res.json({ ok: true });
		} catch (err) {
			console.error("[DELETE /api/profile/api-key]", err);
			return res.status(500).json({ error: "Failed to remove API key", message: err?.message });
		}
	});
router.patch("/api/profile", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const wantsNsfw = Object.prototype.hasOwnProperty.call(body, "enableNsfw");
		const wantsShowOwnPosts = Object.prototype.hasOwnProperty.call(body, "showOwnPostsInFeed");
		const wantsAudible = Object.prototype.hasOwnProperty.call(body, "audibleNotifications");
		const wantsForceLegacy = Object.prototype.hasOwnProperty.call(body, "forceLegacyFeed");
		if (!wantsNsfw && !wantsShowOwnPosts && !wantsAudible && !wantsForceLegacy) {
			return res.status(400).json({
				error: "Invalid request",
				message: "Provide enableNsfw, showOwnPostsInFeed, audibleNotifications, and/or forceLegacyFeed."
			});
		}
		if (wantsNsfw && typeof body.enableNsfw !== "boolean") {
			return res.status(400).json({ error: "Invalid request", message: "enableNsfw must be a boolean when provided." });
		}
		if (wantsShowOwnPosts && typeof body.showOwnPostsInFeed !== "boolean") {
			return res.status(400).json({
				error: "Invalid request",
				message: "showOwnPostsInFeed must be a boolean when provided."
			});
		}
		if (wantsAudible && typeof body.audibleNotifications !== "boolean") {
			return res.status(400).json({
				error: "Invalid request",
				message: "audibleNotifications must be a boolean when provided."
			});
		}
		if (wantsForceLegacy && typeof body.forceLegacyFeed !== "boolean") {
			return res.status(400).json({
				error: "Invalid request",
				message: "forceLegacyFeed must be a boolean when provided."
			});
		}
		try {
			if (wantsNsfw) {
				if (!queries.updateUserEnableNsfw?.run) {
					return res.status(500).json({ error: "Not available", message: "Profile update is not available." });
				}
				await queries.updateUserEnableNsfw.run(req.auth.userId, body.enableNsfw);
			}
			if (wantsShowOwnPosts) {
				if (!queries.updateUserShowOwnPostsInFeed?.run) {
					return res.status(500).json({ error: "Not available", message: "Profile update is not available." });
				}
				await queries.updateUserShowOwnPostsInFeed.run(req.auth.userId, body.showOwnPostsInFeed);
			}
			if (wantsAudible) {
				if (!queries.updateUserAudibleNotifications?.run) {
					return res.status(500).json({ error: "Not available", message: "Profile update is not available." });
				}
				await queries.updateUserAudibleNotifications.run(req.auth.userId, body.audibleNotifications);
			}
			if (wantsForceLegacy) {
				const user = await queries.selectUserById.get(req.auth.userId);
				if (!queries.updateUserForceLegacyFeed?.run) {
					return res.status(500).json({ error: "Not available", message: "Profile update is not available." });
				}
				await queries.updateUserForceLegacyFeed.run(req.auth.userId, body.forceLegacyFeed);
			}
			const out = { ok: true };
			if (wantsNsfw) out.enableNsfw = body.enableNsfw;
			if (wantsShowOwnPosts) out.showOwnPostsInFeed = body.showOwnPostsInFeed;
			if (wantsAudible) out.audibleNotifications = body.audibleNotifications;
			if (wantsForceLegacy) out.forceLegacyFeed = body.forceLegacyFeed;
			return res.json(out);
		} catch (err) {
			console.error("[PATCH /api/profile]", err);
			return res.status(500).json({ error: "Failed to update", message: err?.message || "Could not update profile." });
		}
	});
router.put("/api/account/email", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const userId = req.auth.userId;
			const newEmail = typeof req.body?.new_email === "string" ? req.body.new_email.trim().toLowerCase() : "";
			const password = String(req.body?.password ?? "");

			if (!newEmail) {
				return res.status(400).json({ error: "New email is required" });
			}
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
				return res.status(400).json({ error: "Invalid email format" });
			}
			if (!password) {
				return res.status(400).json({ error: "Current password is required to change email" });
			}

			const authUser = await queries.selectUserByIdForLogin?.get(userId);
			if (!authUser || !bcrypt.compareSync(password, authUser.password_hash)) {
				return res.status(401).json({ error: "Incorrect password" });
			}

			const existingByEmail = await queries.selectUserByEmail.get(newEmail);
			if (existingByEmail && Number(existingByEmail.id) !== Number(userId)) {
				return res.status(409).json({ error: "Email already in use", message: "That email is already associated with another account." });
			}

			if (!queries.updateUserEmail?.run) {
				return res.status(500).json({ error: "Email update not available" });
			}
			const { changes } = await queries.updateUserEmail.run(userId, newEmail);
			if (changes === 0) {
				return res.status(409).json({ error: "Email already in use", message: "That email is already associated with another account." });
			}
			return res.json({ ok: true, email: newEmail });
		} catch (err) {
			console.error("[PUT /api/account/email]", err);
			return res.status(500).json({ error: "Update failed", message: err?.message || "Could not update email." });
		}
	});
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

			const nextSocialsResult = applySocialFieldUpdates(existingProfile.socials, fields);
			if (!nextSocialsResult.ok) {
				return res.status(400).json({ error: nextSocialsResult.error || "Invalid social link" });
			}
			const nextSocials = nextSocialsResult.socials;

			const badges = parseJsonField(fields?.badges, existingProfile.badges || [], "Badges must be valid JSON.");
			if (!Array.isArray(badges)) {
				return res.status(400).json({ error: "Badges must be a JSON array" });
			}
			let meta = parseJsonField(fields?.meta, existingProfile.meta || {}, "Meta must be valid JSON.");
			if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
				return res.status(400).json({ error: "Meta must be a JSON object" });
			}
			delete meta.prsn_cids;
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
			meta.character_description = typeof fields?.character_description === "string" ? fields.character_description.trim() || null : (existingProfile.meta?.character_description ?? null);

			let avatar_url = avatarRemove ? null : (oldAvatarUrl || null);
			let cover_image_url = coverRemove ? null : (oldCoverUrl || null);

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);

			const pendingDeletes = [];

			const storage = storageAdapter;
			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			if (!avatarRemove && avatarFile?.buffer?.length) {
				try {
					const storedAvatar = await storeProcessedProfileAvatar(storage, req.auth.userId, avatarFile.buffer);
					avatar_url = storedAvatar.url;
				} catch {
					return res.status(400).json({ error: "Invalid avatar image" });
				}
				if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, req.auth.userId) && storage.deleteGenericImage) {
					pendingDeletes.push(oldAvatarKey);
				}
			} else if (!avatarRemove && !avatarFile?.buffer?.length) {
				const tryUrl = typeof fields?.avatar_try_url === "string" ? fields.avatar_try_url.trim() : "";
				const tryPrefix = "/api/try/images/";
				if (tryUrl.startsWith(tryPrefix)) {
					const afterPrefix = tryUrl.slice(tryPrefix.length);
					const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
					if (
						filename &&
						!filename.includes("..") &&
						!filename.includes("/") &&
						storage.getImageBufferAnon &&
						storage.uploadImage &&
						queries.insertCreatedImage?.run
					) {
						try {
							const avatarAnonRow = await queries.selectCreatedImageAnonByFilename?.get?.(filename);
							// Idempotent: if we already promoted this anon to a creation (e.g. retry or double-submit), reuse it and avoid saving twice.
							let createdImageId = null;
							let newUrl = null;
							let existingCreation = null;
							if (avatarAnonRow?.id != null && queries.selectCreatedImagesForUser?.all) {
								const existingCreations = await queries.selectCreatedImagesForUser.all(req.auth.userId, { limit: 500 });
								existingCreation = (existingCreations || []).find(
									(c) => c.meta && typeof c.meta === "object" && (Number(c.meta.source_anon_id) === Number(avatarAnonRow.id))
								);
								if (existingCreation && (existingCreation.file_path || existingCreation.filename)) {
									newUrl = existingCreation.file_path || (existingCreation.filename ? `/api/images/created/${existingCreation.filename}` : null);
									createdImageId = existingCreation.id;
								}
							}
							if (newUrl && createdImageId != null) {
								const existingFilename = existingCreation?.filename;
								if (existingFilename && storage.getImageBuffer) {
									const sourceBuffer = await storage.getImageBuffer(existingFilename);
									const storedAvatar = await storeProcessedProfileAvatar(storage, req.auth.userId, sourceBuffer);
									avatar_url = storedAvatar.url;
								} else {
									avatar_url = newUrl;
								}
								if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, req.auth.userId) && storage.deleteGenericImage) {
									pendingDeletes.push(oldAvatarKey);
								}
								if (queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run && queries.deleteCreatedImageAnon?.run && storage.deleteImageAnon) {
									try {
										await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(avatarAnonRow.id, {
											userId: req.auth.userId,
											createdImageId
										});
										await queries.deleteCreatedImageAnon.run(avatarAnonRow.id);
										await storage.deleteImageAnon(avatarAnonRow.filename);
									} catch (_) {}
								}
							} else {
								const buffer = await storage.getImageBufferAnon(filename);
								const newFilename = `profile_avatar_${req.auth.userId}_${Date.now()}.png`;
								newUrl = await storage.uploadImage(buffer, newFilename);
								const promptText = (typeof meta?.character_description === "string" && meta.character_description.trim()) ? meta.character_description.trim() : null;
								const creationMeta = {
									...(promptText ? { args: { prompt: promptText } } : {}),
									...(avatarAnonRow?.id != null ? { source_anon_id: avatarAnonRow.id } : {})
								};
								const creationMetaOrNull = Object.keys(creationMeta).length > 0 ? creationMeta : null;
								const insertResult = await queries.insertCreatedImage.run(
									req.auth.userId,
									newFilename,
									newUrl,
									1024,
									1024,
									null,
									"completed",
									creationMetaOrNull
								);
								createdImageId = insertResult?.insertId;
								if (createdImageId) {
									const storedAvatar = await storeProcessedProfileAvatar(storage, req.auth.userId, buffer);
									avatar_url = storedAvatar.url;
									if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, req.auth.userId) && storage.deleteGenericImage) {
										pendingDeletes.push(oldAvatarKey);
									}
									if (avatarAnonRow?.id && queries.updateTryRequestsTransitionedByCreatedImageAnonId?.run && queries.deleteCreatedImageAnon?.run && storage.deleteImageAnon) {
										try {
											await queries.updateTryRequestsTransitionedByCreatedImageAnonId.run(avatarAnonRow.id, {
												userId: req.auth.userId,
												createdImageId
											});
											await queries.deleteCreatedImageAnon.run(avatarAnonRow.id);
											await storage.deleteImageAnon(avatarAnonRow.filename);
										} catch (_) {}
									}
								}
							}
						} catch (tryErr) {
							// non-fatal: leave avatar_url as existing or null
						}
					} else if (filename && !filename.includes("..") && !filename.includes("/") && storage.getImageBufferAnon) {
						// Fallback: copy to profile storage only (no creation)
						try {
							const buffer = await storage.getImageBufferAnon(filename);
							const storedAvatar = await storeProcessedProfileAvatar(storage, req.auth.userId, buffer);
							avatar_url = storedAvatar.url;
							if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, req.auth.userId) && storage.deleteGenericImage) {
								pendingDeletes.push(oldAvatarKey);
							}
							if (storage.deleteImageAnon && queries.selectCreatedImageAnonByFilename?.get && queries.deleteCreatedImageAnon?.run) {
								try {
									const anonRow = await queries.selectCreatedImageAnonByFilename.get(filename);
									if (anonRow?.id) {
										await queries.deleteCreatedImageAnon.run(anonRow.id);
										await storage.deleteImageAnon(filename);
									}
								} catch (_) {}
							}
						} catch (tryErr) {
							// non-fatal
						}
					}
				}
			}
			if (avatarRemove && oldAvatarKey && storage.deleteGenericImage) {
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

			const anonCidForPrsnPost =
				typeof req.cookies?.ps_cid === "string" ? req.cookies.ps_cid.trim() || null : null;
			let tryPrsnIdsPost = [];
			if (anonCidForPrsnPost && queries.selectTryRequestsByCid?.all) {
				const tr = (await queries.selectTryRequestsByCid.all(anonCidForPrsnPost)) || [];
				tryPrsnIdsPost = tr.map((r) => prsnCidFromMeta(tryRequestMetaFromRow(r.meta))).filter(Boolean);
			}
			meta = mergePrsnCidsIntoProfileMeta(meta, [getClientIdFromRequest(req), ...tryPrsnIdsPost]);

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
			if (avatar_url !== oldAvatarUrl) {
				await bumpFeedAfterAvatarChange();
			}
			if (storage.deleteGenericImage && pendingDeletes.length > 0) {
				for (const key of pendingDeletes) {
					try {
						await storage.deleteGenericImage(key);
					} catch (error) {
						// console.warn("Failed to delete previous profile image:", error?.message || error);
					}
				}
			}

			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);
			return res.json({ ok: true, profile });
		} catch (error) {
			if (error?.code === "FILE_TOO_LARGE") {
				return res.status(413).json({ error: "Image too large" });
			}
			if (error?.code === "INVALID_JSON") {
				return res.status(400).json({ error: error.message || "Invalid JSON" });
			}
			console.error("Error updating profile (multipart):", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});
router.post("/api/profile/avatar-from-creation", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const creationId = req.body?.creation_id != null ? Number(req.body.creation_id) : null;
			if (!Number.isFinite(creationId) || creationId <= 0) {
				return res.status(400).json({ error: "Invalid creation_id" });
			}
			if (!queries.selectCreatedImageById?.get) {
				return res.status(500).json({ error: "Profile storage not available" });
			}
			const image = await queries.selectCreatedImageById.get(creationId, req.auth.userId);
			if (!image || Number(image.user_id) !== Number(req.auth.userId)) {
				return res.status(404).json({ error: "Creation not found or you do not own it" });
			}
			if (image.status !== "completed" || !image.filename || image.filename.includes("..") || image.filename.includes("/")) {
				return res.status(400).json({ error: "Creation image is not available" });
			}
			const storage = storageAdapter;
			if (!storage?.getImageBuffer || !storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Image storage not available" });
			}
			const existingRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const existingProfile = normalizeProfileRow(existingRow);
			const oldAvatarUrl = existingProfile.avatar_url || null;
			const oldAvatarKey = extractGenericKey(oldAvatarUrl);
			const buffer = await storage.getImageBuffer(image.filename);
			const storedAvatar = await storeProcessedProfileAvatar(storage, req.auth.userId, buffer);
			const avatar_url = storedAvatar.url;
			const metaMerged = mergePrsnCidsIntoProfileMeta(existingProfile.meta ?? {}, getClientIdFromRequest(req));
			const payload = {
				user_name: existingProfile.user_name ?? null,
				display_name: existingProfile.display_name ?? null,
				about: existingProfile.about ?? null,
				socials: existingProfile.socials ?? {},
				avatar_url,
				cover_image_url: existingProfile.cover_image_url ?? null,
				badges: existingProfile.badges ?? [],
				meta: metaMerged
			};
			await queries.upsertUserProfile.run(req.auth.userId, payload);
			await bumpFeedAfterAvatarChange();
			if (shouldDeleteOldProfileAvatarKey(oldAvatarKey, req.auth.userId) && storage.deleteGenericImage) {
				try {
					await storage.deleteGenericImage(oldAvatarKey);
				} catch (_) {}
			}
			const updatedRow = await queries.selectUserProfileByUserId?.get(req.auth.userId);
			const profile = normalizeProfileRow(updatedRow);
			return res.json({ ok: true, profile });
		} catch (err) {
			// console.error("Error setting avatar from creation:", err);
			return res.status(500).json({ error: err?.message || "Internal server error" });
		}
	});
router.get(["/api/users/:id/profile", "/api/users/by-username/:username/profile"], async (req, res) => {
		try {
			const viewerId = req.auth?.userId ? Number(req.auth.userId) : null;
			const viewer = viewerId ? await queries.selectUserById.get(viewerId) : null;
			if (viewerId && !viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			const target = resolved.target;

			const emailPrefix = (() => {
				const email = String(target?.email || "").trim();
				if (!email) return null;
				const local = email.includes("@") ? email.split("@")[0] : email;
				const trimmed = local.trim();
				return trimmed || null;
			})();

			const isSelf = Boolean(viewer && Number(targetUserId) === Number(viewer.id));
			const profileRow = await queries.selectUserProfileByUserId?.get(targetUserId);
			let profile = normalizeProfileRow(profileRow);
			if (!isSelf && profile) {
				const m = profile.meta && typeof profile.meta === "object" ? { ...profile.meta } : {};
				delete m.prsn_cids;
				profile = { ...profile, meta: m, prsn_cids: [] };
			}

			const allCountRow = await queries.selectAllCreatedImageCountForUser?.get(targetUserId);
			const publishedCountRow = await queries.selectPublishedCreatedImageCountForUser?.get(targetUserId);
			const likesCountRow = await queries.selectLikesReceivedForUserPublished?.get(targetUserId);
			const followerCountRow = await queries.selectFollowerCountForUser?.get(targetUserId);
			const publishedCount = Number(publishedCountRow?.count ?? 0);
			const allCount = Number(allCountRow?.count ?? 0);

			const stats = {
				creations_total: viewer ? allCount : publishedCount,
				creations_published: publishedCount,
				likes_received: Number(likesCountRow?.count ?? 0),
				followers_count: Number(followerCountRow?.count ?? 0),
				member_since: target.created_at ?? null
			};

			const viewerFollowsRow = (!viewer || isSelf)
				? null
				: queries.selectUserFollowStatus?.get
					? await queries.selectUserFollowStatus.get(viewer.id, targetUserId)
					: null;
			const viewerFollows = Boolean(viewerFollowsRow?.viewer_follows);

			const publicUser = isSelf
				? { id: target.id, email: target.email, role: target.role, created_at: target.created_at }
				: {
					id: target.id,
					role: target.role,
					created_at: target.created_at,
					...(viewer ? { email_prefix: emailPrefix } : {})
				};

			const plan = target?.meta?.plan === "founder" ? "founder" : "free";
			return res.json({
				user: publicUser,
				profile,
				plan,
				stats,
				is_self: isSelf,
				viewer_follows: viewerFollows
			});
		} catch (error) {
			// console.error("Error loading user profile summary:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});
router.get(["/api/users/:id/created-images", "/api/users/by-username/:username/created-images"], async (req, res) => {
		try {
			const viewerId = req.auth?.userId ? Number(req.auth.userId) : null;
			const viewer = viewerId ? await queries.selectUserById.get(viewerId) : null;
			if (viewerId && !viewer) {
				return res.status(404).json({ error: "User not found" });
			}

			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;

			const isSelf = Boolean(viewer && Number(targetUserId) === Number(viewer.id));
			const isAdmin = viewer?.role === 'admin';
			const include = String(req.query?.include || "").toLowerCase();
			const wantAll = include === "all";
			const includeUnavailable = isAdmin && (wantAll || req.query?.includeUnavailable === "1");
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "24"), 10) || 24));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const pagination = { limit, offset };

			const enableNsfw = viewer?.meta?.enableNsfw === true;

			let images = [];
			if ((isSelf || isAdmin) && wantAll && queries.selectCreatedImagesForUser?.all) {
				images = await queries.selectCreatedImagesForUser.all(targetUserId, { includeUnavailable, ...pagination });
			} else if (queries.selectPublishedCreatedImagesForUser?.all) {
				images = await queries.selectPublishedCreatedImagesForUser.all(targetUserId, {
					...pagination,
					viewerEnableNsfw: enableNsfw
				});
			} else if (queries.selectCreatedImagesForUser?.all) {
				// Fallback: filter in memory (no pagination)
				const all = await queries.selectCreatedImagesForUser.all(targetUserId, { includeUnavailable });
				images = Array.isArray(all) ? all.filter((img) => img?.published === 1 || img?.published === true).slice(offset, offset + limit) : [];
			}

			const mapped = (Array.isArray(images) ? images : []).map((img) => {
				const userDeleted = !!(img.unavailable_at != null && img.unavailable_at !== "");
				const status = img.status || "completed";
				const meta = parseCreationMeta(img.meta);
				const mediaFields = mapCreatedImageRowMediaFields(img, { includeMeta: true });
				const url = mediaFields.url;
				const isModeratedError = (() => {
					if (status !== "failed" || meta == null) return false;
					try {
						const parts = [];
						if (typeof meta.error === "string" && meta.error.trim()) parts.push(meta.error.trim());
						const pe = meta.provider_error;
						if (pe != null && typeof pe === "object" && pe.body != null) {
							const b = pe.body;
							if (typeof b === "string") parts.push(b.trim());
							else if (typeof b === "object") {
								if (typeof b.error === "string" && b.error.trim()) parts.push(b.error.trim());
								else if (typeof b.message === "string" && b.message.trim()) parts.push(b.message.trim());
							}
						}
						const errorText = parts.join(" ").toLowerCase();
						return errorText.length > 0 && errorText.includes("moderated");
					} catch {
						return false;
					}
				})();
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: mediaFields.thumbnail_url,
					width: img.width,
					height: img.height,
					color: img.color,
					status,
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null,
					nsfw: !!(meta && meta.nsfw),
					media_type: mediaFields.media_type,
					video_url: mediaFields.video_url,
					audio_url: mediaFields.audio_url,
					meta: mediaFields.meta,
					is_moderated_error: isModeratedError,
					...(isAdmin && userDeleted ? { user_deleted: true } : {})
				};
			});

			let resultMapped = mapped;
			if (!viewer) {
				resultMapped = mapped.filter((img) => {
					if (img.nsfw) return false;
					return !creationMetaHasChallengeSubmission(img.meta);
				});
			} else if (!enableNsfw) {
				resultMapped = mapped.filter((img) => !img.nsfw);
			}
			const has_more = mapped.length === limit;
			return res.json({ images: resultMapped, has_more, is_self: isSelf, scope: isSelf && wantAll ? "all" : "published" });
		} catch (error) {
			// console.error("Error loading user created images:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});
router.get(["/api/users/:id/liked-creations", "/api/users/by-username/:username/liked-creations"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}
			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			if (!queries.selectCreatedImagesLikedByUser?.all) {
				return res.json({ images: [], has_more: false });
			}
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "24"), 10) || 24));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const images = await queries.selectCreatedImagesLikedByUser.all(targetUserId, { limit, offset });
			const mapped = (Array.isArray(images) ? images : []).map((img) => {
				const meta = parseCreationMeta(img.meta);
				const mediaFields = mapCreatedImageRowMediaFields(img, { includeMeta: true });
				const nsfw = !!(meta && meta.nsfw);
				return {
					id: img.id,
					filename: img.filename,
					url: mediaFields.url,
					thumbnail_url: mediaFields.thumbnail_url,
					width: img.width,
					height: img.height,
					color: img.color,
					created_at: img.created_at,
					title: img.title || null,
					description: img.description || null,
					nsfw,
					media_type: mediaFields.media_type,
					video_url: mediaFields.video_url,
					audio_url: mediaFields.audio_url,
					meta: mediaFields.meta
				};
			});
			const enableNsfw = viewer?.meta?.enableNsfw === true;
			const resultMapped = enableNsfw ? mapped : mapped.filter((img) => !img.nsfw);
			return res.json({ images: resultMapped, has_more: mapped.length === limit });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	});
router.get(["/api/users/:id/comments", "/api/users/by-username/:username/comments"], async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const viewer = await queries.selectUserById.get(req.auth.userId);
			if (!viewer) {
				return res.status(404).json({ error: "User not found" });
			}
			const resolved = await resolveTargetUserFromParams(req, { allowUsername: true });
			if (resolved?.error) {
				return res.status(resolved.error.status).json(resolved.error.body);
			}
			const targetUserId = resolved.targetUserId;
			const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit ?? "20"), 10) || 20));
			const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);
			const commentsRaw = await queries.selectCommentsByUser?.all(targetUserId, { limit, offset }) ?? [];
			const comments = (Array.isArray(commentsRaw) ? commentsRaw : []).map((c) => {
				const mediaFields = mapCreatedImageRowMediaFields(
					{
						id: c?.created_image_id,
						file_path: c?.created_image_url,
						meta: c?.created_image_meta
					},
					{ includeMeta: false }
				);
				return {
					...c,
					created_image_url: mediaFields.url ?? c?.created_image_url ?? null,
					created_image_thumbnail_url: mediaFields.thumbnail_url ?? null
				};
			});
			const commentIds = comments.map((c) => c.id).filter((id) => id != null);
			const reactionsByComment = await getReactionsForCommentIds(queries, commentIds, viewer?.id ?? null);
			for (const c of comments) {
				if (c.id == null) continue;
				const r = reactionsByComment.get(Number(c.id));
				if (r) {
					c.reactions = r.reactions ?? {};
					c.viewer_reactions = r.viewer_reactions ?? [];
				} else {
					c.reactions = {};
					c.viewer_reactions = [];
				}
			}
			return res.json({ comments, has_more: comments.length === limit });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	});

return router;
}
