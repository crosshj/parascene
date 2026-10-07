
import sharp from "sharp";

import { getThumbnailUrl } from "../services/create/url.js";
import {
	buildFitThumbnailBuffer,
	buildSquareThumbnailBuffer,
	fitThumbnailStorageKey,
	shouldGenerateFitThumbnail,
} from "../services/create/fitThumbnail.js";
import { isRecommendableCreationRow } from "../services/create/recommendableCreations.js";




import { creationEligibleForLatestCommentsStream, resolveCreationTitleForLatestComments, creationMetaIsChallengeEditorialMedia } from "../services/create/latestCommentsVisibility.js";
import { getActiveEditorialPins, parseChallengeEditorialPinId } from "../services/feed/editorialPin.js";
import {
	challengeIdsFromCreationMeta,
	resolveChallengeTitlesByIds
} from "../services/create/challengeTitleLookup.js";
function prefixedTable(name) {
	return `prsn_${name}`;
}
function resolveFeedRowTitle(creationTitle, feedItemTitle) {
	const ct = typeof creationTitle === "string" ? creationTitle.trim() : "";
	if (ct) return ct;
	if (feedItemTitle == null) return "";
	return String(feedItemTitle);
}
export function createCreateStore({ client }) {
const supabase = client;
const serviceClient = client;
const storageClient = client;
const queries = {
unmarkCreatedImageUnavailable: {
			run: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ unavailable_at: null })
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
		markCreatedImageUnavailable: {
			run: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ unavailable_at: new Date().toISOString() })
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
deleteCreatedImageById: {
			run: async (id, userId) => {
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
updateCreatedImageGroupCover: {
			run: async (id, userId, { created_at, file_path, width, height, color, meta }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						created_at,
						file_path,
						width,
						height,
						color: color ?? null,
						meta
					})
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},

		selectAudioClipsForOwner: {
			page: async (_userId, options = {}) => {
				const lim = Math.min(Math.max(1, Number(options.limit) || 24), 100);
				const off = Math.max(0, Number(options.offset) || 0);
				const sort = String(options.sort || "last_used_at").trim().toLowerCase();
				const listSelect =
					"id, title, description, duration_sec, source_type, usage_count, last_used_at, storage_key, content_type, meta, created_at, source_created_image_id";
				let query = serviceClient
					.from(prefixedTable("audio_clips"))
					.select(listSelect, { count: "exact" })
					.is("deleted_at", null)
					.eq("is_active", true);
				if (sort === "usage_count") {
					query = query.order("usage_count", { ascending: false }).order("id", { ascending: false });
				} else if (sort === "created_at_asc") {
					query = query.order("created_at", { ascending: true }).order("id", { ascending: true });
				} else if (sort === "created_at") {
					query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
				} else {
					query = query
						.order("last_used_at", { ascending: false, nullsFirst: false })
						.order("id", { ascending: false });
				}
				const { data, error, count } = await query.range(off, off + lim - 1);
				if (error) throw error;
				return { items: data ?? [], total: typeof count === "number" ? count : (data ?? []).length };
			}
		},

selectUserById: {
			get: async (id) => {
				// Use serviceClient to bypass RLS for authentication
				const { data, error } = await serviceClient
					.from(prefixedTable("users"))
					.select("id, email, role, created_at, last_active_at, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				if (!data) return undefined;
				const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
				return {
					...data,
					meta,
					suspended: meta.suspended === true,
					appear_offline: meta.appear_offline === true
				};
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
					.select("user_id, user_name, meta")
					.eq("user_name", userName)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
selectPolicyByKey: {
			get: async (key) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id, key, value, description, updated_at")
					.eq("key", key)
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data;
			}
		},
upsertPolicyKey: {
			run: async (key, value, description) => {
				const { data: existing } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.select("id")
					.eq("key", key)
					.limit(1)
					.maybeSingle();
				const now = new Date().toISOString();
				if (existing) {
					const { error } = await serviceClient
						.from(prefixedTable("policy_knobs"))
						.update({ value, description: description ?? null, updated_at: now })
						.eq("key", key);
					if (error) throw error;
					return { changes: 1 };
				}
				const { error } = await serviceClient
					.from(prefixedTable("policy_knobs"))
					.insert({ key, value, description: description ?? null, updated_at: now });
				if (error) throw error;
				return { changes: 1 };
			}
		},
selectNewestPublishedFeedItems: {
			// All published feed items, newest first (no viewer/follow filtering). Used for Advanced create "Newest".
			all: async (userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id, title)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						thumbnail_url: getThumbnailUrl(file_path || (filename ? `/api/images/created/${filename}` : null)),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				const filtered = items.filter((item) => item.user_id != null && item.user_id !== undefined);
				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((id) => id != null && id !== undefined);

				if (createdImageIds.length === 0) return filtered;

				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const countById = new Map(
					(countRows ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);

				const { data: commentCountRows, error: commentCountError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentCountError) throw commentCountError;
				const commentCountById = new Map(
					(commentCountRows ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);

				const authorIds = [...new Set(
					filtered
						.map((item) => item.user_id)
						.filter((uid) => uid != null && Number.isFinite(Number(uid)))
				)].map(Number).filter((n) => n > 0);
				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map((profileRows ?? []).map((row) => [String(row.user_id), row]));
				}

				return filtered.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: false,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null
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
            meta,
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
selectPromptInjectionStyleBySlugForUser: {
			get: async (userId, slug) => {
				const uid = Number(userId);
				const raw = String(slug ?? "").trim();
				if (!Number.isFinite(uid) || uid <= 0 || !raw) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, injection_text, title, description, owner_user_id, visibility, meta")
					.eq("tag_type", "style")
					.eq("is_active", true)
					.is("deleted_at", null)
					.or(`owner_user_id.is.null,owner_user_id.eq.${uid},visibility.eq.public,visibility.eq.unlisted`)
					.ilike("tag", raw);
				if (error) throw error;
				const rows = Array.isArray(data) ? data : [];
				const norm = raw.toLowerCase();
				const matches = rows.filter((r) => String(r.tag || "").toLowerCase() === norm);
				if (matches.length === 0) return null;
				matches.sort((a, b) => {
					const ao = a.owner_user_id != null ? Number(a.owner_user_id) : null;
					const bo = b.owner_user_id != null ? Number(b.owner_user_id) : null;
					if (ao === uid && bo !== uid) return -1;
					if (bo === uid && ao !== uid) return 1;
					return 0;
				});
				return matches[0];
			}
		},
selectPersonaPromptInjectionInLibraryForUserByTag: {
			get: async (userId, tag) => {
				const uid = Number(userId);
				const raw = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!Number.isFinite(uid) || uid <= 0 || !raw) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, title, description, injection_text, meta, owner_user_id")
					.eq("tag_type", "persona")
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", raw)
					.or(`owner_user_id.is.null,owner_user_id.eq.${uid},visibility.eq.public,visibility.eq.unlisted`);
				if (error) throw error;
				const rows = Array.isArray(data) ? data : [];
				const norm = raw.toLowerCase();
				const sameTag = rows.filter((r) => String(r.tag || "").toLowerCase() === norm);
				sameTag.sort((a, b) => {
					const aGlobal = a.owner_user_id == null;
					const bGlobal = b.owner_user_id == null;
					if (aGlobal && !bGlobal) return -1;
					if (!aGlobal && bGlobal) return 1;
					const ao = a.owner_user_id != null ? Number(a.owner_user_id) : NaN;
					const bo = b.owner_user_id != null ? Number(b.owner_user_id) : NaN;
					if (ao === uid && bo !== uid) return -1;
					if (bo === uid && ao !== uid) return 1;
					return 0;
				});
				return sameTag[0] ?? null;
			}
		},
selectAudioClipById: {
			get: async (id) => {
				const clipId = Number(id);
				if (!Number.isFinite(clipId) || clipId <= 0) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.select("*")
					.eq("id", clipId)
					.is("deleted_at", null)
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
selectAudioClipByStorageKey: {
			get: async (storageKey) => {
				const key = typeof storageKey === "string" ? storageKey.trim() : "";
				if (!key) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.select("*")
					.eq("storage_key", key)
					.is("deleted_at", null)
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
selectAudioClipBySourceCreatedImageId: {
			get: async (sourceCreatedImageId) => {
				const sourceId = Number(sourceCreatedImageId);
				if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.select("*")
					.eq("source_created_image_id", sourceId)
					.is("deleted_at", null)
					.order("id", { ascending: false })
					.limit(1)
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
insertAudioClipUsage: {
			run: async ({ audioClipId, createdImageId, meta = {}, usedAt = null }) => {
				const clipId = Number(audioClipId);
				const creationId = Number(createdImageId);
				if (!Number.isFinite(clipId) || clipId <= 0 || !Number.isFinite(creationId) || creationId <= 0) {
					return null;
				}
				const row = {
					audio_clip_id: clipId,
					created_image_id: creationId,
					meta: meta && typeof meta === "object" ? meta : {}
				};
				if (typeof usedAt === "string" && usedAt.trim()) {
					row.used_at = usedAt.trim();
				}
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clip_usages"))
					.insert(row)
					.select("*")
					.single();
				if (error) throw error;
				return data;
			}
		},
incrementAudioClipUsage: {
			run: async (clipId) => {
				const id = Number(clipId);
				if (!Number.isFinite(id) || id <= 0) return { changes: 0 };
				const row = await serviceClient
					.from(prefixedTable("audio_clips"))
					.select("usage_count")
					.eq("id", id)
					.maybeSingle();
				if (row.error) throw row.error;
				const current = Number(row.data?.usage_count) || 0;
				const now = new Date().toISOString();
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.update({
						usage_count: current + 1,
						last_used_at: now,
						updated_at: now
					})
					.eq("id", id)
					.select("id");
				if (error) throw error;
				return { changes: Array.isArray(data) ? data.length : 0 };
			}
		},
updateCreatedImageMetaAnyUser: {
			run: async (id, meta) => {
				const imageId = Number(id);
				if (!Number.isFinite(imageId) || imageId <= 0) return { changes: 0 };
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ meta })
					.eq("id", imageId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
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
resetCreatedImageForRetry: {
			run: async (id, userId, { meta, filename }) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({
						status: "creating",
						meta,
						filename: filename ?? null,
						file_path: ""
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
updateCreatedImageMeta: {
			run: async (id, userId, meta) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ meta })
					.eq("id", id)
					.eq("user_id", userId)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
claimCreatedImageProviderPollLock: {
			run: async (id, userId, meta, nowMs) => {
				const now = Number(nowMs);
				const nowToken = Number.isFinite(now) ? String(Math.floor(now)) : String(Date.now());
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.update({ meta })
					.eq("id", id)
					.eq("user_id", userId)
					.or(`meta->>provider_poll_lock_until_ms.is.null,meta->>provider_poll_lock_until_ms.lt.${nowToken}`)
					.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
selectCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const includeUnavailable = options?.includeUnavailable === true;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				let query = serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at"
					)
					.eq("user_id", userId)
					.order("created_at", { ascending: false });
				if (!includeUnavailable) {
					query = query.is("unavailable_at", null);
				}
				// For Supabase/Postgres, filter NSFW at the DB level so
				// limit/offset operate over the visible list, not raw rows.
				// meta is a json/jsonb column; we treat meta->>'nsfw' === 'true'
				// as NSFW and exclude those rows when the viewer has not enabled NSFW.
				// Keep rows where nsfw flag is either absent (NULL) or explicitly false.
				if (options?.viewerEnableNsfw === false) {
					query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
				}
				// Restrict to creations entered in at least one challenge.
				// meta.challenge_submissions is a jsonb array; empty/missing means "not a challenge entry".
				if (options?.challengeOnly === true) {
					query = query
						.not("meta->>challenge_submissions", "is", null)
						.neq("meta->>challenge_submissions", "[]");
				}
				const { data, error } = await query.range(offset, offset + limit - 1);
				if (error) throw error;
				return data ?? [];
			}
		},
selectCreatedImagesGpuInFlight: {
			all: async ({ limit = 80 } = {}) => {
				const cap = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 80));
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, user_id, status, meta, created_at")
					.in("status", ["creating", "queued", "pending", "processing", "running"])
					.is("unavailable_at", null)
					.order("created_at", { ascending: false })
					.limit(cap);
				if (error) throw error;
				return data ?? [];
			}
		},
selectCreatedImageById: {
			get: async (id, userId) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta, unavailable_at"
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
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select(
						"id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id, meta, unavailable_at"
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
selectCreatedImageAnonById: {
			get: async (id) => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("id", id)
					.maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
updateCreatedImageAnonJobCompleted: {
			run: async (id, { filename, file_path, width, height, meta }) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.update({
						filename,
						file_path: file_path,
						width,
						height,
						status: "completed",
						meta: metaVal
					})
					.eq("id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
updateCreatedImageAnonJobFailed: {
			run: async (id, { meta }) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.update({ status: "failed", meta: metaVal })
					.eq("id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
updateTryRequestFulfilledByCreatedImageAnonId: {
			run: async (created_image_anon_id, fulfilled_at_iso) => {
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.update({ fulfilled_at: fulfilled_at_iso })
					.eq("created_image_anon_id", created_image_anon_id)
					.is("fulfilled_at", null);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
selectCreatedImageDescriptionAndMetaByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, description, meta")
					.in("id", safeIds);
				if (error) throw error;
				return data ?? [];
			}
		},
selectAllCreatedImageIdAndMeta: {
			all: async () => {
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, meta");
				if (error) throw error;
				return data ?? [];
			}
		},
selectFeedItemsByCreationIds: {
			all: async (ids, options = {}) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const recommendableOnly = options.recommendableOnly === true;
				// prsn_created_images has title, description (no summary column); use description for summary
				const { data: images, error: imgError } = await serviceClient
					.from(prefixedTable("created_images"))
					.select("id, title, description, created_at, user_id, filename, file_path, meta, published, unavailable_at")
					.in("id", safeIds);
				if (imgError) throw imgError;
				const orderById = new Map(safeIds.map((id, i) => [Number(id), i]));
				let sorted = (images ?? []).slice().sort((a, b) => (orderById.get(Number(a.id)) ?? 999) - (orderById.get(Number(b.id)) ?? 999));
				if (recommendableOnly) {
					sorted = sorted.filter(isRecommendableCreationRow);
				}
				const createdImageIds = sorted.map((r) => r.id).filter((id) => id != null);
				if (createdImageIds.length === 0) return [];
				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;
				const likeById = new Map((countRows ?? []).map((r) => [String(r.created_image_id), Number(r.like_count ?? 0)]));
				const { data: commentRows, error: commentError } = await serviceClient
					.from(prefixedTable("created_image_comment_counts"))
					.select("created_image_id, comment_count")
					.in("created_image_id", createdImageIds);
				if (commentError) throw commentError;
				const commentById = new Map((commentRows ?? []).map((r) => [String(r.created_image_id), Number(r.comment_count ?? 0)]));
				const authorIds = [...new Set(sorted.map((r) => r.user_id).filter(Boolean))];
				let profileByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (!profileError && profileRows) {
						profileByUserId = new Map(profileRows.map((r) => [String(r.user_id), r]));
					}
				}
				return sorted.map((row) => {
					const key = String(row.id);
					const profile = row.user_id != null ? profileByUserId.get(String(row.user_id)) : null;
					const meta = row.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const mediaType = typeof meta?.media_type === "string" ? meta.media_type : "image";
					const videoMeta = meta && typeof meta === "object" ? meta.video : null;
					const videoUrl = videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path ? videoMeta.file_path : null;
					const url =
						row.file_path ??
						(row.filename
							? `/api/images/created/${row.filename}`
							: null);
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary: row.description ?? "",
						created_at: row.created_at,
						user_id: row.user_id,
						published: row.published === true || row.published === 1,
						unavailable_at: row.unavailable_at ?? null,
						nsfw,
						meta,
						media_type: mediaType,
						video_url: videoUrl,
						like_count: likeById.get(key) ?? 0,
						comment_count: commentById.get(key) ?? 0,
						author_display_name: profile?.display_name ?? null,
						author_user_name: profile?.user_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						url
					};
				});
			}
		},
selectLatestCreatedImageComments: {
			all: async (options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "10"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 10;

				// Over-fetch a bit so filtering non-eligible creations still returns enough rows.
				const fetchLimit = Math.min(200, Math.max(10, limit * 5));

				const before =
					typeof options?.before === "string" && options.before.trim()
						? options.before.trim()
						: null;

				let commentsQuery = serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("id, user_id, created_image_id, text, created_at, updated_at, meta")
					.order("created_at", { ascending: false }).order("id", { ascending: false });
				if (before) {
					const beforeId = Number(options?.before_id);
					if (!Number.isFinite(Date.parse(before))) throw new Error("Invalid comment cursor");
					const timestamp = new Date(before).toISOString();
					commentsQuery = Number.isInteger(beforeId) && beforeId > 0
						? commentsQuery.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${beforeId})`)
						: commentsQuery.lt("created_at", timestamp);
				}
				const { data: rawComments, error: commentsError } = await commentsQuery.limit(fetchLimit);
				if (commentsError) throw commentsError;

				const comments = rawComments ?? [];

				const createdImageIds = Array.from(new Set(
					comments
						.map((row) => row?.created_image_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let imageById = new Map();
				if (createdImageIds.length > 0) {
					const { data: imageRows, error: imageError } = await serviceClient
						.from(prefixedTable("created_images"))
						.select("id, title, published, user_id, file_path, created_at, meta, unavailable_at")
						.in("id", createdImageIds);
					if (imageError) throw imageError;
					imageById = new Map((imageRows ?? []).map((row) => [String(row.id), row]));
				}

				const creatorUserIds = Array.from(new Set(
					Array.from(imageById.values())
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				let creatorProfileByUserId = new Map();
				if (creatorUserIds.length > 0) {
					const { data: creatorProfiles, error: creatorProfileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", creatorUserIds);
					if (creatorProfileError) throw creatorProfileError;
					creatorProfileByUserId = new Map(
						(creatorProfiles ?? []).map((row) => [String(row.user_id), row])
					);
				}

				const nowMs = Date.now();
				/** @type {Set<number>} */
				let activeEditorialPinCreationIds = new Set();
				/** @type {Map<number, string>} */
				const titleByCreationId = new Map();
				/** @type {string[]} */
				const challengeIdsForTitleLookup = [];
				try {
					const activePins = await getActiveEditorialPins(queries, nowMs, "");
					for (const pin of activePins || []) {
						const cid = Number(pin?.created_image_id);
						if (Number.isFinite(cid) && cid > 0) activeEditorialPinCreationIds.add(cid);
						const pinTitle = typeof pin?.title === "string" ? pin.title.trim() : "";
						if (Number.isFinite(cid) && cid > 0 && pinTitle) {
							titleByCreationId.set(cid, pinTitle);
						}
						const parsed = parseChallengeEditorialPinId(pin?.id);
						if (parsed.challengeId) challengeIdsForTitleLookup.push(parsed.challengeId);
					}
				} catch {
					activeEditorialPinCreationIds = new Set();
				}

				for (const image of imageById.values()) {
					const ownTitle = typeof image?.title === "string" ? image.title.trim() : "";
					if (ownTitle) continue;
					for (const challengeId of challengeIdsFromCreationMeta(image?.meta)) {
						challengeIdsForTitleLookup.push(challengeId);
					}
				}

				let challengeTitleById = new Map();
				try {
					challengeTitleById = await resolveChallengeTitlesByIds(challengeIdsForTitleLookup);
				} catch {
					challengeTitleById = new Map();
				}

				// Fill creation titles from challenge ids when the pin policy row has no title yet.
				for (const image of imageById.values()) {
					const imageId = Number(image?.id);
					if (!Number.isFinite(imageId) || imageId <= 0) continue;
					if (titleByCreationId.has(imageId)) continue;
					const ownTitle = typeof image?.title === "string" ? image.title.trim() : "";
					if (ownTitle) continue;
					for (const challengeId of challengeIdsFromCreationMeta(image?.meta)) {
						const t = challengeTitleById.get(challengeId);
						if (t) {
							titleByCreationId.set(imageId, t);
							break;
						}
					}
				}

				const visibleComments = comments
					.map((row) => {
						const image = row?.created_image_id !== null && row?.created_image_id !== undefined
							? imageById.get(String(row.created_image_id)) ?? null
							: null;
						const creatorProfile = image?.user_id !== null && image?.user_id !== undefined
							? creatorProfileByUserId.get(String(image.user_id)) ?? null
							: null;
						const nsfw = !!(image?.meta && typeof image.meta === "object" && image.meta.nsfw);
						const created_image_media_type = image?.meta?.media_type === "video" ? "video" : "image";
						const meta =
							row?.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {};
						return {
							...row,
							meta,
							_image: image,
							created_image_title: resolveCreationTitleForLatestComments(image, {
								nowMs,
								challengeTitleById,
								titleByCreationId
							}),
							created_image_is_challenge_media: creationMetaIsChallengeEditorialMedia(
								image?.meta,
								nowMs
							),
							created_image_url: image?.file_path ?? null,
							created_image_meta: image?.meta ?? null,
							created_image_created_at: image?.created_at ?? null,
							created_image_published: image?.published ?? null,
							created_image_user_id: image?.user_id ?? null,
							created_image_user_name: creatorProfile?.user_name ?? null,
							created_image_display_name: creatorProfile?.display_name ?? null,
							created_image_avatar_url: creatorProfile?.avatar_url ?? null,
							nsfw,
							created_image_media_type
						};
					})
					.filter((row) =>
						creationEligibleForLatestCommentsStream(row?._image, {
							nowMs,
							activeEditorialPinCreationIds
						})
					)
					.map((row) => {
						const { _image, ...rest } = row;
						return rest;
					});

				const trimmed = visibleComments.slice(0, limit);

				const userIds = Array.from(new Set(
					trimmed
						.map((row) => row?.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				const creatorUserIdsForPlan = Array.from(new Set(
					trimmed
						.map((row) => row?.created_image_user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				const allUserIds = Array.from(new Set([...userIds, ...creatorUserIdsForPlan]));

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

				let planByUserId = new Map();
				if (allUserIds.length > 0) {
					const { data: userRows, error: userError } = await serviceClient
						.from(prefixedTable("users"))
						.select("id, meta")
						.in("id", allUserIds);
					if (userError) throw userError;
					planByUserId = new Map(
						(userRows ?? []).map((r) => [
							String(r.id),
							r?.meta?.plan === "founder" ? "founder" : "free"
						])
					);
				}

				const enriched = trimmed.map((row) => {
					const profile = row?.user_id !== null && row?.user_id !== undefined
						? profileByUserId.get(String(row.user_id)) ?? null
						: null;
					const plan = row?.user_id != null ? (planByUserId.get(String(row.user_id)) ?? "free") : "free";
					const created_image_owner_plan = row?.created_image_user_id != null
						? (planByUserId.get(String(row.created_image_user_id)) ?? "free")
						: "free";
					return {
						...row,
						user_name: profile?.user_name ?? null,
						display_name: profile?.display_name ?? null,
						avatar_url: profile?.avatar_url ?? null,
						plan,
						created_image_owner_plan
					};
				});
				if (options.page) {
					const tail = comments.at(-1);
					return { rows: enriched, has_more: comments.length === fetchLimit, next_cursor: tail ? { before: tail.created_at, before_id: tail.id } : null };
				}
				return enriched;
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
publishCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				let query = serviceClient.from(prefixedTable("created_images"))
					.update({ published: true, published_at: new Date().toISOString(), title, description })
					.eq("id", id);
				if (!isAdmin) query = query.eq("user_id", userId);
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
unpublishCreatedImage: {
		run: async (id, userId, isAdmin = false) => {
				let query = serviceClient.from(prefixedTable("created_images"))
					.update({ published: false, published_at: null }).eq("id", id);
				if (!isAdmin) query = query.eq("user_id", userId);
				const { data, error } = await query.select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
insertFeedItem: {
		run: async (title, summary, author, tags, createdImageId) => {
				const { data, error } = await serviceClient.from(prefixedTable("feed_items"))
					.insert({ title, summary, author, tags: tags || null, created_image_id: createdImageId })
					.select("id").single();
				if (error) throw error;
				return { insertId: data.id, changes: 1 };
			}
		},
selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				const { data, error } = await serviceClient.from(prefixedTable("feed_items"))
					.select("id, title, summary, author, tags, created_at, created_image_id")
					.eq("created_image_id", createdImageId).order("created_at", { ascending: false }).limit(1).maybeSingle();
				if (error) throw error;
				return data ?? undefined;
			}
		},
deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				const { data, error } = await serviceClient.from(prefixedTable("feed_items"))
					.delete().eq("created_image_id", createdImageId).select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				const { data, error } = await serviceClient.from(prefixedTable("feed_items"))
					.update({ title, summary }).eq("created_image_id", createdImageId).select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
deleteAllLikesForCreatedImage: {
		run: async (createdImageId) => {
				const { data, error } = await serviceClient.from(prefixedTable("likes_created_image"))
					.delete().eq("created_image_id", createdImageId).select("id");
				if (error) throw error;
				return { changes: data?.length ?? 0 };
			}
		},
deleteAllCommentsForCreatedImage: {
		run: async (createdImageId) => {
				const { data, error } = await serviceClient.from(prefixedTable("comments_created_image"))
					.delete().eq("created_image_id", createdImageId).select("id");
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
					changes: 1
				};
			}
		},
updateUserCreditsBalance: {
 run: async (userId, amount) => {
  const delta = Number(amount);
  if (!Number.isFinite(delta)) throw new TypeError('Invalid credit adjustment');
  for (let attempt = 0; attempt < 8; attempt++) {
   const { data: current, error: readError } = await serviceClient.from('prsn_user_credits').select('balance, updated_at').eq('user_id', userId).single();
   if (readError) throw readError;
   const nextBalance = Number(current.balance) + delta;
   if (nextBalance < 0) { const error = new Error('Insufficient credits'); error.status = 402; throw error; }
   // PostgreSQL double precision balances can lose precision when decoded into
   // JavaScript. Use the row timestamp as the revision, rather than round-tripping
   // a floating-point balance into an exact-equality predicate.
   let update = serviceClient.from('prsn_user_credits').update({ balance: nextBalance, updated_at: new Date().toISOString() }).eq('user_id', userId);
   update = current.updated_at == null ? update.is('updated_at', null) : update.eq('updated_at', current.updated_at);
   const { data, error } = await update.select('id');
   if (error) throw error;
   if (data?.length) return { changes: data.length };
  }
  const error = new Error('Unable to update credits right now. Please try again shortly.');
  error.status = 503;
  throw error;
 }
}

};
const STORAGE_BUCKET = "prsn_created-images";
const STORAGE_BUCKET_ANON = "prsn_created-images-anon";
const STORAGE_THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";
const GENERIC_BUCKET = "prsn_generic-images";
const MISC_BUCKET = "prsn_misc";
function storageBucketForGenericKey(objectKey) {
		const key = String(objectKey || "");
		if (/^profile\/\d+\/misc_[^/]+$/i.test(key)) return MISC_BUCKET;
		if (key.startsWith("share-audio/")) return MISC_BUCKET;
		if (key.startsWith("prompt-audio/")) return MISC_BUCKET;
		return GENERIC_BUCKET;
	}
async function uploadFitThumbnailObject(buffer, filename) {
		const fitKey = fitThumbnailStorageKey(filename);
		const fitBuffer = await buildFitThumbnailBuffer(buffer);
		const { error: fitError } = await storageClient.storage
			.from(STORAGE_THUMBNAIL_BUCKET)
			.upload(fitKey, fitBuffer, {
				contentType: "image/webp",
				upsert: true
			});
		if (fitError) {
			throw new Error(`Failed to upload fit thumbnail to Supabase Storage: ${fitError.message}`);
		}
		return true;
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

			const thumbnailBuffer = await buildSquareThumbnailBuffer(buffer);
			const { error: thumbnailError } = await storageClient.storage
				.from(STORAGE_THUMBNAIL_BUCKET)
				.upload(filename, thumbnailBuffer, {
					contentType: "image/webp",
					upsert: true
				});
			if (thumbnailError) {
				throw new Error(`Failed to upload thumbnail to Supabase Storage: ${thumbnailError.message}`);
			}

			// Native-aspect fit thumb for non-square media (does not replace square thumbnail).
			try {
				const dims = await sharp(buffer, { failOn: "none" }).metadata();
				const w = Number(dims.width) || 0;
				const h = Number(dims.height) || 0;
				if (w > 0 && h > 0 && shouldGenerateFitThumbnail(w, h)) {
					await uploadFitThumbnailObject(buffer, filename);
				}
			} catch (fitErr) {
				// Square thumb already uploaded; fit is additive — log and continue.
				console.error("Failed to upload fit thumbnail:", fitErr?.message || fitErr);
			}

			// Return backend route URL instead of public Supabase URL
			// Images will be served through /api/images/created/:filename
			return `/api/images/created/${filename}`;
		},

		/** Upload / overwrite a native-aspect fit thumb from a full image buffer. */
		uploadFitThumbnail: async (buffer, filename) => {
			return uploadFitThumbnailObject(buffer, filename);
		},

		/** True when a fit object exists for this full-image storage key. */
		hasFitThumbnail: async (filename) => {
			const fitKey = fitThumbnailStorageKey(filename);
			const { data, error } = await storageClient.storage
				.from(STORAGE_THUMBNAIL_BUCKET)
				.download(fitKey);
			if (error || !data) return false;
			return true;
		},

		uploadVideo: async (buffer, filename, options = {}) => {
			const contentType = String(options?.contentType || "video/mp4");
			// Supabase project may enforce a lower max object size in Dashboard → Storage → bucket limits.
			const { error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.upload(filename, buffer, {
					contentType,
					upsert: true
				});

			if (error) {
				throw new Error(`Failed to upload video to Supabase Storage: ${error.message}`);
			}

			return `/api/videos/created/${filename}`;
		},

		getImageUrl: (filename) => {
			// Return backend route URL - images are served through the backend
			return `/api/images/created/${filename}`;
		},

		uploadImageAnon: async (buffer, filename) => {
			const { error } = await storageClient.storage
				.from(STORAGE_BUCKET_ANON)
				.upload(filename, buffer, { contentType: "image/png", upsert: true });
			if (error) {
				throw new Error(`Failed to upload anon image to Supabase Storage: ${error.message}`);
			}
			return `/api/try/images/${filename}`;
		},

		getImageUrlAnon: (filename) => `/api/try/images/${filename}`,

		getImageBufferAnon: async (filename) => {
			const { data, error } = await storageClient.storage
				.from(STORAGE_BUCKET_ANON)
				.download(filename);
			if (error) {
				throw new Error(`Anon image not found: ${filename}`);
			}
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		deleteImageAnon: async (filename) => {
			if (!filename || filename.includes("..") || filename.includes("/")) return;
			try {
				await storageClient.storage.from(STORAGE_BUCKET_ANON).remove([filename]);
			} catch (_) { }
		},

		getImageBuffer: async (filename, options = {}) => {
			const variant = String(options?.variant ?? "").trim().toLowerCase();
			const isThumbnail = variant === "thumbnail";
			const isFit = variant === "fit";
			const throwIfMissing = options?.throwIfMissing === true;
			const bucket = isThumbnail || isFit ? STORAGE_THUMBNAIL_BUCKET : STORAGE_BUCKET;
			const objectKey = isFit ? fitThumbnailStorageKey(filename) : filename;
			// Fetch image from Supabase Storage and return as buffer
			// Uses storage client (service role if available) to access private bucket
			let { data, error } = await storageClient.storage
				.from(bucket)
				.download(objectKey);

			// Fit is optional — fall back to the square thumb key when _fit.jpg is missing.
			if (error && isFit) {
				({ data, error } = await storageClient.storage
					.from(STORAGE_THUMBNAIL_BUCKET)
					.download(filename));
			}

			if (error) {
				if (throwIfMissing || isFit) {
					throw new Error(`Image not found: ${objectKey}`);
				}
				// console.error("Supabase image fetch failed, serving fallback image.", {
				// 	bucket,
				// 		filename,
				// 		variant: options?.variant ?? null,
				// 			error: error?.message ?? error
				// });
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

		getVideoBuffer: async (filename) => {
			const { data, error } = await storageClient.storage
				.from(STORAGE_BUCKET)
				.download(filename);
			if (error) {
				throw new Error(`Video not found: ${filename}`);
			}
			const arrayBuffer = await data.arrayBuffer();
			return Buffer.from(arrayBuffer);
		},

		getGenericImageBuffer: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) {
				throw new Error("Image not found");
			}
			const bucket = storageBucketForGenericKey(objectKey);
			const { data, error } = await storageClient.storage
				.from(bucket)
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
			const bucket = storageBucketForGenericKey(objectKey);
			const { error } = await storageClient.storage
				.from(bucket)
				.upload(objectKey, buffer, { contentType, upsert: true });
			if (error) {
				throw new Error(`Failed to upload generic image: ${error.message}`);
			}
			return objectKey;
		},

		deleteGenericImage: async (key) => {
			const objectKey = String(key || "");
			if (!objectKey) return;
			const bucket = storageBucketForGenericKey(objectKey);
			const { error } = await storageClient.storage
				.from(bucket)
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
async function canUseServer(userId, serverId) {
 const [user, server] = await Promise.all([queries.selectUserById.get(userId), queries.selectServerById.get(serverId)]);
 if (!user || user.suspended || !server || server.status === 'suspended') return false;
 if ([1, 6].includes(Number(serverId)) || Number(server.user_id) === Number(userId) || user.role === 'admin') return true;
 const { data, error } = await client.from('prsn_server_members').select('server_id').eq('server_id', serverId).eq('user_id', userId).limit(1);
 if (error) throw error;
 return Boolean(data?.length);
}
return { queries, storage, canUseServer };
}
