import {getThumbnailUrl} from '../services/create/url.js';
import {isRecommendableCreationRow} from '../services/create/recommendableCreations.js';
import {collectCreationPromptMentionTexts,textContainsBoundedPersonalityMention} from '../services/account/textMentions.js';
function resolveFeedRowTitle(title,fallback){return typeof title==='string'&&title.trim()?title.trim():String(fallback??'')}
function prefixedTable(name){return 'prsn_'+name}
export function createAccountQueries(client){const serviceClient=client,supabase=client;const queries={
selectUserIdByApiKeyHash: {
			get: async (hash) => {
				if (hash == null || typeof hash !== "string" || !hash.trim()) return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id")
					.contains("meta", { apiKeyHash: hash.trim() })
					.maybeSingle();
				if (error) throw error;
				return data?.id != null ? { id: data.id } : undefined;
			}
		},
selectUserByEmail: {
			get: async (email) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, password_hash, role, meta")
					.eq("email", email)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
selectUserByIdForLogin: {
			get: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, password_hash, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return { ...data, meta, suspended: meta.suspended === true };
			}
		},
selectUsersByIds: async (ids) => {
			const idList = Array.isArray(ids) ? ids.filter((id) => id != null && Number.isFinite(Number(id))) : [];
			if (idList.length === 0) return new Map();
			const { data, error } = await serviceClient
				.from(prefixedTable("users"))
				.select("id, email, role, created_at, last_active_at, meta")
				.in("id", idList);
			if (error) throw error;
			const map = new Map();
			for (const row of data ?? []) {
				const meta = typeof row.meta === "object" && row.meta !== null ? row.meta : {};
				map.set(Number(row.id), { ...row, meta, suspended: meta.suspended === true });
			}
			return map;
		},
selectPublicUsernames: {
			all: async () => {
				const profilesTable = prefixedTable("user_profiles");
				const usersTable = prefixedTable("users");
				const { data, error } = await serviceClient
					.from(profilesTable)
					.select(`user_name, ${usersTable}!inner(role, meta)`)
					.not("user_name", "is", null)
					.eq(`${usersTable}.role`, "consumer")
					.order("user_name", { ascending: true });
				if (error) throw error;
				return (data ?? [])
					.filter((row) => {
						const userName = typeof row?.user_name === "string" ? row.user_name.trim() : "";
						const user = row?.[usersTable];
						return userName && (!user?.meta || user.meta.suspended !== true);
					})
					.map((row) => ({ user_name: String(row.user_name).trim() }));
			}
		},
upsertUserProfile: {
			run: async (userId, profile) => {
				const payload = {
					user_id: userId,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					about: profile?.about ?? null,
					socials: profile?.socials ?? null,
					avatar_url: profile?.avatar_url ?? null,
					cover_image_url: profile?.cover_image_url ?? null,
					badges: profile?.badges ?? null,
					meta: profile?.meta ?? null,
					updated_at: new Date().toISOString()
				};
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.upsert(payload, { onConflict: "user_id" })
					.select("user_id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
insertUserFollow: {
			run: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.upsert(
						{ follower_id: followerId, following_id: followingId },
						{ onConflict: "follower_id,following_id", ignoreDuplicates: true }
					)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
deleteUserFollow: {
			run: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.delete()
					.eq("follower_id", followerId)
					.eq("following_id", followingId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
selectUserFollowStatus: {
			get: async (followerId, followingId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("id")
					.eq("follower_id", followerId)
					.eq("following_id", followingId)
					.maybeSingle();
				if (error) throw error;
				return data ? { viewer_follows: 1 } : undefined;
			}
		},
selectFollowerCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id", { count: "exact", head: true })
					.eq("following_id", userId);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
selectUserFollowers: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id, created_at")
					.eq("following_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followerIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.follower_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (followerIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", followerIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return (followRows ?? []).map((row) => {
					const id = row?.follower_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
selectUserFollowersWithViewer: {
			all: async (targetUserId, viewerId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id, created_at")
					.eq("following_id", targetUserId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followerIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.follower_id)
						.filter((id) => id != null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				let viewerFollowsSet = new Set();
				if (followerIds.length > 0) {
					const [profileRes, viewerFollowsRes] = await Promise.all([
						serviceClient.from(prefixedTable("user_profiles")).select("user_id, user_name, display_name, avatar_url").in("user_id", followerIds),
						serviceClient.from(prefixedTable("user_follows")).select("following_id").eq("follower_id", viewerId).in("following_id", followerIds)
					]);
					if (profileRes.error) throw profileRes.error;
					profileByUserId = new Map((profileRes.data ?? []).map((row) => [String(row.user_id), row]));
					viewerFollowsSet = new Set((viewerFollowsRes.data ?? []).map((r) => r?.following_id).filter(Boolean).map(String));
				}

				return (followRows ?? []).map((row) => {
					const id = row?.follower_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						viewer_follows: id != null ? viewerFollowsSet.has(String(id)) : false
					};
				});
			}
		},
selectUserFollowing: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id, created_at")
					.eq("follower_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (error) throw error;

				const followingIds = Array.from(new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (followingIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", followingIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return (followRows ?? []).map((row) => {
					const id = row?.following_id ?? null;
					const profile = id != null ? profileByUserId.get(String(id)) ?? null : null;
					return {
						user_id: id,
						followed_at: row?.created_at ?? null,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
updateUserEnableNsfw: {
			run: async (userId, enableNsfw) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.enableNsfw = Boolean(enableNsfw);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateUserShowOwnPostsInFeed: {
			run: async (userId, showOwnPostsInFeed) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.showOwnPostsInFeed = Boolean(showOwnPostsInFeed);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateUserForceLegacyFeed: {
			run: async (userId, forceLegacyFeed) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.forceLegacyFeed = Boolean(forceLegacyFeed);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateUserAudibleNotifications: {
			run: async (userId, on) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.audibleNotifications = Boolean(on);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateUserApiKey: {
			run: async (userId, { apiKeyHash, apiKeyPrefix } = {}) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				if (apiKeyHash == null || apiKeyHash === "") {
					delete meta.apiKeyHash;
					delete meta.apiKeyPrefix;
				} else {
					meta.apiKeyHash = String(apiKeyHash);
					meta.apiKeyPrefix = typeof apiKeyPrefix === "string" ? apiKeyPrefix : "";
				}
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateUserVynlyBearerToken: {
			run: async (userId, { bearerToken, tokenPrefix } = {}) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				if (bearerToken == null || bearerToken === "") {
					delete meta.vynlyBearerToken;
					delete meta.vynlyTokenPrefix;
				} else {
					meta.vynlyBearerToken = String(bearerToken).trim();
					meta.vynlyTokenPrefix = typeof tokenPrefix === "string" ? tokenPrefix : "";
				}
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
selectGooglePhotosConnectionByUserId: {
			get: async (userId) => {
				const id = Number(userId);
				if (!Number.isFinite(id) || id <= 0) return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("google_photos_connections"))
					.select(
						"user_id, refresh_token_enc, scopes, album_id, album_title, created_at, updated_at, revoked_at, meta"
					)
					.eq("user_id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
upsertGooglePhotosConnection: {
			run: async (
				userId,
				{ refreshTokenEnc, scopes, albumId, albumTitle, revokedAtIso, meta } = {}
			) => {
				const id = Number(userId);
				if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid user id");
				const row = {
					user_id: id,
					refresh_token_enc: String(refreshTokenEnc || ""),
					scopes: typeof scopes === "string" ? scopes : "",
					album_id: typeof albumId === "string" ? albumId : null,
					album_title: typeof albumTitle === "string" ? albumTitle : null,
					updated_at: new Date().toISOString(),
					revoked_at: typeof revokedAtIso === "string" ? revokedAtIso : null,
					meta: meta && typeof meta === "object" ? meta : null
				};
				if (!row.refresh_token_enc) throw new Error("Missing refresh token");
				const { error } = await serviceClient
					.from(prefixedTable("google_photos_connections"))
					.upsert(row, { onConflict: "user_id" });
				if (error) throw error;
				return { changes: 1 };
			}
		},
updateGooglePhotosConnectionAlbum: {
			run: async (userId, { albumId, albumTitle } = {}) => {
				const id = Number(userId);
				if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid user id");
				const { error } = await serviceClient
					.from(prefixedTable("google_photos_connections"))
					.update({
						album_id: typeof albumId === "string" ? albumId : null,
						album_title: typeof albumTitle === "string" ? albumTitle : null,
						updated_at: new Date().toISOString()
					})
					.eq("user_id", id);
				if (error) throw error;
				return { changes: 1 };
			}
		},
revokeGooglePhotosConnection: {
			run: async (userId) => {
				const id = Number(userId);
				if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid user id");
				const now = new Date().toISOString();
				const { error } = await serviceClient
					.from(prefixedTable("google_photos_connections"))
					.update({ revoked_at: now, updated_at: now })
					.eq("user_id", id);
				if (error) throw error;
				return { changes: 1 };
			}
		},
deleteGooglePhotosConnection: {
			run: async (userId) => {
				const id = Number(userId);
				if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid user id");
				const { error } = await serviceClient
					.from(prefixedTable("google_photos_connections"))
					.delete()
					.eq("user_id", id);
				if (error) throw error;
				return { changes: 1 };
			}
		},
insertOauthClient: {
			run: async ({ ownerUserId, clientId, name, redirectUrisJson, meta }) => {
				let urs = redirectUrisJson;
				if (typeof redirectUrisJson === "string") {
					try {
						urs = JSON.parse(redirectUrisJson);
					} catch {
						urs = [];
					}
				}
				if (!Array.isArray(urs)) urs = [];
				const row = {
					owner_user_id: ownerUserId,
					client_id: clientId,
					name,
					redirect_uris: urs
				};
				if (meta != null && typeof meta === "object" && !Array.isArray(meta)) {
					row.meta = meta;
				}
				const { data, error } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.insert(row)
					.select("id")
					.single();
				if (error) throw error;
				const id = data?.id;
				return { insertId: id };
			}
		},
selectOauthClientByPublicClientId: {
			get: async (clientId) => {
				if (clientId == null || typeof clientId !== "string" || !clientId.trim()) return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.select("id, client_id, owner_user_id, name, redirect_uris, created_at, meta")
					.eq("client_id", clientId.trim())
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				return {
					id: data.id,
					client_id: data.client_id,
					owner_user_id: data.owner_user_id,
					name: data.name,
					redirect_uris: data.redirect_uris,
					created_at: data.created_at,
					meta: data.meta
				};
			}
		},
selectOauthClientsByOwner: {
			all: async (ownerUserId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.select("id, client_id, owner_user_id, name, redirect_uris, created_at, meta")
					.eq("owner_user_id", ownerUserId)
					.order("id", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
updateOauthClientForOwner: {
			run: async (internalId, ownerUserId, { name, redirectUrisJson, meta }) => {
				let urs = redirectUrisJson;
				if (typeof redirectUrisJson === "string") {
					try {
						urs = JSON.parse(redirectUrisJson);
					} catch {
						urs = [];
					}
				}
				if (!Array.isArray(urs)) urs = [];
				const patch = {
					name,
					redirect_uris: urs
				};
				if (meta != null && typeof meta === "object" && !Array.isArray(meta)) {
					patch.meta = meta;
				}
				const { error } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.update(patch)
					.eq("id", internalId)
					.eq("owner_user_id", ownerUserId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
deleteOauthClientForOwner: {
			run: async (internalId, ownerUserId) => {
				const { error } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.delete()
					.eq("id", internalId)
					.eq("owner_user_id", ownerUserId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
insertOAuthAuthorizationCode: {
			run: async ({
				codeHash,
				userId,
				oauthClientInternalId,
				redirectUri,
				codeChallenge,
				expiresAtIso
			}) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("oauth_authorization_codes"))
					.insert({
						code_hash: codeHash,
						user_id: userId,
						oauth_client_id: oauthClientInternalId,
						redirect_uri: redirectUri,
						code_challenge: codeChallenge,
						expires_at: expiresAtIso
					})
					.select("id")
					.single();
				if (error) throw error;
				return { insertId: data?.id };
			}
		},
consumeOAuthAuthorizationCode: {
			get: async (codeHash) => {
				if (codeHash == null || typeof codeHash !== "string" || !codeHash.trim()) return undefined;
				const h = codeHash.trim();
				const { data: row, error: selErr } = await serviceClient
					.from(prefixedTable("oauth_authorization_codes"))
					.select(
						"id, code_hash, user_id, oauth_client_id, redirect_uri, code_challenge, expires_at, consumed_at, meta"
					)
					.eq("code_hash", h)
					.maybeSingle();
				if (selErr) throw selErr;
				if (!row || row.consumed_at) return undefined;
				const exp = Date.parse(row.expires_at);
				if (!Number.isFinite(exp) || exp <= Date.now()) return undefined;
				const { error: updErr } = await serviceClient
					.from(prefixedTable("oauth_authorization_codes"))
					.update({ consumed_at: new Date().toISOString() })
					.eq("id", row.id);
				if (updErr) throw updErr;
				return row;
			}
		},
revokeOAuthGrantsForUserClient: {
			run: async (userId, oauthClientInternalId) => {
				const now = new Date().toISOString();
				const { error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.update({ revoked_at: now })
					.eq("user_id", userId)
					.eq("oauth_client_id", oauthClientInternalId)
					.is("revoked_at", null);
				if (error) throw error;
				return { changes: 1 };
			}
		},
insertOAuthGrant: {
			run: async ({ userId, oauthClientInternalId, refreshTokenHash, scopes }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.insert({
						user_id: userId,
						oauth_client_id: oauthClientInternalId,
						refresh_token_hash: refreshTokenHash,
						scopes
					})
					.select("id")
					.single();
				if (error) throw error;
				return { insertId: data?.id };
			}
		},
selectOAuthGrantByRefreshTokenHash: {
			get: async (refreshTokenHash) => {
				if (refreshTokenHash == null || typeof refreshTokenHash !== "string") return undefined;
				const { data: grant, error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.select("id, user_id, oauth_client_id, refresh_token_hash, scopes, revoked_at, meta")
					.eq("refresh_token_hash", refreshTokenHash)
					.is("revoked_at", null)
					.maybeSingle();
				if (error) throw error;
				if (!grant) return undefined;
				const { data: client, error: cErr } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.select("client_id, owner_user_id")
					.eq("id", grant.oauth_client_id)
					.maybeSingle();
				if (cErr) throw cErr;
				return {
					...grant,
					public_client_id: client?.client_id,
					owner_user_id: client?.owner_user_id
				};
			}
		},
updateOAuthGrantRefreshToken: {
			run: async (grantId, newRefreshTokenHash) => {
				const now = new Date().toISOString();
				const { error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.update({ refresh_token_hash: newRefreshTokenHash, last_used_at: now })
					.eq("id", grantId)
					.is("revoked_at", null);
				if (error) throw error;
				return { changes: 1 };
			}
		},
selectIntegrationGrantsForUser: {
			all: async (userId) => {
				const { data: grants, error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.select("id, oauth_client_id, created_at, last_used_at, scopes, meta")
					.eq("user_id", userId)
					.is("revoked_at", null)
					.order("created_at", { ascending: false });
				if (error) throw error;
				if (!grants?.length) return [];
				const clientIds = [...new Set(grants.map((g) => g.oauth_client_id))];
				const { data: clients, error: cErr } = await serviceClient
					.from(prefixedTable("oauth_clients"))
					.select("id, client_id, name")
					.in("id", clientIds);
				if (cErr) throw cErr;
				const byId = new Map((clients ?? []).map((c) => [c.id, c]));
				return grants.map((g) => {
					const c = byId.get(g.oauth_client_id);
					return {
						id: g.id,
						oauth_client_id: g.oauth_client_id,
						public_client_id: c?.client_id ?? null,
						app_name: c?.name ?? null,
						created_at: g.created_at,
						last_used_at: g.last_used_at,
						scopes: g.scopes,
						meta: g.meta ?? null
					};
				});
			}
		},
revokeOAuthGrantByIdForUser: {
			run: async (grantId, userId) => {
				const now = new Date().toISOString();
				const { error } = await serviceClient
					.from(prefixedTable("oauth_grants"))
					.update({ revoked_at: now, refresh_token_hash: null })
					.eq("id", grantId)
					.eq("user_id", userId)
					.is("revoked_at", null);
				if (error) throw error;
				return { changes: 1 };
			}
		},
presenceHeartbeat: {
			run: async (userId, clientVersion) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.presence_last_seen_at = new Date().toISOString();
				meta.presence_client_version =
					typeof clientVersion === "string" ? clientVersion.trim() : "";
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
presenceClear: {
			run: async (userId) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				delete meta.presence_last_seen_at;
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
setUserAppearOffline: {
			run: async (userId, appearOffline) => {
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("users"))
					.select("meta")
					.eq("id", userId)
					.maybeSingle();
				if (selectError) throw selectError;
				const existing = current?.meta ?? null;
				const meta = typeof existing === "object" && existing !== null ? { ...existing } : {};
				meta.appear_offline = Boolean(appearOffline);
				const { error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ meta })
					.eq("id", userId);
				if (error) throw error;
				return { changes: 1 };
			}
		},
listPresenceOnlineUsers: {
			all: async (sinceIso, limit = 200) => {
				const cap = Math.min(Math.max(1, Number(limit) || 200), 500);
				const usersTable = prefixedTable("users");
				const profilesTable = prefixedTable("user_profiles");
				const selectCols = `id, meta, ${profilesTable}(user_name, display_name, avatar_url)`;
				let rows;
				const filtered = (raw) => {
					const out = [];
					for (const row of raw ?? []) {
						const meta = typeof row.meta === "object" && row.meta !== null ? row.meta : {};
						if (meta.suspended === true) continue;
						if (meta.appear_offline === true) continue;
						const ts = meta.presence_last_seen_at;
						if (typeof ts !== "string" || ts < sinceIso) continue;
						const prof = row[profilesTable];
						const p = Array.isArray(prof) ? prof[0] : prof;
						if (!p) continue;
						out.push({
							user_id: Number(row.id),
							user_name: p.user_name ?? null,
							display_name: p.display_name ?? null,
							avatar_url: p.avatar_url ?? null,
							presence_last_seen_at: ts
						});
						if (out.length >= cap) break;
					}
					out.sort((a, b) => {
						const ams = Date.parse(String(a?.presence_last_seen_at || ''));
						const bms = Date.parse(String(b?.presence_last_seen_at || ''));
						const av = Number.isFinite(ams) ? ams : 0;
						const bv = Number.isFinite(bms) ? bms : 0;
						return bv - av;
					});
					return out;
				};
				const primary = await serviceClient
					.from(usersTable)
					.select(selectCols)
					.eq("role", "consumer")
					.gte("meta->>presence_last_seen_at", sinceIso)
					.limit(cap * 3);
				if (primary.error) {
					const fallback = await serviceClient
						.from(usersTable)
						.select(selectCols)
						.eq("role", "consumer")
						.limit(Math.min(2000, cap * 20));
					if (fallback.error) throw fallback.error;
					rows = fallback.data;
				} else {
					rows = primary.data;
				}
				return filtered(rows);
			}
		},
updateUserEmail: {
			run: async (userId, newEmail) => {
				const normalized = String(newEmail).trim().toLowerCase();
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.update({ email: normalized })
					.eq("id", userId)
					.select("id");
				if (error) throw error;
				const changes = Array.isArray(data) && data.length > 0 ? data.length : 0;
				return { changes };
			}
		},



selectPublishedCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				let query = serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at"
					)
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null)
					.order("published_at", { ascending: false })
					.order("created_at", { ascending: false });
				// When viewer has not enabled NSFW, filter NSFW at DB level so
				// limit/offset operate over the visible list, not raw rows.
				if (options?.viewerEnableNsfw === false) {
					query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
				}
				const { data, error } = await query.range(offset, offset + limit - 1);
				if (error) throw error;
				return data ?? [];
			}
		},
selectPublishedCreationsByPersonalityMention: {
			all: async (personality, options = {}) => {
				const normalized = String(personality || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) return [];
				const mentionNeedle = `@${normalized}`;
				const mentionCandidate = `%${mentionNeedle}%`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const [descriptionRes, titleRes, commentsRes, metaRes] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id, description")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("description", mentionCandidate)
						.limit(5000),
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id, title")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("title", mentionCandidate)
						.limit(5000),
					serviceClient
						.from(prefixedTable("comments_created_image"))
						.select("created_image_id, text")
						.ilike("text", mentionCandidate)
						.limit(5000),
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id, meta")
						.eq("published", true)
						.is("unavailable_at", null)
						.or(
							`meta->>user_prompt.ilike.${mentionCandidate},meta->args->>prompt.ilike.${mentionCandidate}`
						)
						.limit(5000)
				]);
				if (descriptionRes.error) throw descriptionRes.error;
				if (titleRes.error) throw titleRes.error;
				if (commentsRes.error) throw commentsRes.error;
				if (metaRes.error) throw metaRes.error;

				const idSet = new Set();
				for (const row of descriptionRes.data ?? []) {
					if (!textContainsBoundedPersonalityMention(row?.description, normalized)) continue;
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of titleRes.data ?? []) {
					if (!textContainsBoundedPersonalityMention(row?.title, normalized)) continue;
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of commentsRes.data ?? []) {
					if (!textContainsBoundedPersonalityMention(row?.text, normalized)) continue;
					const id = Number(row?.created_image_id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of metaRes.data ?? []) {
					const texts = collectCreationPromptMentionTexts(row?.meta);
					if (!texts.some((text) => textContainsBoundedPersonalityMention(text, normalized))) continue;
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				const ids = Array.from(idSet);
				if (ids.length === 0) return [];

				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, user_id, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;

				return (images ?? [])
					.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
					.slice(offset, offset + limit);
			}
		},
selectPublishedCreationsByTagMention: {
			all: async (tag, options = {}) => {
				const normalized = String(tag || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) return [];
				const tagNeedle = `#${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);

				const [descriptionRes, titleRes, commentsRes] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("description", `%${tagNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("created_images"))
						.select("id")
						.eq("published", true)
						.is("unavailable_at", null)
						.ilike("title", `%${tagNeedle}%`)
						.limit(5000),
					serviceClient
						.from(prefixedTable("comments_created_image"))
						.select("created_image_id")
						.ilike("text", `%${tagNeedle}%`)
						.limit(5000)
				]);
				if (descriptionRes.error) throw descriptionRes.error;
				if (titleRes.error) throw titleRes.error;
				if (commentsRes.error) throw commentsRes.error;

				const idSet = new Set();
				for (const row of descriptionRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of titleRes.data ?? []) {
					const id = Number(row?.id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				for (const row of commentsRes.data ?? []) {
					const id = Number(row?.created_image_id);
					if (Number.isFinite(id) && id > 0) idSet.add(id);
				}
				const ids = Array.from(idSet);
				if (ids.length === 0) return [];

				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, user_id, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;

				return (images ?? [])
					.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
					.slice(offset, offset + limit);
			}
		},
selectAllCreatedImageCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId)
					.is("unavailable_at", null);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
selectPublishedCreatedImageCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
selectCreatedImagesLikedByUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: likeRows, error: likeError } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id, created_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (likeError) throw likeError;
				const ids = (likeRows ?? []).map((r) => r?.created_image_id).filter((id) => id != null);
				if (ids.length === 0) return [];
				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at")
					.in("id", ids)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;
				const byId = new Map((images ?? []).map((img) => [String(img.id), img]));
				const orderByLiked = new Map((likeRows ?? []).map((r, i) => [String(r?.created_image_id), r?.created_at ?? ""]));
				return ids
					.map((id) => byId.get(String(id)))
					.filter(Boolean)
					.sort((a, b) => {
						const ta = orderByLiked.get(String(a.id)) ?? a.created_at ?? "";
						const tb = orderByLiked.get(String(b.id)) ?? b.created_at ?? "";
						return String(tb).localeCompare(String(ta));
					});
			}
		},
selectCommentsByUser: {
			all: async (userId, options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const { data: comments, error: commentsError } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false })
					.range(offset, offset + limit - 1);
				if (commentsError) throw commentsError;
				if (!(comments ?? []).length) return [];
				const imageIds = [...new Set((comments ?? []).map((c) => c?.created_image_id).filter((id) => id != null))];
				const { data: imgs, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title, file_path, filename, meta, created_at, user_id")
					.in("id", imageIds)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imgError) throw imgError;
				const imgById = new Map((imgs ?? []).map((i) => [String(i.id), i]));
				const creatorIds = [...new Set((imgs ?? []).map((i) => i?.user_id).filter((id) => id != null))];
				const commenterIds = [...new Set((comments ?? []).map((c) => c?.user_id).filter((id) => id != null))];
				const allUserIds = [...new Set([...creatorIds, ...commenterIds])];
				let profileByUserId = new Map();
				if (allUserIds.length > 0) {
					const { data: profiles, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", allUserIds);
					if (!profileError) {
						profileByUserId = new Map((profiles ?? []).map((p) => [String(p.user_id), p]));
					}
				}
				return (comments ?? []).map((c) => {
					const img = imgById.get(String(c?.created_image_id));
					const creatorId = img?.user_id;
					const commenterId = c?.user_id;
					const creatorProfile = creatorId != null ? profileByUserId.get(String(creatorId)) : null;
					const commenterProfile = commenterId != null ? profileByUserId.get(String(commenterId)) : null;
					return {
						...c,
						created_image_title: img?.title ?? null,
						created_image_url: img?.file_path ?? null,
						created_image_meta: img?.meta ?? null,
						created_image_created_at: img?.created_at ?? null,
						created_image_user_id: creatorId ?? null,
						creator_user_name: creatorProfile?.user_name ?? null,
						creator_display_name: creatorProfile?.display_name ?? null,
						creator_avatar_url: creatorProfile?.avatar_url ?? null,
						commenter_user_name: commenterProfile?.user_name ?? null,
						commenter_display_name: commenterProfile?.display_name ?? null,
						commenter_avatar_url: commenterProfile?.avatar_url ?? null
					};
				});
			}
		},
selectLikesReceivedForUserPublished: {
			get: async (userId) => {
				const { data: images, error: imagesError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id")
					.eq("user_id", userId)
					.eq("published", true)
					.is("unavailable_at", null);
				if (imagesError) throw imagesError;
				const ids = (images ?? []).map((row) => row.id).filter((id) => id != null);
				if (ids.length === 0) return { count: 0 };

				const { count, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("id", { count: "exact", head: true })
					.in("created_image_id", ids);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
selectCreatedImageAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("filename", filename.trim())
					.order("id", { ascending: false })
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
updateTryRequestsTransitionedByCreatedImageAnonId: {
			run: async (createdImageAnonId, { userId, createdImageId }) => {
				const id = Number(createdImageAnonId);
				const { data: rows, error: selectErr } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, meta")
					.eq("created_image_anon_id", id);
				if (selectErr) throw selectErr;
				const at = new Date().toISOString();
				const transitioned = { at, user_id: Number(userId), created_image_id: Number(createdImageId) };
				for (const row of rows ?? []) {
					const meta = typeof row.meta === "object" && row.meta !== null ? { ...row.meta, transitioned } : { transitioned };
					const { error } = await serviceClient
						.from(prefixedTable("try_requests"))
						.update({ created_image_anon_id: null, meta })
						.eq("id", row.id);
					if (error) throw error;
				}
				return Promise.resolve({ changes: (rows ?? []).length });
			}
		},
deleteCreatedImageAnon: {
			run: async (id) => {
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.delete()
					.eq("id", Number(id));
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
selectTryRequestsByCid: {
			all: async (anonCid) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta")
					.eq("anon_cid", anonCid)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},

};return queries;}
