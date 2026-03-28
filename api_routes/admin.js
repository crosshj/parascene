import express from "express";
import path from "path";
import Busboy from "busboy";
import sharp from "sharp";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";
import { fetchImageBufferFromUrl, createPlaceholderImageBuffer, runAnonCreationJob } from "./utils/creationJob.js";
import { scheduleAnonCreationJob } from "./utils/scheduleCreationJob.js";
import { getEmailSettings } from "./utils/emailSettings.js";
import { getBaseAppUrlForEmail } from "./utils/url.js";
import { RELATED_PARAM_KEYS } from "../db/adapters/relatedParams.js";
import { runNotificationsCronForTests } from "../api/worker/notifications.js";
import { buildRequestMeta } from "./utils/analytics.js";
import { prsnCidFromMeta } from "./utils/prsnCids.js";
import { BLOG_CAMPAIGN_INDEX, BLOG_CAMPAIGN_INTERNAL } from "../lib/blog/campaignPath.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { broadcastChatThreadDeleted } from "./utils/realtimeBroadcast.js";
import { serverChannelTagFromServerName } from "../public/shared/serverChatTag.js";

/** Subscription ID stored in user.meta when admin grants founder status without payment. Not a Stripe ID. */
const GIFTED_FOUNDER_SUBSCRIPTION_ID = "gifted_founder";

export default function createAdminRoutes({ queries, storage }) {
	const router = express.Router();

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
	}

	router.get("/admin/users", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const users = await queries.selectUsers.all();

		// Fetch credits for each user
		const usersWithCredits = await Promise.all(
			users.map(async (u) => {
				const credits = await queries.selectUserCredits.get(u.id);
				return {
					...u,
					credits: credits?.balance ?? 0
				};
			})
		);

		// Active: role === 'consumer' && !suspended, sorted by last_active_at desc (nulls last)
		const activeUsers = usersWithCredits
			.filter((u) => u.role === "consumer" && !u.suspended)
			.sort((a, b) => {
				const aAt = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
				const bAt = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
				return bAt - aAt;
			});

		// Other: role !== 'consumer' OR suspended (order undefined)
		const otherUsers = usersWithCredits.filter(
			(u) => u.role !== "consumer" || u.suspended
		);

		res.json({ activeUsers, otherUsers });
	});

	// Admin-only: update user suspend state (merge into users.meta.suspended).
	router.put("/admin/users/:id", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		if (Number(targetUserId) === Number(admin.id)) {
			return res.status(400).json({ error: "Refusing to suspend current admin user" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		const suspended = req.body?.suspended;
		if (typeof suspended !== "boolean") {
			return res.status(400).json({ error: "suspended must be a boolean" });
		}

		if (!queries.updateUserSuspended?.run) {
			return res.status(500).json({ error: "User suspend update not available" });
		}

		await queries.updateUserSuspended.run(targetUserId, suspended);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				suspended,
				credits: creditsBalance
			}
		});
	});

	function hasRealFounderSubscription(user) {
		const plan = user?.meta?.plan;
		const subId = user?.meta?.stripeSubscriptionId;
		return plan === "founder" && subId != null && String(subId).trim() !== "" && subId !== GIFTED_FOUNDER_SUBSCRIPTION_ID;
	}

	function hasGiftedFounder(user) {
		return user?.meta?.plan === "founder" && user?.meta?.stripeSubscriptionId === GIFTED_FOUNDER_SUBSCRIPTION_ID;
	}

	// Admin-only: grant founder status without payment (gifted founder). Not allowed for users who have a real Stripe subscription.
	router.post("/admin/users/:id/grant-founder", async (req, res) => {
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

		if (hasRealFounderSubscription(target)) {
			return res.status(400).json({
				error: "User has a paid subscription",
				message: "Cannot grant gifted founder to a user who has already subscribed."
			});
		}

		if (!queries.updateUserPlan?.run || !queries.updateUserStripeSubscriptionId?.run) {
			return res.status(500).json({ error: "Founder update not available" });
		}

		await queries.updateUserPlan.run(targetUserId, "founder");
		await queries.updateUserStripeSubscriptionId.run(targetUserId, GIFTED_FOUNDER_SUBSCRIPTION_ID);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				credits: creditsBalance
			}
		});
	});

	// Admin-only: revoke gifted founder status. Only allowed when user has the gifted_founder subscription id (not a real Stripe subscription).
	router.post("/admin/users/:id/revoke-founder", async (req, res) => {
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

		if (!hasGiftedFounder(target)) {
			return res.status(400).json({
				error: "Not a gifted founder",
				message: "User does not have gifted founder status. Only gifted founder status can be revoked here."
			});
		}

		if (!queries.updateUserPlan?.run || !queries.updateUserStripeSubscriptionId?.run) {
			return res.status(500).json({ error: "Founder update not available" });
		}

		await queries.updateUserPlan.run(targetUserId, "free");
		await queries.updateUserStripeSubscriptionId.run(targetUserId, null);
		const updated = await queries.selectUserById.get(targetUserId);
		let creditsBalance = 0;
		try {
			const creditsRow = await queries.selectUserCredits.get(targetUserId);
			creditsBalance = creditsRow?.balance ?? 0;
		} catch {
			// ignore
		}
		res.json({
			ok: true,
			user: {
				...updated,
				credits: creditsBalance
			}
		});
	});

	// Admin-only: delete a user and clean up related content (likes, comments, images, etc).
	router.delete("/admin/users/:id", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		if (Number(targetUserId) === Number(admin.id)) {
			return res.status(400).json({ error: "Refusing to delete current admin user" });
		}

		if (!queries?.deleteUserAndCleanup?.run) {
			return res.status(500).json({ error: "User deletion not available" });
		}

		const target = await queries.selectUserById.get(targetUserId);
		if (!target) {
			return res.status(404).json({ error: "User not found" });
		}

		// Pre-fetch assets to delete from storage (best-effort, after DB cleanup).
		// Includes all created images (e.g. welcome-flow avatar in creations bucket).
		let createdImages = [];
		try {
			if (queries.selectCreatedImagesForUser?.all) {
				createdImages = await queries.selectCreatedImagesForUser.all(targetUserId, {
					includeUnavailable: true,
					limit: 500
				});
			}
		} catch {
			createdImages = [];
		}

		let profileRow = null;
		try {
			profileRow = await queries.selectUserProfileByUserId?.get?.(targetUserId);
		} catch {
			profileRow = null;
		}

		const avatarKey = extractGenericKey(profileRow?.avatar_url);
		const coverKey = extractGenericKey(profileRow?.cover_image_url);
		const imageFilenames = (Array.isArray(createdImages) ? createdImages : [])
			.map((img) => String(img?.filename || "").trim())
			.filter(Boolean);

		let cleanupResult;
		try {
			cleanupResult = await queries.deleteUserAndCleanup.run(targetUserId);
		} catch (error) {
			return res.status(500).json({ error: "Failed to delete user", message: error?.message || String(error) });
		}

		// Best-effort storage cleanup: created images + profile images.
		if (storage?.deleteImage) {
			for (const filename of imageFilenames) {
				try {
					await storage.deleteImage(filename);
				} catch {
					// ignore
				}
			}
		}
		if (storage?.deleteGenericImage) {
			for (const key of [avatarKey, coverKey].filter(Boolean)) {
				try {
					await storage.deleteGenericImage(key);
				} catch {
					// ignore
				}
			}
		}

		return res.json({
			ok: true,
			deleted_user_id: targetUserId,
			result: cleanupResult ?? null
		});
	});

	// Admin-only: list all chat threads (for moderation UI).
	router.get("/admin/chat/threads", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const sb = getSupabaseServiceClient();
		if (!sb) {
			return res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
		}

		try {
			const { data, error } = await sb
				.from("prsn_chat_threads")
				.select("id, type, dm_pair_key, channel_slug, created_at")
				.order("id", { ascending: false });
			if (error) throw error;

			const rows = Array.isArray(data) ? data : [];

			/** Slugs that map to a Connect “server” (same rule as chat sidebar). */
			const serverSlugs = new Set();
			try {
				if (typeof queries?.selectServers?.all === "function") {
					const servers = await queries.selectServers.all();
					for (const s of servers || []) {
						const tag = serverChannelTagFromServerName(
							typeof s?.name === "string" ? s.name : ""
						);
						if (tag) serverSlugs.add(String(tag).toLowerCase());
					}
				}
			} catch {
				// ignore; fall through without server filtering
			}

			const threads = rows.filter((t) => {
				if (t?.type === "dm") return false;
				if (t?.type === "channel") {
					const slug =
						t?.channel_slug != null ? String(t.channel_slug).trim().toLowerCase() : "";
					if (slug && serverSlugs.has(slug)) return false;
				}
				return true;
			});

			return res.status(200).json({ threads });
		} catch (err) {
			console.error("[GET /admin/chat/threads]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// Admin-only: delete a chat thread and all messages / membership (DB CASCADE from prsn_chat_threads).
	router.delete("/admin/chat/threads/:threadId", async (req, res) => {
		const admin = await requireAdmin(req, res);
		if (!admin) return;

		const threadId = Number.parseInt(String(req.params?.threadId || ""), 10);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "Invalid thread id" });
		}

		const sb = getSupabaseServiceClient();
		if (!sb) {
			return res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
		}

		try {
			const { data: existing, error: exErr } = await sb
				.from("prsn_chat_threads")
				.select("id")
				.eq("id", threadId)
				.maybeSingle();
			if (exErr) throw exErr;
			if (!existing?.id) {
				return res.status(404).json({ error: "Thread not found" });
			}

			const { data: memberRows, error: memErr } = await sb
				.from("prsn_chat_members")
				.select("user_id")
				.eq("thread_id", threadId);
			if (memErr) throw memErr;

			const { count: messageCount, error: cntErr } = await sb
				.from("prsn_chat_messages")
				.select("id", { count: "exact", head: true })
				.eq("thread_id", threadId);
			if (cntErr) throw cntErr;

			const memberUserIds = (Array.isArray(memberRows) ? memberRows : [])
				.map((r) => Number(r?.user_id))
				.filter((n) => Number.isFinite(n) && n > 0);

			const { error: delErr } = await sb.from("prsn_chat_threads").delete().eq("id", threadId);
			if (delErr) throw delErr;

			void broadcastChatThreadDeleted(threadId, memberUserIds);

			return res.status(200).json({
				ok: true,
				deleted_thread_id: threadId,
				removed_messages: typeof messageCount === "number" ? messageCount : null,
				member_count: memberUserIds.length
			});
		} catch (err) {
			console.error("[DELETE /admin/chat/threads/:threadId]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// Admin-only: override a user's username (write-once for normal users).
	router.put("/admin/users/:id/username", async (req, res) => {
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

		const rawUserName = req.body?.user_name ?? req.body?.username;
		const userName = normalizeUsername(rawUserName);
		if (!userName) {
			return res.status(400).json({
				error: "Invalid username",
				message: "Username must be 3-24 chars, lowercase letters/numbers/underscore, starting with a letter/number."
			});
		}

		// Uniqueness check
		if (queries.selectUserProfileByUsername?.get) {
			const existing = await queries.selectUserProfileByUsername.get(userName);
			if (existing && Number(existing.user_id) !== Number(targetUserId)) {
				return res.status(409).json({ error: "Username already taken" });
			}
		}

		if (!queries.upsertUserProfile?.run) {
			return res.status(500).json({ error: "Profile storage not available" });
		}

		// Preserve existing profile fields; only update username.
		const existingRow = await queries.selectUserProfileByUserId?.get(targetUserId);
		const existingProfile = normalizeProfileRow(existingRow);

		const nextMeta = {
			...(typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {})
		};

		const payload = {
			user_name: userName,
			display_name: existingProfile.display_name ?? null,
			about: existingProfile.about ?? null,
			socials: typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {},
			avatar_url: existingProfile.avatar_url ?? null,
			cover_image_url: existingProfile.cover_image_url ?? null,
			badges: Array.isArray(existingProfile.badges) ? existingProfile.badges : [],
			meta: nextMeta
		};

		await queries.upsertUserProfile.run(targetUserId, payload);

		const updated = await queries.selectUserProfileByUserId?.get(targetUserId);
		return res.json({ ok: true, profile: normalizeProfileRow(updated) });
	});

	// Admin-only: update a user's profile (display_name, about, character_description, avatar_url, etc.)
	router.put("/admin/users/:id/profile", async (req, res) => {
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

		const existingRow = await queries.selectUserProfileByUserId?.get(targetUserId);
		const existingProfile = normalizeProfileRow(existingRow);
		const existingMeta = typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {};

		const body = req.body && typeof req.body === "object" ? req.body : {};
		let display_name = body.display_name;
		let about = body.about;
		let character_description = body.character_description;
		let avatar_url = body.avatar_url;

		if (display_name !== undefined) {
			display_name = typeof display_name === "string" ? display_name.trim() || null : existingProfile.display_name;
		} else {
			display_name = existingProfile.display_name;
		}
		if (about !== undefined) {
			about = typeof about === "string" ? about.trim() || null : existingProfile.about;
		} else {
			about = existingProfile.about;
		}
		if (character_description !== undefined) {
			character_description = typeof character_description === "string" ? character_description.trim() || null : existingMeta.character_description ?? null;
		} else {
			character_description = existingMeta.character_description ?? null;
		}

		const nextMeta = { ...existingMeta, character_description };

		let finalAvatarUrl = avatar_url !== undefined
			? (typeof avatar_url === "string" ? avatar_url.trim() || null : null)
			: existingProfile.avatar_url;

		const tryPrefix = "/api/try/images/";
		const storageInst = req.app?.locals?.storage ?? storage;
		if (
			finalAvatarUrl &&
			typeof finalAvatarUrl === "string" &&
			finalAvatarUrl.startsWith(tryPrefix) &&
			storageInst?.getImageBufferAnon &&
			storageInst?.uploadGenericImage
		) {
			const afterPrefix = finalAvatarUrl.slice(tryPrefix.length);
			const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
			if (filename && !filename.includes("..") && !filename.includes("/")) {
				try {
					const buffer = await storageInst.getImageBufferAnon(filename);
					const resized = await sharp(buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
					const now = Date.now();
					const rand = Math.random().toString(36).slice(2, 9);
					const key = `profile/${targetUserId}/avatar_${now}_${rand}.png`;
					const stored = await storageInst.uploadGenericImage(resized, key, { contentType: "image/png" });
					finalAvatarUrl = buildGenericUrl(stored ?? key);
					const oldAvatarKey = extractGenericKey(existingProfile.avatar_url);
					if (oldAvatarKey && storageInst?.deleteGenericImage) {
						try {
							await storageInst.deleteGenericImage(oldAvatarKey);
						} catch {
							// ignore
						}
					}
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
				} catch (promoteErr) {
					// non-fatal; keep existing avatar or null
					finalAvatarUrl = existingProfile.avatar_url;
				}
			}
		}

		const payload = {
			user_name: existingProfile.user_name ?? null,
			display_name,
			about,
			socials: typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {},
			avatar_url: finalAvatarUrl,
			cover_image_url: existingProfile.cover_image_url ?? null,
			badges: Array.isArray(existingProfile.badges) ? existingProfile.badges : [],
			meta: nextMeta
		};

		await queries.upsertUserProfile.run(targetUserId, payload);
		const updated = await queries.selectUserProfileByUserId?.get(targetUserId);
		return res.json({ ok: true, profile: normalizeProfileRow(updated) });
	});

	// Admin-only: update user profile via multipart (avatar, cover, display_name, about, character_description)
	router.post("/admin/users/:id/profile", async (req, res) => {
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

		const nextSocials = {
			...(typeof existingProfile.socials === "object" && existingProfile.socials ? existingProfile.socials : {})
		};
		if (typeof fields?.social_website === "string") {
			const website = fields.social_website.trim();
			if (website) nextSocials.website = website;
			else delete nextSocials.website;
		}

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
			const key = `profile/${targetUserId}/avatar_${now}_${rand}.png`;
			const stored = await storageInst.uploadGenericImage(resized, key, { contentType: "image/png" });
			avatar_url = buildGenericUrl(stored ?? key);
			if (oldAvatarKey && storageInst.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
		} else if (!avatarRemove && !avatarFile?.buffer?.length) {
			const tryUrl = typeof fields?.avatar_try_url === "string" ? fields.avatar_try_url.trim() : "";
			const tryPrefix = "/api/try/images/";
			if (tryUrl.startsWith(tryPrefix)) {
				const afterPrefix = tryUrl.slice(tryPrefix.length);
				const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
				if (filename && !filename.includes("..") && !filename.includes("/") && storageInst.getImageBufferAnon) {
					try {
						const buffer = await storageInst.getImageBufferAnon(filename);
						const resized = await sharp(buffer)
							.rotate()
							.resize(128, 128, { fit: "cover" })
							.png()
							.toBuffer();
						const key = `profile/${targetUserId}/avatar_${now}_${rand}.png`;
						const stored = await storageInst.uploadGenericImage(resized, key, { contentType: "image/png" });
						avatar_url = buildGenericUrl(stored ?? key);
						if (oldAvatarKey && storageInst.deleteGenericImage) pendingDeletes.push(oldAvatarKey);
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

	/** Build avatar prompt from character description (same as user-profile/welcome). */
	function buildAvatarPrompt(description, variationKey) {
		const core = typeof description === "string" ? description.trim() : "";
		return [
			`Portrait of ${core}. Avoid showing body, focus on face and head.`,
			"Head-and-shoulders framing, square composition.",
			"Clean, plain and simple background colorful and contrasting with subject.",
			"Expressive eyes, clear facial details, emotive head position.",
			"Stylized digital portrait suitable for a social profile photo.",
			`No text, no logo, no watermark, no frame. Variation hint: ${variationKey}.`
		].join("\n");
	}

	/** Admin-only: generate avatar from user's character prompt. Associates with admin's ps_cid so admin can poll /api/try/list. Returns { id } for polling. No credit charge. */
	router.post("/admin/users/:id/generate-avatar", async (req, res) => {
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

		const anonCid = req.cookies?.ps_cid;
		if (!anonCid || typeof anonCid !== "string" || !anonCid.trim()) {
			return res.status(400).json({
				error: "Missing identity",
				message: "Cookie ps_cid is required. Call POST /api/policy/seen first."
			});
		}

		const profileRow = await queries.selectUserProfileByUserId?.get?.(targetUserId);
		const existingProfile = normalizeProfileRow(profileRow);
		const existingMeta = typeof existingProfile.meta === "object" && existingProfile.meta ? existingProfile.meta : {};
		const characterDescription = typeof req.body?.character_description === "string" && req.body.character_description.trim()
			? req.body.character_description.trim()
			: (existingMeta.character_description && String(existingMeta.character_description).trim()) || null;

		if (!characterDescription) {
			return res.status(400).json({
				error: "No character description",
				message: "User has no character description. Set one in the profile or pass character_description in the request body."
			});
		}

		const TRY_DEFAULT_SERVER_ID = 1;
		const TRY_DEFAULT_METHOD = "replicate";
		const TRY_DEFAULT_MODEL = "prunaai/p-image";
		const variationKey = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		const prompt = buildAvatarPrompt(characterDescription, variationKey);
		const server_id = TRY_DEFAULT_SERVER_ID;
		const method = TRY_DEFAULT_METHOD;
		const args = { prompt, model: TRY_DEFAULT_MODEL, prompt_upsampling: true };

		const server = await queries.selectServerById.get(server_id);
		if (!server || server.status !== "active") {
			return res.status(400).json({
				error: "Invalid server",
				message: "Server not found or not active"
			});
		}

		const placeholderFilename = `creating_anon_admin_${Date.now()}.png`;
		const meta = {
			server_id: Number(server_id),
			server_name: typeof server.name === "string" ? server.name : null,
			method,
			args,
			started_at: new Date().toISOString(),
			admin_generate_for_user_id: targetUserId
		};

		const result = await queries.insertCreatedImageAnon.run(
			prompt,
			placeholderFilename,
			"",
			1024,
			1024,
			"creating",
			meta
		);
		const id = result.insertId;
		if (!id) {
			return res.status(500).json({ error: "Failed to create try record" });
		}

		queries.insertTryRequest?.run?.(
			anonCid.trim(),
			prompt,
			id,
			null,
			buildRequestMeta(req, {
				source: "admin_avatar",
				feature: "admin_avatar_try",
				route: "/admin/users/avatar"
			})
		);

		try {
			await scheduleAnonCreationJob({
				payload: {
					created_image_anon_id: id,
					server_id: Number(server_id),
					method,
					args
				},
				runAnonCreationJob: (opts) => runAnonCreationJob({ queries, storage, payload: opts.payload })
			});
		} catch (err) {
			await queries.updateCreatedImageAnonJobFailed?.run?.(id, {
				meta: { ...meta, failed_at: new Date().toISOString(), error: err?.message || "Schedule failed" }
			});
			return res.status(500).json({ error: "Failed to schedule creation", message: err?.message });
		}

		return res.status(201).json({
			id,
			status: "creating",
			message: "Poll /api/try/list for completion. When status is completed, use the url in PUT /admin/users/:id/profile with avatar_url."
		});
	});

	/** GET /admin/anonymous-users — list unique anon_cids from try_requests with request count and transitioned user (excludes __pool__). Supports limit, offset (0-based). Returns { anonCids, total }. */
	router.get("/admin/anonymous-users", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["last_request_at", "first_request_at", "request_count", "anon_cid", "prsn_cid"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "last_request_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";

		if (!queries.selectTryRequestAnonCidsWithCount?.all) {
			return res.json({ anonCids: [], total: 0 });
		}
		const rows = await queries.selectTryRequestAnonCidsWithCount.all();
		const transitionedByCid = new Map();
		if (queries.selectTryRequestsTransitionedMeta?.all) {
			const transitionedRows = await queries.selectTryRequestsTransitionedMeta.all();
			for (const r of transitionedRows ?? []) {
				const meta = r.meta && typeof r.meta === "object" ? r.meta : typeof r.meta === "string" ? safeJsonParse(r.meta, {}) : {};
				const userId = meta?.transitioned?.user_id != null ? Number(meta.transitioned.user_id) : null;
				if (userId && Number.isFinite(userId) && !transitionedByCid.has(r.anon_cid)) {
					transitionedByCid.set(r.anon_cid, userId);
				}
			}
		}
		const userIds = [...new Set(transitionedByCid.values())];
		const userNameByUserId = new Map();
		for (const uid of userIds) {
			const profile = await queries.selectUserProfileByUserId?.get?.(uid);
			const name = profile?.user_name && String(profile.user_name).trim() ? String(profile.user_name).trim() : null;
			userNameByUserId.set(uid, name);
		}
		const cidsFromShare = new Set(
			(await queries.selectAnonCidsWithShareView?.all?.()) ?? []
		);
		const allCids = rows.map((r) => r.anon_cid);
		let lastMetaByCid = new Map();
		if (queries.selectTryRequestsLatestMetaByCids?.all && allCids.length > 0) {
			const latestRows = await queries.selectTryRequestsLatestMetaByCids.all(allCids);
			for (const row of latestRows ?? []) {
				const meta =
					row.meta && typeof row.meta === "object"
						? row.meta
						: typeof row.meta === "string"
							? safeJsonParse(row.meta, {})
							: {};
				lastMetaByCid.set(row.anon_cid, {
					user_agent: meta?.user_agent ?? null,
					ip: meta?.ip ?? null,
					ip_source: meta?.ip_source ?? null,
					country: meta?.country ?? null,
					region: meta?.region ?? null,
					city: meta?.city ?? null,
					cf_ray: meta?.cf_ray ?? null,
					source: meta?.source ?? null,
					route: meta?.route ?? null,
					prsn_cid: prsnCidFromMeta(meta)
				});
			}
		}
		let allAnonCids = rows.map((row) => {
			const userId = transitionedByCid.get(row.anon_cid);
			const lastMeta = lastMetaByCid.get(row.anon_cid);
			return {
				...row,
				transitioned_user_id: userId ?? null,
				transitioned_user_name: (userId != null ? userNameByUserId.get(userId) : null) ?? null,
				from_share: cidsFromShare.has(row.anon_cid),
				user_agent: lastMeta?.user_agent ?? null,
				ip: lastMeta?.ip ?? null,
				ip_source: lastMeta?.ip_source ?? null,
				country: lastMeta?.country ?? null,
				region: lastMeta?.region ?? null,
				city: lastMeta?.city ?? null,
				cf_ray: lastMeta?.cf_ray ?? null,
				source: lastMeta?.source ?? null,
				route: lastMeta?.route ?? null,
				prsn_cid: lastMeta?.prsn_cid ?? null
			};
		});
		const cmp = (a, b) => {
			const va = a[sortBy];
			const vb = b[sortBy];
			if (va == null && vb == null) return 0;
			if (va == null) return sortDir === "asc" ? 1 : -1;
			if (vb == null) return sortDir === "asc" ? -1 : 1;
			if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
			const sa = String(va);
			const sb = String(vb);
			return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
		};
		allAnonCids.sort(cmp);
		const total = allAnonCids.length;
		const anonCids = allAnonCids.slice(offset, offset + limit);
		res.json({ anonCids, total });
	});

	/** GET /admin/anonymous-users/:cid — requests for this anon_cid (datetime desc) with image details and view URL. */
	router.get("/admin/anonymous-users/:cid", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const cid = typeof req.params?.cid === "string" ? req.params.cid.trim() : "";
		if (!cid) {
			return res.status(400).json({ error: "Invalid anon_cid" });
		}

		const requests = await queries.selectTryRequestsByCid?.all?.(cid) ?? [];
		const imageIds = [...new Set(requests.map((r) => r.created_image_anon_id).filter(Boolean))];
		const images = (await queries.selectCreatedImagesAnonByIds?.all?.(imageIds)) ?? [];
		const imageById = new Map(images.map((img) => [Number(img.id), img]));

		const parseMeta = (m) => {
			if (m == null) return null;
			if (typeof m === "object") return m;
			if (typeof m !== "string" || !m.trim()) return null;
			try {
				return JSON.parse(m);
			} catch {
				return null;
			}
		};

		const requestsWithImage = requests.map((r) => {
			const img = imageById.get(Number(r.created_image_anon_id));
			const imagePath = img?.filename ? `/api/try/images/${encodeURIComponent(img.filename)}` : null;
			const meta = parseMeta(r.meta);
			return {
				id: r.id,
				anon_cid: r.anon_cid,
				prompt: r.prompt,
				created_at: r.created_at,
				fulfilled_at: r.fulfilled_at,
				created_image_anon_id: r.created_image_anon_id,
				prsn_cid: prsnCidFromMeta(meta),
				user_agent: meta?.user_agent ?? null,
				ip: meta?.ip ?? null,
				ip_source: meta?.ip_source ?? null,
				cf_ray: meta?.cf_ray ?? null,
				image: img
					? {
						id: img.id,
						filename: img.filename,
						file_path: img.file_path,
						width: img.width,
						height: img.height,
						status: img.status,
						created_at: img.created_at,
						image_url: imagePath
					}
					: null
			};
		});

		res.json({ anon_cid: cid, requests: requestsWithImage });
	});

	router.get("/admin/share-views", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["id", "viewed_at", "sharer_user_id", "created_image_id", "created_by_user_id", "referer", "anon_cid"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "viewed_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.listSharePageViews?.all) {
			return res.json({ items: [], total: 0 });
		}
		const [items, totalRow] = await Promise.all([
			queries.listSharePageViews.all(limit, offset, sortBy, sortDir),
			queries.countSharePageViews?.get ? queries.countSharePageViews.get() : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;
		const userIds = [...new Set([
			...(items || []).map((v) => v.sharer_user_id),
			...(items || []).map((v) => v.created_by_user_id)
		].filter((id) => id != null))];
		const userLabelByUserId = {};
		for (const uid of userIds) {
			const profile = await queries.selectUserProfileByUserId?.get?.(uid);
			const user = await queries.selectUserById?.get?.(uid);
			const userName = (profile?.user_name ?? "").trim() || null;
			const displayName = (profile?.display_name ?? "").trim() || null;
			const emailLocal = user?.email ? String(user.email).split("@")[0]?.trim() || null : null;
			userLabelByUserId[uid] = displayName || userName || emailLocal || `#${uid}`;
		}
		const parseMeta = (m) => {
			if (m == null) return null;
			if (typeof m === "object") return m;
			if (typeof m !== "string" || !m.trim()) return null;
			try {
				return JSON.parse(m);
			} catch {
				return null;
			}
		};
		const decodeGeo = (s) => {
			if (s == null || typeof s !== "string" || !s.trim()) return null;
			try {
				const decoded = decodeURIComponent(s.trim());
				return decoded || null;
			} catch {
				return s.trim() || null;
			}
		};
		const enriched = (items || []).map((v) => {
			const meta = parseMeta(v.meta);
			return {
				...v,
				sharer_label: userLabelByUserId[v.sharer_user_id] ?? `#${v.sharer_user_id}`,
				creator_label: userLabelByUserId[v.created_by_user_id] ?? `#${v.created_by_user_id}`,
				prsn_cid: prsnCidFromMeta(meta),
				user_agent: meta?.user_agent ?? null,
				ip: meta?.ip ?? null,
				ip_source: meta?.ip_source ?? null,
				country: decodeGeo(meta?.country) ?? null,
				region: decodeGeo(meta?.region) ?? null,
				city: decodeGeo(meta?.city) ?? null,
				cf_ray: meta?.cf_ray ?? null
			};
		});
		res.json({ items: enriched, total });
	});

	/** GET /admin/blog-views — raw blog post view hits (admin). Same shape enrichment as share-views (meta → prsn_cid, IP, geo, cf_ray). */
	router.get("/admin/blog-views", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["id", "viewed_at", "blog_post_id", "post_slug", "campaign_id", "referer", "anon_cid"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "viewed_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.listBlogPostViews?.all) {
			return res.json({ items: [], total: 0 });
		}
		const [items, totalRow] = await Promise.all([
			queries.listBlogPostViews.all(limit, offset, sortBy, sortDir),
			queries.countBlogPostViews?.get ? queries.countBlogPostViews.get() : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;

		const campaignLabelById = new Map();
		if (typeof queries.selectBlogCampaigns?.all === "function") {
			try {
				const campaigns = await queries.selectBlogCampaigns.all();
				for (const c of campaigns ?? []) {
					if (c?.id != null && String(c.id).trim()) {
						campaignLabelById.set(String(c.id).trim(), c);
					}
				}
			} catch {
				// registry optional for display
			}
		}

		function sourceLabelForBlogView(campaignId) {
			const raw = campaignId != null && String(campaignId).trim() ? String(campaignId).trim() : "";
			if (!raw) return "Organic";
			if (raw === BLOG_CAMPAIGN_INTERNAL) return "Feed";
			if (raw === BLOG_CAMPAIGN_INDEX) return "Blog Index";
			const row = campaignLabelById.get(raw);
			const lbl = row && typeof row.label === "string" ? row.label.trim() : "";
			if (lbl) return lbl;
			return raw;
		}

		const parseMeta = (m) => {
			if (m == null) return null;
			if (typeof m === "object") return m;
			if (typeof m !== "string" || !m.trim()) return null;
			try {
				return JSON.parse(m);
			} catch {
				return null;
			}
		};
		const decodeGeo = (s) => {
			if (s == null || typeof s !== "string" || !s.trim()) return null;
			try {
				const decoded = decodeURIComponent(s.trim());
				return decoded || null;
			} catch {
				return s.trim() || null;
			}
		};
		const enriched = (items || []).map((v) => {
			const meta = parseMeta(v.meta);
			const slug = String(v.post_slug || "").trim();
			const campaignRaw = v.campaign_id != null && String(v.campaign_id).trim() ? String(v.campaign_id).trim() : "";
			const postTitle = v.post_title != null && String(v.post_title).trim() ? String(v.post_title).trim() : "";
			return {
				...v,
				post_label: postTitle || slug || "—",
				campaign_or_source: campaignRaw || "organic",
				source_label: sourceLabelForBlogView(v.campaign_id),
				prsn_cid: prsnCidFromMeta(meta),
				user_agent: meta?.user_agent ?? null,
				ip: meta?.ip ?? null,
				ip_source: meta?.ip_source ?? null,
				country: decodeGeo(meta?.country) ?? null,
				region: decodeGeo(meta?.region) ?? null,
				city: decodeGeo(meta?.city) ?? null,
				cf_ray: meta?.cf_ray ?? null
			};
		});
		res.json({ items: enriched, total });
	});

	/** GET /admin/tips — list tip activity with from/to labels and message. Supports limit, offset, sort_by, sort_dir. Returns { items, total }. */
	router.get("/admin/tips", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["id", "created_at", "from_user_id", "to_user_id", "amount", "created_image_id"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "created_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.listTipActivity?.all || !queries.countTipActivity?.get) {
			return res.json({ items: [], total: 0 });
		}
		const [items, totalRow] = await Promise.all([
			queries.listTipActivity.all(limit, offset, sortBy, sortDir),
			queries.countTipActivity.get()
		]);
		const total = totalRow?.count ?? 0;
		const userIds = [...new Set([
			...(items || []).map((r) => r.from_user_id),
			...(items || []).map((r) => r.to_user_id)
		].filter((id) => id != null))];
		const userLabelByUserId = {};
		for (const uid of userIds) {
			const profile = await queries.selectUserProfileByUserId?.get?.(uid);
			const user = await queries.selectUserById?.get?.(uid);
			const userName = (profile?.user_name ?? "").trim() || null;
			const displayName = (profile?.display_name ?? "").trim() || null;
			const emailLocal = user?.email ? String(user.email).split("@")[0]?.trim() || null : null;
			userLabelByUserId[uid] = displayName || userName || emailLocal || `#${uid}`;
		}
		const enriched = (items || []).map((r) => ({
			...r,
			from_label: userLabelByUserId[r.from_user_id] ?? `#${r.from_user_id}`,
			to_label: userLabelByUserId[r.to_user_id] ?? `#${r.to_user_id}`
		}));
		res.json({ items: enriched, total });
	});

	router.get("/admin/moderation", async (req, res) => {
		const items = await queries.selectModerationQueue.all();
		res.json({ items });
	});

	router.get("/admin/providers", async (req, res) => {
		const providers = await queries.selectProviders.all();
		res.json({ providers });
	});

	router.get("/admin/policies", async (req, res) => {
		const policies = await queries.selectPolicies.all();
		res.json({ policies });
	});

	router.get("/admin/jobs", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const jobType = typeof req.query?.job_type === "string" ? req.query.job_type.trim() || null : null;
		const status = typeof req.query?.status === "string" ? req.query.status.trim() || null : null;
		const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["id", "job_type", "status", "created_at", "updated_at"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "created_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.selectJobs?.all) {
			return res.json({ jobs: [], total: 0 });
		}
		const [jobs, totalRow] = await Promise.all([
			queries.selectJobs.all({ jobType, status, limit, offset, sortBy, sortDir }),
			queries.countJobs?.get ? queries.countJobs.get({ jobType, status }) : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;
		res.json({ jobs, total });
	});

	/** GET /admin/try-failures — recent failed try-page generations (created_images_anon status=failed) for visibility. */
	router.get("/admin/try-failures", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		if (!queries.selectFailedCreatedImagesAnonRecent?.all) {
			return res.json({ items: [] });
		}
		const items = await queries.selectFailedCreatedImagesAnonRecent.all(limit);
		res.json({ items });
	});

	router.get("/admin/email-sends", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
		const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
		const validSortBy = ["id", "user_id", "campaign", "created_at"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "created_at";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.listEmailSendsRecent?.all) {
			return res.json({ sends: [], total: 0 });
		}
		const [sends, totalRow] = await Promise.all([
			queries.listEmailSendsRecent.all(limit, offset, sortBy, sortDir),
			queries.countEmailSends?.get ? queries.countEmailSends.get() : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;
		const userIds = [...new Set((sends || []).map((s) => s.user_id).filter((id) => id != null))];
		const userLabelByUserId = {};
		const emailByUserId = {};
		for (const uid of userIds) {
			const [user, profile] = await Promise.all([
				queries.selectUserById?.get?.(uid),
				queries.selectUserProfileByUserId?.get?.(uid)
			]);
			const email = user?.email ?? null;
			if (email) emailByUserId[uid] = email;
			const displayName = (profile?.display_name ?? "").trim() || null;
			const userName = (profile?.user_name ?? "").trim() || null;
			const emailLocal = email ? email.split("@")[0]?.trim() || null : null;
			userLabelByUserId[uid] = displayName || userName || emailLocal || `#${uid}`;
		}
		const sendsWithEmail = (sends || []).map((s) => ({
			id: s.id,
			user_id: s.user_id,
			campaign: s.campaign,
			created_at: s.created_at,
			meta: s.meta ?? null,
			user_email: emailByUserId[s.user_id] ?? null,
			user_label: userLabelByUserId[s.user_id] ?? `#${s.user_id}`
		}));
		res.json({ sends: sendsWithEmail, total });
	});

	router.get("/admin/users/:id/unread-notifications", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const targetUserId = Number.parseInt(String(req.params?.id || ""), 10);
		if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
			return res.status(400).json({ error: "Invalid user id" });
		}

		const targetUser = await queries.selectUserById.get(targetUserId);
		if (!targetUser) {
			return res.status(404).json({ error: "User not found" });
		}

		try {
			const result = await queries.selectUnreadNotificationCount.get(
				targetUserId,
				targetUser?.role || null
			);
			res.json({ count: result?.count ?? 0 });
		} catch (error) {
			res.status(500).json({ error: error?.message || "Failed to get notification count" });
		}
	});

	const VALID_TEST_EMAIL_TEMPLATES = [
		"helloFromParascene",
		"commentReceived",
		"commentReceivedDelegated",
		"featureRequest",
		"featureRequestFeedback",
		"passwordReset",
		"digestActivity",
		"welcome",
		"firstCreationNudge",
		"reengagement",
		"creationHighlight",
		"supportReport"
	];

	function getEmailTemplateSampleData() {
		const baseUrl = getBaseAppUrlForEmail();
		return {
			helloFromParascene: {
				recipientName: "Alex"
			},
			commentReceived: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`
			},
			commentReceivedDelegated: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				impersonation: {
					originalRecipient: {
						name: "Taylor",
						email: "taylor@example.com",
						userId: 123
					},
					reason: "Suppressed recipient"
				}
			},
			featureRequest: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				requesterRole: "consumer",
				requesterCreatedAt: "2024-01-15T10:30:00Z",
				message: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/feed`,
				forwardedFor: "192.168.1.1",
				ip: "192.168.1.1",
				ips: ["192.168.1.1"],
				context: {
					route: "/feed",
					timezone: "America/New_York",
					locale: "en-US",
					platform: "MacIntel",
					colorScheme: "light",
					reducedMotion: "no-preference",
					network: "4g",
					viewportWidth: 1920,
					viewportHeight: 1080,
					screenWidth: 1920,
					screenHeight: 1080,
					devicePixelRatio: 2
				},
				submittedAt: new Date().toISOString()
			},
			featureRequestFeedback: {
				recipientName: "Alex",
				originalRequest: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				message: "We've added your idea to our roadmap. We'll reach out when we have something to share."
			},
			passwordReset: {
				recipientName: "Alex",
				resetUrl: `${baseUrl}/reset-password?rt=sample-token-123`
			},
			digestActivity: {
				recipientName: "Alex",
				activitySummary: "You have 3 creations with new comments.",
				feedUrl: `${baseUrl}/feed`,
				activityItems: [
					{ title: "Sunset Over Mountains", comment_count: 5 },
					{ title: "City Lights at Night", comment_count: 2 }
				],
				otherCreationsActivityItems: [
					{ title: "Ocean Waves", comment_count: 3 }
				]
			},
			welcome: {
				recipientName: "Alex"
			},
			firstCreationNudge: {
				recipientName: "Alex"
			},
			reengagement: {
				recipientName: "Alex"
			},
			creationHighlight: {
				recipientName: "Alex",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				commentCount: 8
			},
			supportReport: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				report: {
					userSummary: "I see a grey box in the Landscape modal and no Generate button. I'm on Windows 11 with Brave.",
					creationId: 2116,
					landscape: {
						creationId: 2116,
						isOwner: true,
						hasImage: false,
						loading: false,
						errorMsg: null,
						genBtnExists: true,
						genBtnVisible: false,
						genBtnDisplay: "none",
						genPromptDisplay: "block",
						placeholderDisplay: "flex",
						errorElDisplay: "none"
					},
					domSummary: {
						modalDisplay: "block",
						modalOpen: true,
						placeholderDisplay: "flex",
						placeholderVisible: true,
						primaryBtnDisplay: "none",
						primaryBtnVisible: false,
						primaryBtnDisabled: false,
						modalContentLength: 420,
						modalContentSnippet: "<div class=\"landscape-placeholder\" data-landscape-placeholder>…"
					},
					context: {
						url: `${baseUrl}/creations/2116`,
						viewportWidth: 1920,
						viewportHeight: 1080,
						screenWidth: 1920,
						screenHeight: 1080,
						devicePixelRatio: 2
					}
				},
				userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/creations/2116`,
				ip: "192.168.1.1",
				submittedAt: new Date().toISOString()
			}
		};
	}

	router.get("/admin/email-templates/:templateName", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const { templateName } = req.params;

		try {
			const { renderEmailTemplate } = await import("../email/index.js");
			const sampleData = getEmailTemplateSampleData();

			// Handle delegated template variants
			let actualTemplateName = templateName;
			if (templateName === "commentReceivedDelegated") {
				actualTemplateName = "commentReceived";
			}

			const data = sampleData[templateName];
			if (!data) {
				return res.status(404).json({ error: `Template "${templateName}" not found` });
			}

			const { html } = renderEmailTemplate(actualTemplateName, data);
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.send(html);
		} catch (error) {
			console.error("[admin] email-templates render failed:", templateName, error?.message || error);
			if (error?.stack) console.error(error.stack);
			res.status(500).json({ error: error?.message || "Failed to render template" });
		}
	});

	router.post("/admin/send-test-email", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
		const template = typeof req.body?.template === "string" ? req.body.template.trim() : "";

		if (!to) {
			return res.status(400).json({ error: "Recipient email is required." });
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
			return res.status(400).json({ error: "Please enter a valid email address." });
		}
		if (!VALID_TEST_EMAIL_TEMPLATES.includes(template)) {
			return res.status(400).json({ error: "Invalid or unknown template." });
		}

		const sampleData = getEmailTemplateSampleData();
		let data = sampleData[template];
		if (!data) {
			return res.status(400).json({ error: "Template has no sample data." });
		}

		// Feature Request Feedback: use admin-provided fields (prefer body over sample when provided)
		if (template === "featureRequestFeedback" && req.body) {
			if (req.body.recipientName !== undefined) {
				data.recipientName = typeof req.body.recipientName === "string" ? req.body.recipientName.trim() || data.recipientName : data.recipientName;
			}
			if (req.body.originalRequest !== undefined) {
				data.originalRequest = typeof req.body.originalRequest === "string" ? req.body.originalRequest.trim() : "";
			}
			if (req.body.message !== undefined) {
				data.message = typeof req.body.message === "string" ? req.body.message.trim() : "";
			}
		}

		let actualTemplateName = template;
		if (template === "commentReceivedDelegated") {
			actualTemplateName = "commentReceived";
		}

		try {
			const { sendTemplatedEmail } = await import("../email/index.js");
			const responseData = await sendTemplatedEmail({
				to: [to],
				template: actualTemplateName,
				data
			});
			res.status(200).json({ ok: true, id: responseData?.id ?? null });
		} catch (error) {
			const message = error?.message || "Failed to send test email.";
			res.status(500).json({ error: message });
		}
	});

	/** POST /admin/run-notifications-cron — run the notifications/digest cron now (admin-only). Returns same payload as cron handler. */
	router.post("/admin/run-notifications-cron", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		try {
			const result = await runNotificationsCronForTests({ queries });
			res.status(200).json(result);
		} catch (error) {
			console.error("[Admin] run-notifications-cron failed:", error);
			res.status(500).json({ ok: false, error: error?.message ?? "Cron failed" });
		}
	});

	router.get("/admin/settings", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;
		const s = await getEmailSettings(queries);
		res.json({
			email_use_test_recipient: s.emailUseTestRecipient,
			email_dry_run: s.dryRun,
			digest_utc_windows: s.digestUtcWindowsRaw,
			max_digests_per_user_per_day: String(s.maxDigestsPerUserPerDay),
			digest_activity_hours_lookback: String(s.activityHoursLookback),
			welcome_email_delay_hours: String(s.welcomeEmailDelayHours),
			reengagement_inactive_days: s.reengagementInactiveDays,
			reengagement_cooldown_days: s.reengagementCooldownDays,
			creation_highlight_lookback_hours: s.creationHighlightLookbackHours,
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays,
			creation_highlight_min_comments: s.creationHighlightMinComments
		});
	});

	router.patch("/admin/settings", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;
		const body = req.body || {};
		if (typeof body.email_use_test_recipient === "boolean") {
			const value = body.email_use_test_recipient ? "true" : "false";
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run(
					"email_use_test_recipient",
					value,
					"When true, all lifecycle/transactional emails go to delivered@resend.dev"
				);
			}
		}
		if (typeof body.email_dry_run === "boolean") {
			const value = body.email_dry_run ? "true" : "false";
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("email_dry_run", value, "When true, cron records digest sends but does not send email.");
			}
		}
		if (typeof body.digest_utc_windows === "string") {
			const value = body.digest_utc_windows.trim();
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("digest_utc_windows", value || "09:00,18:00", "UTC times (HH:MM) when digest may run, comma-separated.");
			}
		}
		if (typeof body.max_digests_per_user_per_day !== "undefined") {
			const value = String(Math.max(0, parseInt(body.max_digests_per_user_per_day, 10) || 0));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("max_digests_per_user_per_day", value, "Max digest emails per user per UTC day.");
			}
		}
		if (typeof body.digest_activity_hours_lookback !== "undefined") {
			const value = String(Math.max(1, parseInt(body.digest_activity_hours_lookback, 10) || 24));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("digest_activity_hours_lookback", value, "Hours to look back for unread activity when building digest candidates.");
			}
		}
		if (typeof body.welcome_email_delay_hours !== "undefined") {
			const value = String(Math.max(0, parseInt(body.welcome_email_delay_hours, 10) || 0));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("welcome_email_delay_hours", value, "Hours after signup before a user is eligible for the welcome email (0 = immediate).");
			}
		}
		if (typeof body.reengagement_inactive_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.reengagement_inactive_days, 10) || 14));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("reengagement_inactive_days", value, "Days of inactivity before a user is eligible for re-engagement email.");
			}
		}
		if (typeof body.reengagement_cooldown_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.reengagement_cooldown_days, 10) || 30));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("reengagement_cooldown_days", value, "Minimum days between re-engagement emails per user.");
			}
		}
		if (typeof body.creation_highlight_lookback_hours !== "undefined") {
			const value = String(Math.max(1, parseInt(body.creation_highlight_lookback_hours, 10) || 48));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_lookback_hours", value, "Hours to look back for comments to consider a creation 'hot' for highlight email.");
			}
		}
		if (typeof body.creation_highlight_cooldown_days !== "undefined") {
			const value = String(Math.max(1, parseInt(body.creation_highlight_cooldown_days, 10) || 7));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_cooldown_days", value, "Minimum days between creation highlight emails per user.");
			}
		}
		if (typeof body.creation_highlight_min_comments !== "undefined") {
			const value = String(Math.max(0, parseInt(body.creation_highlight_min_comments, 10) || 1));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run("creation_highlight_min_comments", value, "Minimum comments on a creation in the lookback window to send a highlight email.");
			}
		}
		const s = await getEmailSettings(queries);
		res.json({
			email_use_test_recipient: s.emailUseTestRecipient,
			email_dry_run: s.dryRun,
			digest_utc_windows: s.digestUtcWindowsRaw,
			max_digests_per_user_per_day: String(s.maxDigestsPerUserPerDay),
			digest_activity_hours_lookback: String(s.activityHoursLookback),
			welcome_email_delay_hours: String(s.welcomeEmailDelayHours),
			reengagement_inactive_days: s.reengagementInactiveDays,
			reengagement_cooldown_days: s.reengagementCooldownDays,
			creation_highlight_lookback_hours: s.creationHighlightLookbackHours,
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays,
			creation_highlight_min_comments: s.creationHighlightMinComments
		});
	});

	/** GET /admin/users/settings — user/tip policy settings for the Users page. Admin-only. */
	router.get("/admin/users/settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const minDaysRow = await queries.selectPolicyByKey?.get?.("min_days_before_tip");
		const minDaysRaw = minDaysRow?.value != null ? String(minDaysRow.value).trim() : "";
		const minDaysBeforeTip = Math.max(0, parseInt(minDaysRaw, 10) || 60);
		res.json({ min_days_before_tip: minDaysBeforeTip });
	});

	/** PATCH /admin/users/settings — update user/tip policy settings. Admin-only. */
	router.patch("/admin/users/settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const body = req.body || {};
		if (typeof body.min_days_before_tip !== "undefined") {
			const value = String(Math.max(0, parseInt(body.min_days_before_tip, 10) || 60));
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run(
					"min_days_before_tip",
					value,
					"Minimum days a user must be present before they can tip (free accounts only; upgraded plans are exempt)."
				);
			}
		}
		const minDaysRow = await queries.selectPolicyByKey?.get?.("min_days_before_tip");
		const minDaysRaw = minDaysRow?.value != null ? String(minDaysRow.value).trim() : "";
		const minDaysBeforeTip = Math.max(0, parseInt(minDaysRaw, 10) || 60);
		res.json({ min_days_before_tip: minDaysBeforeTip });
	});

	/** GET /admin/related-settings — all related.* keys and values. Admin-only. */
	router.get("/admin/related-settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		if (!queries.getRelatedParams?.get) {
			return res.json({});
		}
		const settings = await queries.getRelatedParams.get();
		res.json(settings);
	});

	/** PATCH /admin/related-settings — body: flat key/value (e.g. related.lineage_weight: 100). Upsert each into policy_knobs. Admin-only. */
	router.patch("/admin/related-settings", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const validKeys = new Set(RELATED_PARAM_KEYS);
		for (const [key, value] of Object.entries(body)) {
			if (!validKeys.has(key) || value === undefined) continue;
			const strValue = String(value);
			if (queries.upsertPolicyKey?.run) {
				await queries.upsertPolicyKey.run(key, strValue, null);
			}
		}
		const settings = await queries.getRelatedParams?.get?.() ?? {};
		res.json(settings);
	});

	/** GET /admin/transitions — offset or page, limit, sort_by, sort_dir. Response: { items, total, hasMore }. Admin-only. */
	router.get("/admin/transitions", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
		const offset = typeof req.query?.offset !== "undefined"
			? Math.max(0, parseInt(req.query.offset, 10) || 0)
			: (Math.max(1, parseInt(req.query?.page, 10) || 1) - 1) * limit;
		const page = Math.floor(offset / limit) + 1;
		const validSortBy = ["from_created_image_id", "to_created_image_id", "count", "last_updated"];
		const sortBy = validSortBy.includes(req.query?.sort_by) ? req.query.sort_by : "count";
		const sortDir = String(req.query?.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
		if (!queries.selectTransitions?.list) {
			return res.json({ items: [], total: 0, hasMore: false });
		}
		const result = await queries.selectTransitions.list({ page, limit, sortBy, sortDir });
		const items = result.items ?? [];
		const total = result.total ?? 0;
		const hasMore = result.hasMore ?? (offset + items.length < total);
		res.json({ items, total, hasMore });
	});

	router.get("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		res.json({ server });
	});

	router.put("/admin/servers/:id", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const payload = req.body || {};

		const nextServer = {
			...server
		};

		if (payload.user_id !== undefined) {
			const nextUserId = Number(payload.user_id);
			if (!Number.isFinite(nextUserId) || nextUserId <= 0) {
				return res.status(400).json({ error: "user_id must be a positive number when provided" });
			}
			nextServer.user_id = nextUserId;
		}

		if (payload.name !== undefined) {
			const nextName = String(payload.name || "").trim();
			if (!nextName) {
				return res.status(400).json({ error: "name must be a non-empty string when provided" });
			}
			nextServer.name = nextName;
		}

		if (payload.status !== undefined) {
			const nextStatus = String(payload.status || "").trim();
			if (!nextStatus) {
				return res.status(400).json({ error: "status must be a non-empty string when provided" });
			}
			nextServer.status = nextStatus;
		}

		if (payload.server_url !== undefined) {
			if (typeof payload.server_url !== "string" || payload.server_url.trim() === "") {
				return res.status(400).json({ error: "server_url must be a non-empty string when provided" });
			}
			let providerUrl;
			try {
				providerUrl = new URL(payload.server_url.trim());
				if (!['http:', 'https:'].includes(providerUrl.protocol)) {
					return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
				}
			} catch (urlError) {
				return res.status(400).json({ error: "server_url must be a valid URL" });
			}
			nextServer.server_url = providerUrl.toString().replace(/\/$/, '');
		}

		if (payload.auth_token !== undefined) {
			if (payload.auth_token !== null && typeof payload.auth_token !== "string") {
				return res.status(400).json({ error: "auth_token must be a string when provided" });
			}
			nextServer.auth_token = resolveProviderAuthToken(payload.auth_token);
		}

		if (payload.status_date !== undefined) {
			nextServer.status_date = payload.status_date || null;
		}

		if (payload.description !== undefined) {
			nextServer.description = payload.description || null;
		}

		if (payload.members_count !== undefined) {
			const nextMembersCount = Number(payload.members_count);
			if (!Number.isFinite(nextMembersCount) || nextMembersCount < 0) {
				return res.status(400).json({ error: "members_count must be a non-negative number when provided" });
			}
			nextServer.members_count = Math.floor(nextMembersCount);
		}

		if (payload.server_config !== undefined) {
			nextServer.server_config = payload.server_config || null;
		}

		const updateResult = await queries.updateServer.run(serverId, nextServer);
		if (updateResult.changes === 0) {
			return res.status(500).json({ error: "Failed to update server" });
		}

		return res.status(200).json({
			success: true,
			server: nextServer
		});
	});

	router.post("/admin/servers/:id/test", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders(
					{
						'Accept': 'application/json'
					},
					server.auth_token,
					server.server_config?.custom_headers
				),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			return res.status(200).json({
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	/** POST /admin/creations/:id/upload-video — Admin-only: upload a video file to attach to a creation (failed or completed). Makes it a video creation. */
	router.post("/admin/creations/:id/upload-video", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const creationId = Number(req.params.id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation ID" });
		}

		const creation = await queries.selectCreatedImageByIdAnyUser?.get(creationId);
		if (!creation) {
			return res.status(404).json({ error: "Creation not found" });
		}

		if (!req.is("multipart/form-data")) {
			return res.status(400).json({ error: "Content-Type must be multipart/form-data with a video file" });
		}

		if (typeof storage?.uploadVideo !== "function") {
			return res.status(503).json({ error: "Video upload not supported" });
		}

		const maxVideoBytes = 150 * 1024 * 1024; // 150 MB
		let videoBuffer = null;
		let contentType = "video/mp4";

		try {
			const result = await new Promise((resolve, reject) => {
				let resolved = false;
				const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxVideoBytes, files: 1, fields: 5 } });
				busboy.on("file", (name, file, info) => {
					if (name !== "video" && name !== "video_file") return file.resume();
					const chunks = [];
					let total = 0;
					file.on("data", (data) => {
						total += data.length;
						chunks.push(data);
					});
					file.on("limit", () => reject(new Error("File too large")));
					file.on("end", () => {
						if (!resolved && total > 0) {
							resolved = true;
							resolve({
								buffer: Buffer.concat(chunks),
								contentType: (info?.mimeType && info.mimeType.startsWith("video/")) ? info.mimeType : "video/mp4"
							});
						}
					});
				});
				busboy.on("error", reject);
				busboy.on("finish", () => {
					if (!resolved) resolve(null);
				});
				req.pipe(busboy);
			});

			if (!result?.buffer || result.buffer.length === 0) {
				return res.status(400).json({ error: "No video file provided. Use form field 'video' or 'video_file'." });
			}
			videoBuffer = result.buffer;
			contentType = result.contentType || "video/mp4";
		} catch (err) {
			if (err?.message === "File too large") {
				return res.status(413).json({ error: "Video file too large" });
			}
			return res.status(400).json({ error: "Invalid multipart body", message: err?.message || "Bad request" });
		}

		const ext = contentType.startsWith("video/") ? contentType.split("/")[1].split("+")[0].split(";")[0].trim() || "mp4" : "mp4";
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 9);
		const videoFilename = `video/${creation.user_id}_${creationId}_${timestamp}_${random}.${ext}`;

		let videoUrl;
		try {
			videoUrl = await storage.uploadVideo(videoBuffer, videoFilename, { contentType });
		} catch (err) {
			return res.status(500).json({ error: "Failed to upload video", message: err?.message || "Upload failed" });
		}

		function parseMeta(raw) {
			if (raw == null) return {};
			if (typeof raw === "object") return raw;
			if (typeof raw !== "string" || !raw.trim()) return {};
			try {
				return JSON.parse(raw);
			} catch {
				return {};
			}
		}

		const existingMeta = parseMeta(creation.meta);

		function firstImageUrlFromMeta(meta) {
			if (!meta || typeof meta !== "object") return null;
			const trim = (v) => (typeof v === "string" ? v.trim() : "") || null;
			const looksLikeUrl = (s) => typeof s === "string" && s.length > 4 && (s.startsWith("http") || s.startsWith("/"));
			const candidates = [
				meta.source_image_url,
				meta.args?.image_url,
				meta.args?.image,
				meta.args?.input_image,
				meta.args?.reference_image,
				meta.args?.init_image,
				meta.args?.source_url,
				meta.args?.source_image,
			];
			for (const v of candidates) {
				const s = trim(v);
				if (s && looksLikeUrl(s)) return s;
			}
			const args = meta.args && typeof meta.args === "object" ? meta.args : {};
			const imageUrlLikeKeys = ["image_url", "image", "input_image", "reference_image", "init_image", "source_url", "source_image", "url"];
			for (const k of imageUrlLikeKeys) {
				const s = trim(args[k]);
				if (s && looksLikeUrl(s)) return s;
			}
			if (Array.isArray(meta.args?.items) && meta.args.items.length > 0) {
				const first = meta.args.items[0];
				if (first && typeof first === "object") {
					for (const k of imageUrlLikeKeys) {
						const s = trim(first[k]);
						if (s && looksLikeUrl(s)) return s;
					}
				}
			}
			for (const [k, v] of Object.entries(args)) {
				if (typeof v === "string" && looksLikeUrl(v)) return v.trim();
			}
			return null;
		}

		const sourceImageUrl = firstImageUrlFromMeta(existingMeta);
		const mergedMeta = {
			...existingMeta,
			media_type: "video",
			...(sourceImageUrl ? { source_image_url: sourceImageUrl } : {}),
			video: {
				filename: videoFilename,
				file_path: videoUrl,
				content_type: contentType
			}
		};

		const hasThumbnail = creation.file_path && String(creation.file_path).trim() !== "";
		if (!hasThumbnail && typeof storage.uploadImage === "function") {
			let thumbBuffer;
			try {
				thumbBuffer = sourceImageUrl
					? await fetchImageBufferFromUrl(sourceImageUrl)
					: await createPlaceholderImageBuffer();
			} catch (err) {
				thumbBuffer = await createPlaceholderImageBuffer();
			}
			const thumbFilename = `${creation.user_id}_${creationId}_${timestamp}_${random}.png`;
			let thumbUrl;
			try {
				thumbUrl = await storage.uploadImage(thumbBuffer, thumbFilename);
			} catch (err) {
				return res.status(500).json({ error: "Failed to upload thumbnail image", message: err?.message || "Upload failed" });
			}
			let width = creation.width ?? null;
			let height = creation.height ?? null;
			try {
				const metaSharp = await sharp(thumbBuffer, { failOn: "none" }).metadata();
				if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
				if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
			} catch {
				// keep existing or null
			}
			const completedResult = await queries.updateCreatedImageJobCompleted.run(creationId, creation.user_id, {
				filename: thumbFilename,
				file_path: thumbUrl,
				width,
				height,
				color: creation.color ?? null,
				meta: mergedMeta
			});
			if (completedResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update creation with thumbnail" });
			}
			return res.json({ ok: true, video_url: videoUrl });
		}

		const updateMetaResult = await queries.updateCreatedImageMeta.run(creationId, creation.user_id, mergedMeta);
		if (updateMetaResult.changes === 0) {
			return res.status(500).json({ error: "Failed to update creation meta" });
		}

		const status = creation.status || "completed";
		if (status === "failed") {
			await queries.updateCreatedImageStatus?.run(creationId, creation.user_id, "completed");
		}

		return res.json({ ok: true, video_url: videoUrl });
	});

	router.post("/admin/servers/:id/refresh", async (req, res) => {
		const user = await requireAdmin(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders(
					{
						'Accept': 'application/json'
					},
					server.auth_token,
					server.server_config?.custom_headers
				),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}
			const capabilitiesWithCustom = {
				...capabilities,
				custom_headers: server.server_config?.custom_headers ?? capabilities.custom_headers
			};

			// Update server config in database
			const updateResult = await queries.updateServerConfig.run(serverId, capabilitiesWithCustom);

			if (updateResult.changes === 0) {
				return res.status(500).json({
					error: "Failed to update server configuration"
				});
			}

			return res.status(200).json({
				success: true,
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	return router;
}
