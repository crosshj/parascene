import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";
import { getEmailSettings } from "./utils/emailSettings.js";

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
		let createdImages = [];
		try {
			if (queries.selectCreatedImagesForUser?.all) {
				createdImages = await queries.selectCreatedImagesForUser.all(targetUserId);
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

	/** GET /admin/anonymous-users — list unique anon_cids from try_requests with request count (excludes __pool__). */
	router.get("/admin/anonymous-users", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		if (!queries.selectTryRequestAnonCidsWithCount?.all) {
			return res.json({ anonCids: [] });
		}
		const rows = await queries.selectTryRequestAnonCidsWithCount.all();
		res.json({ anonCids: rows });
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

		const requestsWithImage = requests.map((r) => {
			const img = imageById.get(Number(r.created_image_anon_id));
			const imagePath = img?.filename ? `/api/try/images/${encodeURIComponent(img.filename)}` : null;
			return {
				id: r.id,
				anon_cid: r.anon_cid,
				prompt: r.prompt,
				created_at: r.created_at,
				fulfilled_at: r.fulfilled_at,
				created_image_anon_id: r.created_image_anon_id,
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

	router.get("/admin/email-sends", async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;
		const pageSize = parseInt(req.query?.limit, 10);
		const limit = [10, 50, 100].includes(pageSize) ? pageSize : 50;
		const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
		const offset = (page - 1) * limit;
		if (!queries.listEmailSendsRecent?.all) {
			return res.json({ sends: [], total: 0 });
		}
		const [sends, totalRow] = await Promise.all([
			queries.listEmailSendsRecent.all(limit, offset),
			queries.countEmailSends?.get ? queries.countEmailSends.get() : Promise.resolve({ count: 0 })
		]);
		const total = totalRow?.count ?? 0;
		const userIds = [...new Set((sends || []).map((s) => s.user_id).filter((id) => id != null))];
		const emailByUserId = {};
		for (const uid of userIds) {
			const user = await queries.selectUserById?.get?.(uid);
			if (user?.email) emailByUserId[uid] = user.email;
		}
		const sendsWithEmail = (sends || []).map((s) => ({
			id: s.id,
			user_id: s.user_id,
			campaign: s.campaign,
			created_at: s.created_at,
			meta: s.meta ?? null,
			user_email: emailByUserId[s.user_id] ?? null
		}));
		res.json({ sends: sendsWithEmail, total });
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
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays
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
			creation_highlight_cooldown_days: s.creationHighlightCooldownDays
		});
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
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
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
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
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

			// Update server config in database
			const updateResult = await queries.updateServerConfig.run(serverId, capabilities);

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
