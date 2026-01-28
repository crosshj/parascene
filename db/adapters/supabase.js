import { createClient } from "@supabase/supabase-js";
import path from "path";
import sharp from "sharp";

// Note: Supabase schema must be provisioned separately (SQL editor/migrations).
// This adapter expects all tables to be prefixed with "prsn_".

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required env var ${name}`);
	}
	return value;
}

function applyUserOrRoleFilter(query, userId, role) {
	const hasUserId = userId !== null && userId !== undefined;
	const hasRole = role !== null && role !== undefined;
	if (hasUserId && hasRole) {
		return { query: query.or(`user_id.eq.${userId},role.eq.${role}`), hasFilter: true };
	}
	if (hasUserId) {
		return { query: query.eq("user_id", userId), hasFilter: true };
	}
	if (hasRole) {
		return { query: query.eq("role", role), hasFilter: true };
	}
	return { query, hasFilter: false };
}

function prefixedTable(name) {
	return `prsn_${name}`;
}

export function openDb() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const supabaseKey = requireEnv("SUPABASE_ANON_KEY");
	const supabase = createClient(supabaseUrl, supabaseKey);

	// Use service role key for storage operations and backend operations (bypasses RLS)
	// This is needed for admin operations and operations that need to access all columns
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const serviceClient = serviceRoleKey
		? createClient(supabaseUrl, serviceRoleKey)
		: supabase;
	const storageClient = serviceClient;

	const queries = {
		selectUserByEmail: {
			get: async (email) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, password_hash, role")
					.eq("email", email)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectUserById: {
			get: async (id) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, role, created_at")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectUserProfileByUserId: {
			get: async (userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at")
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectUserProfileByUsername: {
			get: async (userName) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, user_name")
					.eq("user_name", userName)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
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
		selectUserFollowers: {
			all: async (userId) => {
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("follower_id, created_at")
					.eq("following_id", userId)
					.order("created_at", { ascending: false });
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
		selectUserFollowing: {
			all: async (userId) => {
				const { data: followRows, error } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id, created_at")
					.eq("follower_id", userId)
					.order("created_at", { ascending: false });
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
		selectSessionByTokenHash: {
			get: async (tokenHash, userId) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.select("id, user_id, token_hash, expires_at")
					.eq("token_hash", tokenHash)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		insertUser: {
			run: async (email, password_hash, role) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.insert({ email, password_hash, role })
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		insertSession: {
			run: async (userId, tokenHash, expiresAt) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		refreshSessionExpiry: {
			run: async (id, expiresAt) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.update({ expires_at: expiresAt })
					.eq("id", id)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteSessionByTokenHash: {
			run: async (tokenHash, userId) => {
				// Use serviceClient to bypass RLS for authentication
				let query = serviceClient.from(prefixedTable("sessions")).delete();
				query = query.eq("token_hash", tokenHash);
				if (userId) {
					query = query.eq("user_id", userId);
				}
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteExpiredSessions: {
			run: async (nowIso) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("sessions"))
					.delete()
					.lte("expires_at", nowIso)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectUsers: {
			all: async () => {
				// Use serviceClient to bypass RLS for admin operations
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select(`
            id,
            email,
            role,
            created_at,
            ${prefixedTable("user_profiles")} (
              user_name,
              display_name,
              avatar_url
            )
          `)
					.order("id", { ascending: true });
				if (error) throw error;
				return (data ?? []).map((row) => {
					const profile = row?.[prefixedTable("user_profiles")] || null;
					return {
						id: row.id,
						email: row.email,
						role: row.role,
						created_at: row.created_at,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectModerationQueue: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("moderation_queue"))
					.select("id, content_type, content_id, status, reason, created_at")
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectProviders: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            server_url,
            auth_token,
            status_date,
            description,
            members_count,
            server_config,
            created_at,
            updated_at,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.order("name", { ascending: true });
				if (error) throw error;
				// Transform the data to flatten the user email
				return (data ?? []).map(provider => {
					const { prsn_users, ...rest } = provider;
					return {
						...rest,
						owner_email: prsn_users?.email || null
					};
				});
			}
		},
		insertProvider: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null) => {
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.insert({
						user_id: userId,
						name,
						status,
						server_url: serverUrl,
						server_config: serverConfig,
						auth_token: resolvedAuthToken
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
		selectPolicies: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id, key, value, description, updated_at")
					.order("key", { ascending: true });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectNotificationsForUser: {
			all: async (userId, role) => {
				// Use service client to bypass RLS for backend operations
				let query = serviceClient
					.from(prefixedTable("notifications"))
					.select("id, title, message, link, created_at, acknowledged_at")
					.order("created_at", { ascending: false });
				const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
					query,
					userId,
					role
				);
				if (!hasFilter) {
					return [];
				}
				const { data, error } = await filteredQuery;
				if (error) {
					if (error.code === '42703' && error.message?.includes('user_id')) {
						throw new Error(
							`Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
							`Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
							`Original error: ${error.message}`
						);
					}
					throw error;
				}
				return data ?? [];
			}
		},
		selectUnreadNotificationCount: {
			get: async (userId, role) => {
				// Use service client to bypass RLS for backend operations
				let query = serviceClient
					.from(prefixedTable("notifications"))
					.select("*", { count: "exact", head: true })
					.is("acknowledged_at", null);
				const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
					query,
					userId,
					role
				);
				if (!hasFilter) {
					return { count: 0 };
				}
				const { count, error } = await filteredQuery;
				if (error) {
					if (error.code === '42703' && error.message?.includes('user_id')) {
						throw new Error(
							`Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
							`Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
							`Original error: ${error.message}`
						);
					}
					throw error;
				}
				return { count: count ?? 0 };
			}
		},
		acknowledgeNotificationById: {
			run: async (id, userId, role) => {
				const hasUserId = userId !== null && userId !== undefined;
				const hasRole = role !== null && role !== undefined;

				if (!hasUserId && !hasRole) {
					return { changes: 0 };
				}

				// PostgREST doesn't support .or() in UPDATE queries the same way as SELECT
				// Try each condition separately - return on first match
				// Must create a fresh query for each attempt (can't reuse query builders)

				// Try with user_id first if provided
				if (hasUserId) {
					const { data, error } = await serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.eq("id", id)
						.is("acknowledged_at", null)
						.eq("user_id", userId)
						.select("id");

					if (error) throw error;
					if (data && data.length > 0) {
						return { changes: data.length };
					}
				}

				// If user_id didn't match, try with role
				if (hasRole) {
					const { data, error } = await serviceClient
						.from(prefixedTable("notifications"))
						.update({ acknowledged_at: new Date().toISOString() })
						.eq("id", id)
						.is("acknowledged_at", null)
						.eq("role", role)
						.select("id");

					if (error) throw error;
					if (data && data.length > 0) {
						return { changes: data.length };
					}
				}

				return { changes: 0 };
			}
		},
		insertNotification: {
			run: async (userId, role, title, message, link) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("notifications"))
					.insert({
						user_id: userId ?? null,
						role: role ?? null,
						title,
						message,
						link: link ?? null,
						acknowledged_at: null
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		selectFeedItems: {
			all: async (excludeUserId) => {
				const viewerId = excludeUserId ?? null;
				if (viewerId === null || viewerId === undefined) {
					return [];
				}

				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", viewerId);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => String(id))
				);
				if (followingIdSet.size === 0) {
					return [];
				}

				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;
				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					return {
						...rest,
						filename,
						user_id,
						// Use file_path (which contains the URL) or fall back to constructing from filename
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					return followingIdSet.has(String(item.user_id));
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((id) => id !== null && id !== undefined);

				if (createdImageIds.length === 0) {
					return filtered;
				}

				// Bulk like counts via view
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				// Bulk comment counts via view
				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;

				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				// Bulk viewer liked lookup
				let likedIdSet = null;
				if (viewerId !== null && viewerId !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", viewerId)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				// Attach profile fields (display_name, user_name, avatar_url) for authors
				const authorIds = Array.from(new Set(
					filtered
						.map((item) => item.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return filtered.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
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
				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", id);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => String(id))
				);

				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					return {
						...rest,
						filename,
						user_id,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				// Explore shows all authored creations, excluding those from users the viewer follows and the viewer themselves.
				const viewerIdStr = String(id);
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					// Exclude items from the viewer themselves
					if (String(item.user_id) === viewerIdStr) return false;
					// Exclude items from users the viewer follows
					return !followingIdSet.has(String(item.user_id));
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((createdImageId) => createdImageId !== null && createdImageId !== undefined);

				if (createdImageIds.length === 0) {
					return filtered;
				}

				// Bulk like counts via view
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				// Bulk comment counts via view
				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;

				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				// Bulk viewer liked lookup
				let likedIdSet = null;
				const viewer = id;
				if (viewer !== null && viewer !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", viewer)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				// Attach profile fields for authors
				const authorIds = Array.from(new Set(
					filtered
						.map((item) => item.user_id)
						.filter((userId) => userId !== null && userId !== undefined)
						.map((userId) => Number(userId))
						.filter((userId) => Number.isFinite(userId) && userId > 0)
				));

				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return filtered.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectExploreItems: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("explore_items"))
					.select("id, title, summary, category, created_at")
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectCreationsForUser: {
			all: async (userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("creations"))
					.select("id, title, body, status, created_at")
					.eq("user_id", userId)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectServers: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            auth_token,
            status_date,
            server_config,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.order("name", { ascending: true });
				if (error) throw error;
				// Transform the data to flatten the user email
				return (data ?? []).map(server => {
					const { prsn_users, ...rest } = server;
					return {
						...rest,
						owner_email: prsn_users?.email || null
					};
				});
			}
		},
		selectServerById: {
			get: async (serverId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.select(`
            id,
            user_id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            auth_token,
            status_date,
            server_config,
            prsn_users!prsn_servers_user_id_fkey(email)
          `)
					.eq("id", serverId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return null; // Not found
					throw error;
				}
				if (!data) return null;

				// Transform the data to flatten the user email
				const { prsn_users, ...rest } = data;
				return {
					...rest,
					owner_email: prsn_users?.email || null
				};
			}
		},
		updateServerConfig: {
			run: async (serverId, serverConfig) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.update({
						server_config: serverConfig,
						updated_at: new Date().toISOString()
					})
					.eq("id", serverId)
					.select();
				if (error) throw error;
				return {
					changes: data?.length || 0
				};
			}
		},
		updateServer: {
			run: async (serverId, server) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.update({
						user_id: server?.user_id ?? null,
						name: server?.name ?? null,
						status: server?.status ?? null,
						server_url: server?.server_url ?? null,
						auth_token: server?.auth_token ?? null,
						status_date: server?.status_date ?? null,
						description: server?.description ?? null,
						members_count: server?.members_count ?? 0,
						server_config: server?.server_config ?? null,
						updated_at: new Date().toISOString()
					})
					.eq("id", serverId)
					.select();
				if (error) throw error;
				return {
					changes: data?.length || 0
				};
			}
		},
		checkServerMembership: {
			get: async (serverId, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("server_members"))
					.select("server_id, user_id")
					.eq("server_id", serverId)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data !== null;
			}
		},
		addServerMember: {
			run: async (serverId, userId) => {
				// Check if already a member
				const { data: existing } = await serviceClient
					.from(prefixedTable("server_members"))
					.select("server_id, user_id")
					.eq("server_id", serverId)
					.eq("user_id", userId)
					.maybeSingle();

				if (existing) {
					return { changes: 0 };
				}

				// Insert membership
				const { error: insertError } = await serviceClient
					.from(prefixedTable("server_members"))
					.insert({ server_id: serverId, user_id: userId })
					.select();

				if (insertError) {
					// If already exists (race condition), ignore
					if (insertError.code === '23505') { // Unique violation
						return { changes: 0 };
					}
					throw insertError;
				}

				// Update members_count manually
				const { data: serverData } = await serviceClient
					.from(prefixedTable("servers"))
					.select("members_count")
					.eq("id", serverId)
					.single();

				await serviceClient
					.from(prefixedTable("servers"))
					.update({ members_count: (serverData?.members_count || 0) + 1 })
					.eq("id", serverId);

				return { changes: 1 };
			}
		},
		removeServerMember: {
			run: async (serverId, userId) => {
				const { error } = await serviceClient
					.from(prefixedTable("server_members"))
					.delete()
					.eq("server_id", serverId)
					.eq("user_id", userId);

				if (error) throw error;

				// Update members_count
				const { data: serverData } = await serviceClient
					.from(prefixedTable("servers"))
					.select("members_count")
					.eq("id", serverId)
					.single();

				await serviceClient
					.from(prefixedTable("servers"))
					.update({ members_count: Math.max(0, (serverData?.members_count || 0) - 1) })
					.eq("id", serverId);

				return { changes: 1 };
			}
		},
		insertServer: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null, description = null) => {
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const { data, error } = await serviceClient
					.from(prefixedTable("servers"))
					.insert({
						user_id: userId,
						name,
						status,
						server_url: serverUrl,
						server_config: serverConfig,
						auth_token: resolvedAuthToken,
						description
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
		selectTemplates: {
			all: async () => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("templates"))
					.select("id, name, category, description, created_at")
					.order("name", { ascending: true });
				if (error) throw error;
				return data ?? [];
			}
		},
		insertCreatedImage: {
			run: async (userId, filename, filePath, width, height, color, status = "creating", meta = null) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.insert({
						user_id: userId,
						filename,
						file_path: filePath,
						width,
						height,
						color,
						status,
						meta
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		updateCreatedImageJobCompleted: {
			run: async (id, userId, { filename, file_path, width, height, color, meta }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						filename,
						file_path,
						width,
						height,
						color: color ?? null,
						status: "completed",
						meta
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateCreatedImageJobFailed: {
			run: async (id, userId, { meta }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						status: "failed",
						meta
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateCreatedImageStatus: {
			run: async (id, userId, status, color = null) => {
				// Use serviceClient to bypass RLS for backend operations
				const updateFields = { status };
				if (color) {
					updateFields.color = color;
				}
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update(updateFields)
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectCreatedImagesForUser: {
			all: async (userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta"
					)
					.eq("user_id", userId)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectPublishedCreatedImagesForUser: {
			all: async (userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta"
					)
					.eq("user_id", userId)
					.eq("published", true)
					.order("created_at", { ascending: false });
				if (error) throw error;
				return data ?? [];
			}
		},
		selectAllCreatedImageCountForUser: {
			get: async (userId) => {
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId);
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
					.eq("published", true);
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
		selectLikesReceivedForUserPublished: {
			get: async (userId) => {
				// First fetch published image ids for this user
				const { data: images, error: imagesError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id")
					.eq("user_id", userId)
					.eq("published", true);
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
		selectCreatedImageById: {
			get: async (id, userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta"
					)
					.eq("id", id)
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta"
					)
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		selectCreatedImageByFilename: {
			get: async (filename) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta"
					)
					.eq("filename", filename)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		insertCreatedImageLike: {
			run: async (userId, createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.upsert(
						{ user_id: userId, created_image_id: createdImageId },
						{ onConflict: "user_id,created_image_id", ignoreDuplicates: true }
					)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteCreatedImageLike: {
			run: async (userId, createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.delete()
					.eq("user_id", userId)
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectCreatedImageLikeCount: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return { like_count: Number(data?.like_count ?? 0) };
			}
		},
		selectCreatedImageViewerLiked: {
			get: async (userId, createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("id")
					.eq("user_id", userId)
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return data ? { viewer_liked: 1 } : undefined;
			}
		},
		insertCreatedImageComment: {
			run: async (userId, createdImageId, text) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.insert({
						user_id: userId,
						created_image_id: createdImageId,
						text
					})
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.single();
				if (error) throw error;

				let profile = null;
				if (userId !== null && userId !== undefined) {
					const { data: profileRow, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.eq("user_id", userId)
						.maybeSingle();
					if (profileError) throw profileError;
					profile = profileRow ?? null;
				}

				return {
					...data,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					avatar_url: profile?.avatar_url ?? null
				};
			}
		},
		selectCreatedImageComments: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				let q = serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at")
					.eq("created_image_id", createdImageId)
					.order("created_at", { ascending: order === "asc" });

				// Use range() for offset/limit paging.
				q = q.range(offset, offset + limit - 1);

				const { data, error } = await q;
				if (error) throw error;
				const comments = data ?? [];

				const userIds = Array.from(new Set(
					comments
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let profileByUserId = new Map();
				if (userIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", userIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
				}

				return comments.map((row) => {
					const profile = row?.user_id !== null && row?.user_id !== undefined
						? profileByUserId.get(String(row.user_id)) ?? null
						: null;
					return {
						...row,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null
					};
				});
			}
		},
		selectCreatedImageCommentCount: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.eq("created_image_id", createdImageId)
					.maybeSingle();
				if (error) throw error;
				return { comment_count: Number(data?.comment_count ?? 0) };
			}
		},
		publishCreatedImage: {
			run: async (id, userId, title, description) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						published: true,
						published_at: new Date().toISOString(),
						title,
						description
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteCreatedImageById: {
			run: async (id, userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.delete()
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		insertFeedItem: {
			run: async (title, summary, author, tags, createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.insert({
						title,
						summary,
						author,
						tags: tags || null,
						created_image_id: createdImageId || null
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select("id, title, summary, author, tags, created_at, created_image_id")
					.eq("created_image_id", createdImageId)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		updateCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				// Use serviceClient to bypass RLS for backend operations
				// Admin can update any image, owner can only update their own
				const query = serviceClient
					.from(prefixedTable("created_images"))
					.update({
						title,
						description
					})
					.eq("id", id);
				
				if (!isAdmin) {
					query.eq("user_id", userId);
				}
				
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		unpublishCreatedImage: {
			run: async (id, userId, isAdmin = false) => {
				// Use serviceClient to bypass RLS for backend operations
				// Admin can unpublish any image, owner can only unpublish their own
				const query = serviceClient
					.from(prefixedTable("created_images"))
					.update({
						published: false,
						published_at: null
					})
					.eq("id", id);
				
				if (!isAdmin) {
					query.eq("user_id", userId);
				}
				
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.update({
						title,
						summary
					})
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteAllLikesForCreatedImage: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		deleteAllCommentsForCreatedImage: {
			run: async (createdImageId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.delete()
					.eq("created_image_id", createdImageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		selectUserCredits: {
			get: async (userId) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("id, user_id, balance, last_daily_claim_at, created_at, updated_at")
					.eq("user_id", userId)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
		insertUserCredits: {
			run: async (userId, balance, lastDailyClaimAt) => {
				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.insert({
						user_id: userId,
						balance,
						last_daily_claim_at: lastDailyClaimAt || null
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					lastInsertRowid: data.id,
					changes: 1
				};
			}
		},
		updateUserCreditsBalance: {
			run: async (userId, amount) => {
				// Use serviceClient to bypass RLS for backend operations
				// First get current balance
				const { data: current, error: selectError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("balance")
					.eq("user_id", userId)
					.single();

				if (selectError && selectError.code !== 'PGRST116') throw selectError;

				const newBalance = (current?.balance ?? 0) + amount;

				// Prevent negative credits - ensure balance never goes below 0
				const finalBalance = Math.max(0, newBalance);

				const { data, error } = await serviceClient
					.from(prefixedTable("user_credits"))
					.update({
						balance: finalBalance,
						updated_at: new Date().toISOString()
					})
					.eq("user_id", userId)
					.select("id");

				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		claimDailyCredits: {
			run: async (userId, amount = 10) => {
				// Use serviceClient to bypass RLS for backend operations
				// Get current credits record
				const { data: credits, error: selectError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.select("id, balance, last_daily_claim_at")
					.eq("user_id", userId)
					.maybeSingle();

				if (selectError) throw selectError;

				if (!credits) {
					// No credits record exists, create one with the daily amount
					const { data: newCredits, error: insertError } = await serviceClient
						.from(prefixedTable("user_credits"))
						.insert({
							user_id: userId,
							balance: amount,
							last_daily_claim_at: new Date().toISOString()
						})
						.select("balance")
						.single();

					if (insertError) throw insertError;
					return {
						success: true,
						balance: newCredits.balance,
						changes: 1
					};
				}

				// Check if already claimed today (UTC)
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

				if (credits.last_daily_claim_at) {
					const lastClaimDate = new Date(credits.last_daily_claim_at);
					const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));

					if (lastClaimUTC.getTime() >= todayUTC.getTime()) {
						// Already claimed today
						return {
							success: false,
							balance: credits.balance,
							changes: 0,
							message: 'Daily credits already claimed today'
						};
					}
				}

				// Update balance and last claim date
				const newBalance = credits.balance + amount;
				const { data: updated, error: updateError } = await serviceClient
					.from(prefixedTable("user_credits"))
					.update({
						balance: newBalance,
						last_daily_claim_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					})
					.eq("user_id", userId)
					.select("balance")
					.single();

				if (updateError) throw updateError;

				return {
					success: true,
					balance: updated.balance,
					changes: 1
				};
			}
		},
		transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const { data, error } = await serviceClient.rpc("prsn_transfer_credits", {
					from_user_id: fromUserId,
					to_user_id: toUserId,
					amount
				});
				if (error) throw error;
				// RPC returns a single-row table; PostgREST exposes it as an array
				const row = Array.isArray(data) ? data[0] : data;
				return row || null;
			}
		}
	};

	const db = supabase;

	async function seed(tableName, items, options = {}) {
		if (!items || items.length === 0) return;

		const { skipIfExists = false, transform, checkExists } = options;
		const table = prefixedTable(tableName);

		if (skipIfExists) {
			if (checkExists) {
				const existing = await checkExists();
				if (existing && existing.length > 0) return;
			} else {
				// Use serviceClient to bypass RLS for backend operations
				const { count, error } = await serviceClient
					.from(table)
					.select("id", { count: "exact", head: true });
				if (error) throw error;
				if (count && count > 0) return;
			}
		}

		const transformedItems = transform ? items.map(transform) : items;
		// Use serviceClient to bypass RLS for backend operations
		const { error } = await serviceClient.from(table).insert(transformedItems);
		if (error) throw error;
	}

	async function reset() {
		const tables = [
			"feed_items",
			"comments_created_image",
			"created_images",
			"user_profiles",
			"sessions",
			"notifications",
			"creations",
			"moderation_queue",
			"provider_statuses",
			"provider_metrics",
			"provider_grants",
			"provider_templates",
			"policy_knobs",
			"provider_registry",
			"servers",
			"templates",
			"explore_items",
			"users"
		].map((table) => prefixedTable(table));

		for (const table of tables) {
			// Use serviceClient to bypass RLS for backend operations
			// Delete all rows - using a condition that should match all rows
			const { error } = await serviceClient.from(table).delete().gte("id", 0);
			if (error) {
				// If delete fails, try alternative approach
				const { error: error2 } = await serviceClient.from(table).delete().neq("id", -1);
				if (error2) throw error2;
			}
		}
	}

	// Storage interface for images using Supabase Storage
	// Images are stored in a private bucket and served through the backend
	const STORAGE_BUCKET = "prsn_created-images";
	const STORAGE_THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";
	const GENERIC_BUCKET = "prsn_generic-images";

	function getThumbnailFilename(filename) {
		const ext = path.extname(filename);
		const base = path.basename(filename, ext);
		return `${base}_th${ext || ""}`;
	}

	const storage = {
		uploadImage: async (buffer, filename) => {
			// Use storage client (service role if available) for uploads to private bucket
			const { data, error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.upload(filename, buffer, {
					contentType: "image/png",
					upsert: true
				});

			if (error) {
				throw new Error(`Failed to upload image to Supabase Storage: ${error.message}`);
			}

			const thumbnailBuffer = await sharp(buffer)
				.resize(250, 250, { fit: "cover" })
				.png()
				.toBuffer();
			const { error: thumbnailError } = await storageClient.storage
				.from(STORAGE_THUMBNAIL_BUCKET)
				.upload(filename, thumbnailBuffer, {
					contentType: "image/png",
					upsert: true
				});
			if (thumbnailError) {
				throw new Error(`Failed to upload thumbnail to Supabase Storage: ${thumbnailError.message}`);
			}

			// Return backend route URL instead of public Supabase URL
			// Images will be served through /api/images/created/:filename
			return `/api/images/created/${filename}`;
		},

		getImageUrl: (filename) => {
			// Return backend route URL - images are served through the backend
			return `/api/images/created/${filename}`;
		},

		getImageBuffer: async (filename, options = {}) => {
			const isThumbnail = options?.variant === "thumbnail";
			const bucket = isThumbnail ? STORAGE_THUMBNAIL_BUCKET : STORAGE_BUCKET;
			// Fetch image from Supabase Storage and return as buffer
			// Uses storage client (service role if available) to access private bucket
			const { data, error } = await storageClient.storage
				.from(bucket)
				.download(filename);

			if (error) {
				console.error("Supabase image fetch failed, serving fallback image.", {
					bucket,
					filename,
					variant: options?.variant ?? null,
					error: error?.message ?? error
				});
				return sharp({
					create: {
						width: 250,
						height: 250,
						channels: 3,
						background: "#b0b0b0"
					}
				})
					.png()
					.toBuffer();
			}

			// Convert blob to buffer
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		getGenericImageBuffer: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) {
				throw new Error("Image not found");
			}
			const { data, error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.download(objectKey);
			if (error) {
				throw new Error(`Image not found: ${objectKey}`);
			}
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		uploadGenericImage: async (buffer, key, options = {}) => {
			const objectKey = String(key || "");
			if (!objectKey) {
				throw new Error("Invalid key");
			}
			const contentType = String(options?.contentType || "application/octet-stream");
			const { error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.upload(objectKey, buffer, { contentType, upsert: true });
			if (error) {
				throw new Error(`Failed to upload generic image: ${error.message}`);
			}
			return objectKey;
		},

		deleteGenericImage: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) return;
			const { error } = await storageClient.storage
				.from(GENERIC_BUCKET)
				.remove([objectKey]);
			if (error && error.message && !error.message.toLowerCase().includes("not found")) {
				throw new Error(`Failed to delete generic image: ${error.message}`);
			}
		},

		deleteImage: async (filename) => {
			// Use storage client (service role if available) for deletes
			const { error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.remove([filename]);

			if (error) {
				// Don't throw if file doesn't exist
				if (error.message && !error.message.includes("not found")) {
					throw new Error(`Failed to delete image from Supabase Storage: ${error.message}`);
				}
			}
		},

		clearAll: async () => {
			// Use storage client (service role if available) for admin operations
			// List all files in the bucket
			const { data: files, error: listError } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.list();

			if (listError) {
				// If bucket doesn't exist, that's okay - nothing to clear
				if (listError.message && listError.message.includes("not found")) {
					return;
				}
				throw new Error(`Failed to list images in Supabase Storage: ${listError.message}`);
			}

			if (files && files.length > 0) {
				const fileNames = files.map(file => file.name);
				const { error: deleteError } = await storageClient.storage
					.from(STORAGE_BUCKET)
					.remove(fileNames);

				if (deleteError) {
					throw new Error(`Failed to clear images from Supabase Storage: ${deleteError.message}`);
				}
			}
		}
	};

	return { db, queries, seed, reset, storage };
}
