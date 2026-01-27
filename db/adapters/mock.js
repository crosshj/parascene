import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const users = [];
const user_profiles = [];
const moderation_queue = [];
const servers = [];
const server_members = [];
const policy_knobs = [];
const notifications = [];
const feed_items = [];
const explore_items = [];
const creations = [];
const templates = [];
const user_follows = [];

const created_images = [];
const sessions = [];
const user_credits = [];
const likes_created_image = [];
const comments_created_image = [];

// On Vercel, use /tmp directory which is writable
// Otherwise use the local data directory
const dataDir = process.env.VERCEL
	? "/tmp/parascene-data"
	: path.join(__dirname, "..", "data");
const imagesDir = path.join(dataDir, "images", "created");
const genericImagesDir = path.join(dataDir, "images", "generic");

function ensureImagesDir() {
	try {
		if (!fs.existsSync(imagesDir)) {
			fs.mkdirSync(imagesDir, { recursive: true });
		}
	} catch (error) {
		// If directory creation fails (e.g., on Vercel without /tmp access),
		// log a warning but don't throw - images will be stored in memory only
		console.warn(`Warning: Could not create images directory: ${error.message}`);
		console.warn("Images will not be persisted to disk. Consider using Supabase adapter on Vercel.");
	}
}

function ensureGenericImagesDir() {
	try {
		if (!fs.existsSync(genericImagesDir)) {
			fs.mkdirSync(genericImagesDir, { recursive: true });
		}
	} catch (error) {
		console.warn(`Warning: Could not create generic images directory: ${error.message}`);
	}
}

const TABLE_TIMESTAMP_FIELDS = {
	users: ["created_at"],
	user_profiles: ["created_at", "updated_at"],
	moderation_queue: ["created_at"],
	servers: ["created_at", "updated_at", "status_date"],
	policy_knobs: ["updated_at"],
	notifications: ["created_at"],
	feed_items: ["created_at"],
	explore_items: ["created_at"],
	creations: ["created_at"],
	templates: ["created_at"],
	created_images: ["created_at"],
	user_follows: ["created_at"]
};

export function openDb() {
	let nextUserId = users.length + 1;
	let nextNotificationId = notifications.length + 1;
	let nextUserCreditsId = user_credits.length + 1;

	const queries = {
		selectUserByEmail: {
			get: async (email) => users.find((user) => user.email === email)
		},
		selectUserById: {
			get: async (id) => {
				const user = users.find((entry) => entry.id === Number(id));
				if (!user) return undefined;
				const { password_hash, ...safeUser } = user;
				return safeUser;
			}
		},
		selectUserProfileByUserId: {
			get: async (userId) =>
				user_profiles.find((row) => row.user_id === Number(userId))
		},
		selectUserProfileByUsername: {
			get: async (userName) =>
				user_profiles.find((row) => row.user_name === String(userName))
		},
		upsertUserProfile: {
			run: async (userId, profile) => {
				const id = Number(userId);
				const now = new Date().toISOString();
				const existing = user_profiles.find((row) => row.user_id === id);
				const next = {
					user_id: id,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					about: profile?.about ?? null,
					socials: profile?.socials ?? null,
					avatar_url: profile?.avatar_url ?? null,
					cover_image_url: profile?.cover_image_url ?? null,
					badges: profile?.badges ?? null,
					meta: profile?.meta ?? null,
					created_at: existing?.created_at ?? now,
					updated_at: now
				};
				if (existing) {
					Object.assign(existing, next);
				} else {
					user_profiles.push(next);
				}
				return { changes: 1 };
			}
		},
		selectSessionByTokenHash: {
			get: async (tokenHash, userId) =>
				sessions.find(
					(session) =>
						session.token_hash === tokenHash &&
						session.user_id === Number(userId)
				)
		},
		insertUser: {
			run: async (email, password_hash, role) => {
				const user = {
					id: nextUserId++,
					email,
					password_hash,
					role,
					created_at: new Date().toISOString()
				};
				users.push(user);
				// Standardize return value: use insertId (also support lastInsertRowid for backward compat)
				return { insertId: user.id, lastInsertRowid: user.id, changes: 1 };
			}
		},
		insertSession: {
			run: async (userId, tokenHash, expiresAt) => {
				const session = {
					id: sessions.length > 0
						? Math.max(...sessions.map((s) => s.id || 0)) + 1
						: 1,
					user_id: Number(userId),
					token_hash: tokenHash,
					expires_at: expiresAt,
					created_at: new Date().toISOString()
				};
				sessions.push(session);
				return { insertId: session.id, lastInsertRowid: session.id, changes: 1 };
			}
		},
		refreshSessionExpiry: {
			run: async (id, expiresAt) => {
				const session = sessions.find((entry) => entry.id === Number(id));
				if (!session) {
					return { changes: 0 };
				}
				session.expires_at = expiresAt;
				return { changes: 1 };
			}
		},
		deleteSessionByTokenHash: {
			run: async (tokenHash, userId) => {
				const beforeCount = sessions.length;
				if (userId) {
					for (let i = sessions.length - 1; i >= 0; i -= 1) {
						if (
							sessions[i].token_hash === tokenHash &&
							sessions[i].user_id === Number(userId)
						) {
							sessions.splice(i, 1);
						}
					}
				} else {
					for (let i = sessions.length - 1; i >= 0; i -= 1) {
						if (sessions[i].token_hash === tokenHash) {
							sessions.splice(i, 1);
						}
					}
				}
				return { changes: beforeCount - sessions.length };
			}
		},
		deleteExpiredSessions: {
			run: async (nowIso) => {
				const beforeCount = sessions.length;
				const nowMs = Date.parse(nowIso);
				for (let i = sessions.length - 1; i >= 0; i -= 1) {
					const expiresAtMs = Date.parse(sessions[i].expires_at);
					if (
						Number.isFinite(nowMs) &&
						Number.isFinite(expiresAtMs) &&
						expiresAtMs <= nowMs
					) {
						sessions.splice(i, 1);
					}
				}
				return { changes: beforeCount - sessions.length };
			}
		},
		selectUsers: {
			all: async () =>
				users.map(({ password_hash, ...safeUser }) => {
					const profile = user_profiles.find(
						(row) => row.user_id === Number(safeUser.id)
					);
					return {
						...safeUser,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				})
		},
		selectModerationQueue: {
			all: async () => [...moderation_queue]
		},
		selectProviders: {
			all: async () => {
				// Join with users to get owner email
				return servers.map(provider => {
					const user = users.find(u => u.id === provider.user_id);
					return {
						...provider,
						owner_email: user?.email || null
					};
				});
			}
		},
		insertProvider: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null) => {
				const id = servers.length + 1;
				const now = new Date().toISOString();
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				servers.push({
					id,
					user_id: userId,
					name,
					status,
					server_url: serverUrl,
					auth_token: resolvedAuthToken,
					status_date: null,
					description: null,
					members_count: 0,
					server_config: serverConfig,
					created_at: now,
					updated_at: now
				});
				return Promise.resolve({
					insertId: id,
					changes: 1
				});
			}
		},
		selectPolicies: {
			all: async () => [...policy_knobs]
		},
		selectNotificationsForUser: {
			all: async (userId, role) =>
				notifications.filter(
					(note) => note.user_id === userId || note.role === role
				)
		},
		selectUnreadNotificationCount: {
			get: async (userId, role) => ({
				count: notifications.filter(
					(note) =>
						!note.acknowledged_at &&
						(note.user_id === userId || note.role === role)
				).length
			})
		},
		acknowledgeNotificationById: {
			run: async (id, userId, role) => {
				const notification = notifications.find(
					(note) =>
						note.id === Number(id) &&
						!note.acknowledged_at &&
						(note.user_id === userId || note.role === role)
				);
				if (!notification) {
					return { changes: 0 };
				}
				notification.acknowledged_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		insertNotification: {
			run: async (userId, role, title, message, link) => {
				const notification = {
					id: nextNotificationId++,
					user_id: userId ?? null,
					role: role ?? null,
					title,
					message,
					link: link ?? null,
					created_at: new Date().toISOString(),
					acknowledged_at: null
				};
				notifications.push(notification);
				return { insertId: notification.id, lastInsertRowid: notification.id, changes: 1 };
			}
		},
		selectFeedItems: {
			all: async (excludeUserId) => {
				const viewerId = excludeUserId ?? null;
				if (viewerId === null || viewerId === undefined) {
					return [];
				}

				const followingIdSet = new Set(
					user_follows
						.filter((row) => row.follower_id === Number(viewerId))
						.map((row) => String(row.following_id))
				);

				const filtered = feed_items.filter((item) => {
					const authorId = item.user_id ?? null;
					if (authorId === null || authorId === undefined) return false;
					return followingIdSet.has(String(authorId));
				});

				return filtered.map((item) => {
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectExploreFeedItems: {
			all: async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return [];
				}

				// Get list of users the viewer follows to exclude them from explore
				const viewerIdNum = Number(id);
				const followingIds = new Set(
					user_follows
						.filter((row) => row.follower_id === viewerIdNum)
						.map((row) => Number(row.following_id))
				);

				const filtered = feed_items
					.filter((item) => {
						if (item.user_id === null || item.user_id === undefined) return false;
						const itemUserId = Number(item.user_id);
						// Exclude items from the viewer themselves
						if (itemUserId === viewerIdNum) return false;
						// Exclude items from users the viewer follows
						return !followingIds.has(itemUserId);
					})
					.slice()
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

				return filtered.map((item) => {
					const profile = user_profiles.find((p) => p.user_id === Number(item.user_id));
					return {
						...item,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		insertUserFollow: {
			run: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { changes: 0 };
				if (a === b) return { changes: 0 };
				const exists = user_follows.some((row) => row.follower_id === a && row.following_id === b);
				if (exists) return { changes: 0 };
				user_follows.push({ follower_id: a, following_id: b, created_at: new Date().toISOString() });
				return { changes: 1 };
			}
		},
		deleteUserFollow: {
			run: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				const idx = user_follows.findIndex((row) => row.follower_id === a && row.following_id === b);
				if (idx === -1) return { changes: 0 };
				user_follows.splice(idx, 1);
				return { changes: 1 };
			}
		},
		selectUserFollowStatus: {
			get: async (followerId, followingId) => {
				const a = Number(followerId);
				const b = Number(followingId);
				const exists = user_follows.some((row) => row.follower_id === a && row.following_id === b);
				return exists ? { viewer_follows: 1 } : undefined;
			}
		},
		selectUserFollowers: {
			all: async (userId) => {
				const id = Number(userId);
				const rows = user_follows
					.filter((row) => row.following_id === id)
					.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
				return rows.map((row) => {
					const profile = user_profiles.find((p) => p.user_id === Number(row.follower_id));
					return {
						user_id: row.follower_id,
						followed_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectUserFollowing: {
			all: async (userId) => {
				const id = Number(userId);
				const rows = user_follows
					.filter((row) => row.follower_id === id)
					.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
				return rows.map((row) => {
					const profile = user_profiles.find((p) => p.user_id === Number(row.following_id));
					return {
						user_id: row.following_id,
						followed_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectExploreItems: {
			all: async () => [...explore_items]
		},
		selectCreationsForUser: {
			all: async (userId) => creations.filter((creation) => creation.user_id === Number(userId))
		},
		selectServers: {
			all: async () => {
				// Join with users to get owner email
				return servers.map(server => {
					const user = users.find(u => u.id === server.user_id);
					return {
						...server,
						owner_email: user?.email || null
					};
				});
			}
		},
		selectServerById: {
			get: async (serverId) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (!server) return null;
				const user = users.find(u => u.id === server.user_id);
				return {
					...server,
					owner_email: user?.email || null
				};
			}
		},
		updateServerConfig: {
			run: async (serverId, serverConfig) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (server) {
					server.server_config = serverConfig;
					server.updated_at = new Date().toISOString();
					return { changes: 1 };
				}
				return { changes: 0 };
			}
		},
		updateServer: {
			run: async (serverId, nextServer) => {
				const server = servers.find(s => s.id === Number(serverId));
				if (!server) {
					return { changes: 0 };
				}
				server.user_id = nextServer?.user_id ?? server.user_id;
				server.name = nextServer?.name ?? server.name;
				server.status = nextServer?.status ?? server.status;
				server.server_url = nextServer?.server_url ?? server.server_url;
				server.auth_token = nextServer?.auth_token ?? null;
				server.status_date = nextServer?.status_date ?? server.status_date ?? null;
				server.description = nextServer?.description ?? server.description ?? null;
				server.members_count = nextServer?.members_count ?? server.members_count ?? 0;
				server.server_config = nextServer?.server_config ?? server.server_config ?? null;
				server.updated_at = new Date().toISOString();
				return { changes: 1 };
			}
		},
		checkServerMembership: {
			get: async (serverId, userId) => {
				return server_members.some(
					m => m.server_id === Number(serverId) && m.user_id === Number(userId)
				);
			}
		},
		addServerMember: {
			run: async (serverId, userId) => {
				const serverIdNum = Number(serverId);
				const userIdNum = Number(userId);
				
				// Check if already a member
				if (server_members.some(m => m.server_id === serverIdNum && m.user_id === userIdNum)) {
					return { changes: 0 };
				}
				
				server_members.push({
					server_id: serverIdNum,
					user_id: userIdNum,
					created_at: new Date().toISOString()
				});
				
				// Update members_count
				const server = servers.find(s => s.id === serverIdNum);
				if (server) {
					server.members_count = (server.members_count || 0) + 1;
				}
				
				return { changes: 1 };
			}
		},
		removeServerMember: {
			run: async (serverId, userId) => {
				const serverIdNum = Number(serverId);
				const userIdNum = Number(userId);
				const index = server_members.findIndex(
					m => m.server_id === serverIdNum && m.user_id === userIdNum
				);
				
				if (index === -1) {
					return { changes: 0 };
				}
				
				server_members.splice(index, 1);
				
				// Update members_count
				const server = servers.find(s => s.id === serverIdNum);
				if (server) {
					server.members_count = Math.max(0, (server.members_count || 0) - 1);
				}
				
				return { changes: 1 };
			}
		},
		insertServer: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null, description = null) => {
				const id = servers.length > 0
					? Math.max(...servers.map(s => s.id || 0)) + 1
					: 1;
				const now = new Date().toISOString();
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				servers.push({
					id,
					user_id: userId,
					name,
					status,
					server_url: serverUrl,
					auth_token: resolvedAuthToken,
					status_date: null,
					description: description || null,
					members_count: 0,
					server_config: serverConfig,
					created_at: now,
					updated_at: now
				});
				return Promise.resolve({
					insertId: id,
					changes: 1
				});
			}
		},
		selectTemplates: {
			all: async () => [...templates]
		},
		insertCreatedImage: {
			run: async (userId, filename, filePath, width, height, color, status = 'creating') => {
				const image = {
					id: created_images.length > 0
						? Math.max(...created_images.map(i => i.id || 0)) + 1
						: 1,
					user_id: userId,
					filename,
					file_path: filePath,
					width,
					height,
					color,
					status,
					created_at: new Date().toISOString()
				};
				created_images.push(image);
				return {
					insertId: image.id,
					lastInsertRowid: image.id,
					changes: 1
				};
			}
		},
		updateCreatedImageStatus: {
			run: async (id, userId, status, color = null) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) {
					return { changes: 0 };
				}
				image.status = status;
				if (color) {
					image.color = color;
				}
				return { changes: 1 };
			}
		},
		selectCreatedImagesForUser: {
			all: async (userId) => {
				return created_images.filter(
					(img) => img.user_id === Number(userId)
				);
			}
		},
		selectPublishedCreatedImagesForUser: {
			all: async (userId) =>
				created_images.filter(
					(img) => img.user_id === Number(userId) && (img.published === true || img.published === 1)
				)
		},
		selectAllCreatedImageCountForUser: {
			get: async (userId) => ({
				count: created_images.filter((img) => img.user_id === Number(userId)).length
			})
		},
		selectPublishedCreatedImageCountForUser: {
			get: async (userId) => ({
				count: created_images.filter(
					(img) => img.user_id === Number(userId) && (img.published === true || img.published === 1)
				).length
			})
		},
		selectLikesReceivedForUserPublished: {
			get: async () => ({ count: 0 })
		},
		selectCreatedImageById: {
			get: async (id, userId) => {
				return created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				return created_images.find(
					(img) => img.id === Number(id)
				);
			}
		},
		selectCreatedImageByFilename: {
			get: async (filename) => {
				return created_images.find(
					(img) => img.filename === filename
				);
			}
		},
		publishCreatedImage: {
			run: async (id, userId, title, description) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (!image) {
					return { changes: 0 };
				}
				image.published = true;
				image.published_at = new Date().toISOString();
				image.title = title;
				image.description = description;
				return { changes: 1 };
			}
		},
		deleteCreatedImageById: {
			run: async (id, userId) => {
				const index = created_images.findIndex(
					(img) => img.id === Number(id) && img.user_id === Number(userId)
				);
				if (index === -1) {
					return { changes: 0 };
				}
				created_images.splice(index, 1);
				return { changes: 1 };
			}
		},
		updateCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && (isAdmin || img.user_id === Number(userId))
				);
				if (!image) {
					return { changes: 0 };
				}
				image.title = title;
				image.description = description;
				return { changes: 1 };
			}
		},
		unpublishCreatedImage: {
			run: async (id, userId, isAdmin = false) => {
				const image = created_images.find(
					(img) => img.id === Number(id) && (isAdmin || img.user_id === Number(userId))
				);
				if (!image) {
					return { changes: 0 };
				}
				image.published = false;
				image.published_at = null;
				return { changes: 1 };
			}
		},
		insertFeedItem: {
			run: async (title, summary, author, tags, createdImageId) => {
				const id = feed_items.length > 0
					? Math.max(...feed_items.map(item => item.id || 0)) + 1
					: 1;
				const now = new Date().toISOString();
				const item = {
					id,
					title,
					summary,
					author,
					tags: tags || null,
					created_at: now,
					created_image_id: createdImageId || null
				};
				feed_items.push(item);
				return {
					insertId: id,
					lastInsertRowid: id,
					changes: 1
				};
			}
		},
		selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				return feed_items
					.filter(item => item.created_image_id === Number(createdImageId))
					.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
			}
		},
		updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				const items = feed_items.filter(item => item.created_image_id === Number(createdImageId));
				if (items.length === 0) {
					return { changes: 0 };
				}
				items.forEach(item => {
					item.title = title;
					item.summary = summary;
				});
				return { changes: items.length };
			}
		},
		deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				const initialLength = feed_items.length;
				const filtered = feed_items.filter(item => item.created_image_id !== Number(createdImageId));
				feed_items.length = 0;
				feed_items.push(...filtered);
				return { changes: initialLength - feed_items.length };
			}
		},
		deleteAllLikesForCreatedImage: {
			run: async (createdImageId) => {
				const initialLength = likes_created_image.length;
				const filtered = likes_created_image.filter(like => like.created_image_id !== Number(createdImageId));
				likes_created_image.length = 0;
				likes_created_image.push(...filtered);
				return { changes: initialLength - likes_created_image.length };
			}
		},
		deleteAllCommentsForCreatedImage: {
			run: async (createdImageId) => {
				const initialLength = comments_created_image.length;
				const filtered = comments_created_image.filter(comment => comment.created_image_id !== Number(createdImageId));
				comments_created_image.length = 0;
				comments_created_image.push(...filtered);
				return { changes: initialLength - comments_created_image.length };
			}
		},
		selectUserCredits: {
			get: async (userId) =>
				user_credits.find((row) => row.user_id === Number(userId))
		},
		insertUserCredits: {
			run: async (userId, balance, lastDailyClaimAt) => {
				const existing = user_credits.find((row) => row.user_id === Number(userId));
				if (existing) {
					const error = new Error("Credits already exist for user");
					error.code = "CREDITS_ALREADY_EXIST";
					throw error;
				}
				const now = new Date().toISOString();
				const row = {
					id: nextUserCreditsId++,
					user_id: Number(userId),
					balance: Number(balance) || 0,
					last_daily_claim_at: lastDailyClaimAt || null,
					created_at: now,
					updated_at: now
				};
				user_credits.push(row);
				return { insertId: row.id, lastInsertRowid: row.id, changes: 1 };
			}
		},
		updateUserCreditsBalance: {
			run: async (userId, amount) => {
				const id = Number(userId);
				const delta = Number(amount) || 0;
				let row = user_credits.find((entry) => entry.user_id === id);
				const now = new Date().toISOString();
				if (!row) {
					row = {
						id: nextUserCreditsId++,
						user_id: id,
						balance: 0,
						last_daily_claim_at: null,
						created_at: now,
						updated_at: now
					};
					user_credits.push(row);
				}
				const next = Math.max(0, Number(row.balance || 0) + delta);
				row.balance = next;
				row.updated_at = now;
				return { changes: 1 };
			}
		},
		claimDailyCredits: {
			run: async (userId, amount = 10) => {
				const id = Number(userId);
				const delta = Number(amount) || 0;
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const todayUTCStr = todayUTC.toISOString().slice(0, 10);
				let row = user_credits.find((entry) => entry.user_id === id);
				const nowIso = new Date().toISOString();
				if (!row) {
					row = {
						id: nextUserCreditsId++,
						user_id: id,
						balance: delta,
						last_daily_claim_at: nowIso,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(row);
					return { success: true, balance: row.balance, changes: 1 };
				}
				if (row.last_daily_claim_at) {
					const lastClaimDate = new Date(row.last_daily_claim_at);
					const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
					const lastClaimUTCStr = lastClaimUTC.toISOString().slice(0, 10);
					if (lastClaimUTCStr >= todayUTCStr) {
						return { success: false, balance: row.balance, changes: 0, message: "Daily credits already claimed today" };
					}
				}
				row.balance = Number(row.balance || 0) + delta;
				row.last_daily_claim_at = nowIso;
				row.updated_at = nowIso;
				return { success: true, balance: row.balance, changes: 1 };
			}
		},
		transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const fromId = Number(fromUserId);
				const toId = Number(toUserId);
				const delta = Number(amount);
				if (!Number.isFinite(delta) || delta <= 0) {
					const error = new Error("Invalid amount");
					error.code = "INVALID_AMOUNT";
					throw error;
				}
				const nowIso = new Date().toISOString();
				let fromRow = user_credits.find((entry) => entry.user_id === fromId);
				if (!fromRow) {
					fromRow = {
						id: nextUserCreditsId++,
						user_id: fromId,
						balance: 0,
						last_daily_claim_at: null,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(fromRow);
				}
				let toRow = user_credits.find((entry) => entry.user_id === toId);
				if (!toRow) {
					toRow = {
						id: nextUserCreditsId++,
						user_id: toId,
						balance: 0,
						last_daily_claim_at: null,
						created_at: nowIso,
						updated_at: nowIso
					};
					user_credits.push(toRow);
				}
				if (Number(fromRow.balance || 0) < delta) {
					const error = new Error("Insufficient credits");
					error.code = "INSUFFICIENT_CREDITS";
					throw error;
				}
				fromRow.balance = Number(fromRow.balance || 0) - delta;
				fromRow.updated_at = nowIso;
				toRow.balance = Number(toRow.balance || 0) + delta;
				toRow.updated_at = nowIso;
				return { fromBalance: fromRow.balance, toBalance: toRow.balance };
			}
		}
	};

	const db = {
		prepare: () => makeStatement({}),
		exec: () => { }
	};

	async function seed(tableName, items, options = {}) {
		if (!items || items.length === 0) return;

		const { skipIfExists = false, transform, checkExists } = options;

		// Get the appropriate array for this table
		let targetArray;
		switch (tableName) {
			case "users":
				targetArray = users;
				break;
			case "user_profiles":
				targetArray = user_profiles;
				break;
			case "moderation_queue":
				targetArray = moderation_queue;
				break;
			case "servers":
				targetArray = servers;
				break;
			case "policy_knobs":
				targetArray = policy_knobs;
				break;
			case "notifications":
				targetArray = notifications;
				break;
			case "feed_items":
				targetArray = feed_items;
				break;
			case "explore_items":
				targetArray = explore_items;
				break;
			case "creations":
				targetArray = creations;
				break;
			case "templates":
				targetArray = templates;
				break;
			case "created_images":
				targetArray = created_images;
				break;
			case "user_follows":
				targetArray = user_follows;
				break;
			default:
				console.warn(`Unknown table: ${tableName}`);
				return;
		}

		// Check if we should skip seeding
		if (skipIfExists) {
			if (checkExists) {
				const existing = await checkExists();
				if (existing && existing.length > 0) return;
			} else {
				if (targetArray.length > 0) return;
			}
		}

		const seededAt = new Date().toISOString();
		const timestampFields = TABLE_TIMESTAMP_FIELDS[tableName] || [];

		// Insert items
		for (const item of items) {
			const transformedItem = transform ? transform(item) : item;
			// Generate ID if needed
			const newItem = { ...transformedItem };
			if (!newItem.id) {
				// Simple ID generation based on array length
				newItem.id = targetArray.length > 0
					? Math.max(...targetArray.map(i => i.id || 0)) + 1
					: 1;
			}

			for (const field of timestampFields) {
				if (!newItem[field]) {
					newItem[field] = seededAt;
				}
			}

			targetArray.push(newItem);
		}

		if (tableName === "users") {
			nextUserId = users.length > 0
				? Math.max(...users.map((user) => user.id || 0)) + 1
				: 1;
		}
	}

	async function reset() {
		// Clear all in-memory data arrays
		users.length = 0;
		user_profiles.length = 0;
		moderation_queue.length = 0;
		provider_registry.length = 0;
		provider_statuses.length = 0;
		provider_metrics.length = 0;
		provider_grants.length = 0;
		provider_templates.length = 0;
		policy_knobs.length = 0;
		notifications.length = 0;
		feed_items.length = 0;
		explore_items.length = 0;
		creations.length = 0;
		templates.length = 0;
		created_images.length = 0;
		sessions.length = 0;
		// Reset ID counters
		nextUserId = 1;
		nextNotificationId = 1;
	}

	// Storage interface for images (using filesystem like SQLite)
	const storage = {
		uploadImage: async (buffer, filename) => {
			try {
				ensureImagesDir();
				const filePath = path.join(imagesDir, filename);
				fs.writeFileSync(filePath, buffer);
				return `/images/created/${filename}`;
			} catch (error) {
				// On Vercel or other read-only filesystems, we can't write files
				// Return a URL anyway - the image data is stored in the database record
				// The image won't be accessible via filesystem, but the database entry will exist
				console.warn(`Warning: Could not write image file ${filename}: ${error.message}`);
				console.warn("Image metadata will be stored, but file will not be persisted.");
				console.warn("For production on Vercel, use Supabase adapter with SUPABASE_URL and SUPABASE_ANON_KEY.");
				// Return a URL that indicates the file isn't available
				return `/images/created/${filename}`;
			}
		},

		getImageUrl: (filename) => {
			return `/images/created/${filename}`;
		},

		getImageBuffer: async (filename) => {
			try {
				const filePath = path.join(imagesDir, filename);
				if (!fs.existsSync(filePath)) {
					throw new Error(`Image not found: ${filename}`);
				}
				return fs.readFileSync(filePath);
			} catch (error) {
				// If file doesn't exist (e.g., on Vercel where files can't be written),
				// throw a clear error
				throw new Error(`Image file not available: ${filename}. This may occur on serverless platforms. Consider using Supabase adapter.`);
			}
		},

		getGenericImageBuffer: async (key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "");
				const filePath = path.join(genericImagesDir, safeKey.replace(/^\/+/, ""));
				if (!fs.existsSync(filePath)) {
					throw new Error(`Image not found: ${safeKey}`);
				}
				return fs.readFileSync(filePath);
			} catch (error) {
				throw new Error(`Image not found: ${String(key || "")}`);
			}
		},

		uploadGenericImage: async (buffer, key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "").replace(/^\/+/, "");
				const filePath = path.join(genericImagesDir, safeKey);
				const dir = path.dirname(filePath);
				try {
					fs.mkdirSync(dir, { recursive: true });
				} catch {
					// ignore
				}
				fs.writeFileSync(filePath, buffer);
				return safeKey;
			} catch (error) {
				throw new Error("Failed to upload image");
			}
		},

		deleteGenericImage: async (key) => {
			try {
				ensureGenericImagesDir();
				const safeKey = String(key || "").replace(/^\/+/, "");
				const filePath = path.join(genericImagesDir, safeKey);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
				}
			} catch {
				// ignore
			}
		},

		deleteImage: async (filename) => {
			const filePath = path.join(imagesDir, filename);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		},

		clearAll: async () => {
			if (fs.existsSync(imagesDir)) {
				const files = fs.readdirSync(imagesDir);
				for (const file of files) {
					const filePath = path.join(imagesDir, file);
					const stat = fs.statSync(filePath);
					if (stat.isFile()) {
						fs.unlinkSync(filePath);
					}
				}
			}
		}
	};

	return { db, queries, seed, reset, storage };
}
