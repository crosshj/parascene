import { getThumbnailUrl } from '../services/create/url.js';
import { isRecommendableCreationRow } from '../services/create/recommendableCreations.js';
import { putAnchorCreationFirst } from '../services/feed/doomSiteVideoTimeline.js';
import { isFeedRowVideoCreation } from '../client/shared/chatFeedMobilePartition.js';
import { createSelectFeedBetaSitewideCatalog } from './feedCatalog.js';
const prefixedTable = name => 'prsn_' + name;
export function resolveFeedRowTitle(creationTitle, feedItemTitle) {
	// The creation owns its title, including an intentionally empty title.
	// Older feed rows stored "Untitled" as a placeholder; leave that to the UI.
	if (creationTitle !== undefined) return typeof creationTitle === 'string' ? creationTitle.trim() : '';
	const fallback = String(feedItemTitle ?? '').trim();
	return fallback === 'Untitled' ? '' : fallback;
}
export function createFeedQueries(serviceClient) { return {
		selectCreatedImageLikersByImageIds: {
			all: async (creationIds, opts = {}) => {
				const ids = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (ids.length === 0) return [];
				const limit = Math.min(Math.max(1, Number(opts.limit) || 400), 800);
				const { data: likeRows, error: err1 } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id, user_id, created_at")
					.in("created_image_id", ids)
					.order("created_at", { ascending: false })
					.limit(limit);
				if (err1) throw err1;
				const rows = likeRows ?? [];
				if (rows.length === 0) return [];
				const userIds = [...new Set(rows.map((r) => r.user_id).filter((id) => id != null))];
				if (userIds.length === 0) return [];
				const { data: profiles, error: err2 } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, display_name, user_name")
					.in("user_id", userIds);
				if (err2) throw err2;
				const byUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
				return rows.map((r) => {
					const p = byUserId.get(r.user_id) ?? {};
					return {
						created_image_id: r.created_image_id,
						user_id: r.user_id,
						display_name: p.display_name ?? null,
						user_name: p.user_name ?? null,
						created_at: r.created_at
					};
				});
			}
		},
		/**
		 * Unique commenters per creation (most recent comment first).
		 * [{ created_image_id, user_id, display_name, user_name, last_commented_at }]
		 */
		selectCreatedImageCommentersByImageIds: {
			all: async (creationIds, opts = {}) => {
				const ids = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (ids.length === 0) return [];
				const limit = Math.min(Math.max(1, Number(opts.limit) || 800), 2000);
				const { data: commentRows, error: err1 } = await serviceClient
					.from(prefixedTable("comments_created_image"))
					.select("created_image_id, user_id, created_at")
					.in("created_image_id", ids)
					.order("created_at", { ascending: false })
					.limit(limit);
				if (err1) throw err1;
				const rows = commentRows ?? [];
				if (rows.length === 0) return [];
				const seen = new Set();
				const unique = [];
				for (const r of rows) {
					const cid = Number(r.created_image_id);
					const uid = Number(r.user_id);
					if (!Number.isFinite(cid) || !Number.isFinite(uid)) continue;
					const k = `${cid}:${uid}`;
					if (seen.has(k)) continue;
					seen.add(k);
					unique.push(r);
				}
				const userIds = [...new Set(unique.map((r) => r.user_id).filter((id) => id != null))];
				if (userIds.length === 0) return [];
				const { data: profiles, error: err2 } = await serviceClient
					.from(prefixedTable("user_profiles"))
					.select("user_id, display_name, user_name")
					.in("user_id", userIds);
				if (err2) throw err2;
				const byUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
				return unique.map((r) => {
					const p = byUserId.get(r.user_id) ?? {};
					return {
						created_image_id: r.created_image_id,
						user_id: r.user_id,
						display_name: p.display_name ?? null,
						user_name: p.user_name ?? null,
						last_commented_at: r.created_at
					};
				});
			}
		},
		selectViewerLikedCreationIds: {
			all: async (userId, creationIds) => {
				const safeIds = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id")
					.eq("user_id", userId)
					.in("created_image_id", safeIds);
				if (error) throw error;
				return (data ?? []).map((r) => Number(r.created_image_id));
			}
		},
		/** All liked creation ids for viewer — faster than IN(hundreds of catalog ids). */
		selectViewerLikedCreationIdsByUser: {
			all: async (userId, opts = {}) => {
				const uid = Number(userId);
				if (!Number.isFinite(uid) || uid <= 0) return [];
				const limit = Math.min(
					Math.max(1, Number(opts.limit) || 2000),
					5000
				);
				const { data, error } = await serviceClient
					.from(prefixedTable("likes_created_image"))
					.select("created_image_id")
					.eq("user_id", uid)
					.order("created_image_id", { ascending: false })
					.limit(limit);
				if (error) throw error;
				return (data ?? []).map((r) => Number(r.created_image_id));
			}
		},

selectFeedItems: (() => {
			/** Like/comment counts, viewer liked, and author profile fields for feed creation rows. */
			async function enrichFeedCreationRows(viewerId, pageRows) {
				if (!Array.isArray(pageRows) || pageRows.length === 0) return pageRows;

				const createdImageIds = pageRows
					.map((item) => item.created_image_id)
					.filter((id) => id !== null && id !== undefined);
				if (createdImageIds.length === 0) return pageRows;

				const authorIds = Array.from(
					new Set(
						pageRows
							.map((item) => item.user_id)
							.filter((id) => id !== null && id !== undefined)
							.map((id) => Number(id))
							.filter((id) => Number.isFinite(id) && id > 0)
					)
				);

				const [
					likeCountResult,
					commentCountResult,
					likedResult,
					profileResult,
					userResult
				] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_image_like_counts"))
						.select("created_image_id, like_count")
						.in("created_image_id", createdImageIds),
					serviceClient
						.from(prefixedTable("created_image_comment_counts"))
						.select("created_image_id, comment_count")
						.in("created_image_id", createdImageIds),
					viewerId != null
						? serviceClient
							.from(prefixedTable("likes_created_image"))
							.select("created_image_id")
							.eq("user_id", viewerId)
							.in("created_image_id", createdImageIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("user_profiles"))
							.select("user_id, user_name, display_name, avatar_url")
							.in("user_id", authorIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("users"))
							.select("id, meta")
							.in("id", authorIds)
						: Promise.resolve({ data: [], error: null })
				]);

				if (likeCountResult.error) throw likeCountResult.error;
				if (commentCountResult.error) throw commentCountResult.error;
				if (likedResult.error) throw likedResult.error;
				if (profileResult.error) throw profileResult.error;
				if (userResult.error) throw userResult.error;

				const countById = new Map(
					(likeCountResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);
				const commentCountById = new Map(
					(commentCountResult.data ?? []).map((row) => [
						String(row.created_image_id),
						Number(row.comment_count ?? 0)
					])
				);
				const likedIdSet = likedResult.data?.length
					? new Set((likedResult.data ?? []).map((row) => String(row.created_image_id)))
					: null;
				const profileByUserId = new Map(
					(profileResult.data ?? []).map((row) => [String(row.user_id), row])
				);
				const planByUserId = new Map();
				(userResult.data ?? []).forEach((row) => {
					const plan = row?.meta?.plan === "founder" ? "founder" : "free";
					planByUserId.set(String(row.id), plan);
				});

				return pageRows.map((item) => {
					const key =
						item.created_image_id === null || item.created_image_id === undefined
							? null
							: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile =
						item.user_id !== null && item.user_id !== undefined
							? profileByUserId.get(String(item.user_id)) ?? null
							: null;
					const authorPlan =
						item.user_id != null ? (planByUserId.get(String(item.user_id)) ?? "free") : "free";
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						author_plan: authorPlan
					};
				});
			}

			const selectFeedItems = {
			all: async (excludeUserId, { includeOwnPosts = false } = {}) => {
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
				if (includeOwnPosts) {
					followingIdSet.add(String(viewerId));
				}
				if (followingIdSet.size === 0) {
					return [];
				}

				// Use serviceClient to bypass RLS for backend operations
				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id, unavailable_at, meta, title)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;
				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						unavailable_at,
						nsfw,
						meta,
						// Use file_path (which contains the URL) or fall back to constructing from filename
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (item.unavailable_at != null && item.unavailable_at !== "") return false;
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
				let planByUserId = new Map();
				if (authorIds.length > 0) {
					const { data: profileRows, error: profileError } = await serviceClient
						.from(prefixedTable("user_profiles"))
						.select("user_id, user_name, display_name, avatar_url")
						.in("user_id", authorIds);
					if (profileError) throw profileError;
					profileByUserId = new Map(
						(profileRows ?? []).map((row) => [String(row.user_id), row])
					);
					const { data: userRows, error: userError } = await serviceClient
						.from(prefixedTable("users"))
						.select("id, meta")
						.in("id", authorIds);
					if (!userError && userRows?.length) {
						userRows.forEach((row) => {
							const plan = row?.meta?.plan === "founder" ? "founder" : "free";
							planByUserId.set(String(row.id), plan);
						});
					}
				}

				const mapped = filtered.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					const authorPlan = item.user_id != null ? (planByUserId.get(String(item.user_id)) ?? "free") : "free";
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						author_plan: authorPlan
					};
				});
				return mapped;
			},
			getPage: async (viewerId, { limit = 20, offset = 0, includeOwnPosts = false } = {}) => {
				const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
				const safeOffset = Math.max(0, Number(offset) || 0);

				if (viewerId === null || viewerId === undefined) {
					return { rows: [], hasMore: false };
				}

				// Single round-trip RPC when available (much faster than 3+ API calls)
				if (!includeOwnPosts) {
					const rpcResult = await serviceClient.rpc("prsn_get_feed_page", {
						p_viewer_id: viewerId,
						p_limit: safeLimit,
						p_offset: safeOffset
					});
					if (!rpcResult.error && Array.isArray(rpcResult.data)) {
						const all = rpcResult.data;
						const hasMore = all.length > safeLimit;
						const pageSlice = all.slice(0, safeLimit);
						const creationIds = pageSlice
							.map((row) => row.created_image_id)
							.filter((cid) => cid != null && cid !== undefined)
							.map((cid) => Number(cid))
							.filter((cid) => Number.isFinite(cid) && cid > 0);
						let titleByCreationId = new Map();
						if (creationIds.length > 0) {
							const { data: titleRows, error: titleErr } = await serviceClient
								.from(prefixedTable("created_images"))
								.select("id, title")
								.in("id", creationIds);
							if (!titleErr && Array.isArray(titleRows)) {
								titleByCreationId = new Map(titleRows.map((r) => [String(r.id), r.title]));
							}
						}
						const rows = pageSlice.map((row) => {
							const key =
								row.created_image_id != null && row.created_image_id !== undefined
									? String(row.created_image_id)
									: null;
							const ct = key ? titleByCreationId.get(key) : undefined;
							const title = resolveFeedRowTitle(ct, row.title);
							return {
								id: row.id,
								title,
								summary: row.summary,
								author: row.author,
								tags: row.tags,
								created_at: row.created_at,
								created_image_id: row.created_image_id,
								filename: row.filename,
								file_path: row.file_path,
								user_id: row.user_id,
								meta: row.meta,
								url: row.url,
								like_count: Number(row.like_count ?? 0),
								comment_count: Number(row.comment_count ?? 0),
								viewer_liked: Boolean(row.viewer_liked),
								nsfw: Boolean(row.nsfw),
								author_user_name: row.author_user_name ?? null,
								author_display_name: row.author_display_name ?? null,
								author_avatar_url: row.author_avatar_url ?? null,
								author_plan: row.author_plan ?? "free"
							};
						});
						return { rows, hasMore };
					}
				}

				// Fallback: multi-query path (when RPC not deployed or errors)
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
				if (includeOwnPosts) {
					followingIdSet.add(String(viewerId));
				}
				if (followingIdSet.size === 0) {
					return { rows: [], hasMore: false };
				}

				const followingIds = Array.from(followingIdSet);
				// Fetch one page from DB (limit+1 to compute hasMore); filter by followed users via inner join
				const { data: pageData, error: pageError } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)"
					)
					.in("prsn_created_images.user_id", followingIds)
					.order("created_at", { ascending: false })
					.range(safeOffset, safeOffset + safeLimit);
				if (pageError) throw pageError;

				const items = (pageData ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						unavailable_at,
						nsfw,
						meta,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (item.unavailable_at != null && item.unavailable_at !== "") return false;
					return followingIdSet.has(String(item.user_id));
				});

				const hasMore = filtered.length > safeLimit;
				const pageRows = filtered.slice(0, safeLimit);

				const createdImageIds = pageRows
					.map((item) => item.created_image_id)
					.filter((id) => id !== null && id !== undefined);

				if (createdImageIds.length === 0) {
					return { rows: pageRows, hasMore };
				}

				const authorIds = Array.from(new Set(
					pageRows
						.map((item) => item.user_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0)
				));

				// Run enrichment queries in parallel (saves ~4 round-trips)
				const [
					likeCountResult,
					commentCountResult,
					likedResult,
					profileResult,
					userResult
				] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_image_like_counts"))
						.select("created_image_id, like_count")
						.in("created_image_id", createdImageIds),
					serviceClient
						.from(prefixedTable("created_image_comment_counts"))
						.select("created_image_id, comment_count")
						.in("created_image_id", createdImageIds),
					viewerId != null
						? serviceClient
							.from(prefixedTable("likes_created_image"))
							.select("created_image_id")
							.eq("user_id", viewerId)
							.in("created_image_id", createdImageIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("user_profiles"))
							.select("user_id, user_name, display_name, avatar_url")
							.in("user_id", authorIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("users"))
							.select("id, meta")
							.in("id", authorIds)
						: Promise.resolve({ data: [], error: null })
				]);

				if (likeCountResult.error) throw likeCountResult.error;
				if (commentCountResult.error) throw commentCountResult.error;
				if (likedResult.error) throw likedResult.error;
				if (profileResult.error) throw profileResult.error;
				if (userResult.error) throw userResult.error;

				const countById = new Map(
					(likeCountResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);
				const commentCountById = new Map(
					(commentCountResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);
				const likedIdSet = likedResult.data?.length
					? new Set((likedResult.data ?? []).map((row) => String(row.created_image_id)))
					: null;

				const profileByUserId = new Map(
					(profileResult.data ?? []).map((row) => [String(row.user_id), row])
				);
				const planByUserId = new Map();
				(userResult.data ?? []).forEach((row) => {
					const plan = row?.meta?.plan === "founder" ? "founder" : "free";
					planByUserId.set(String(row.id), plan);
				});

				const mapped = pageRows.map((item) => {
					const key = item.created_image_id === null || item.created_image_id === undefined
						? null
						: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id !== null && item.user_id !== undefined
						? profileByUserId.get(String(item.user_id)) ?? null
						: null;
					const authorPlan = item.user_id != null ? (planByUserId.get(String(item.user_id)) ?? "free") : "free";
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						author_plan: authorPlan
					};
				});

				return { rows: mapped, hasMore };
			},
			getSitePublishedVideoFeedPage: async (
				viewerId,
				{ limit = 20, mode = "head", startCreationId = null, afterCreatedImageId = null } = {}
			) => {
				const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
				const rowIsStrictlyOlder = (item, cursorAt, cursorId) => {
					const ra = String(item?.created_at ?? "");
					const ca = String(cursorAt ?? "");
					if (ra < ca) return true;
					if (ra > ca) return false;
					const rid = Number(item?.created_image_id ?? item?.id);
					const cid = Number(cursorId);
					if (!Number.isFinite(rid) || !Number.isFinite(cid)) {
						return ra === ca && String(item?.created_image_id ?? item?.id) < String(cursorId);
					}
					return rid < cid;
				};
				const mapFeedRow = (item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						unavailable_at,
						nsfw,
						meta,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				};
				const isDoomSiteVideoRow = (row) => {
					if (row.unavailable_at != null && row.unavailable_at !== "") return false;
					return isFeedRowVideoCreation(row);
				};
				const cols =
					"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)";
				const cap = Math.min(300, Math.max(safeLimit + 1, safeLimit * 4));
				let query = serviceClient
					.from(prefixedTable("feed_items"))
					.select(cols)
					.eq("prsn_created_images.meta->>media_type", "video")
					.order("created_at", { ascending: false })
					.order("created_image_id", { ascending: false })
					.limit(cap);
				if (mode === "from_anchor") {
					const anchorId = Number(startCreationId);
					if (!Number.isFinite(anchorId) || anchorId <= 0) {
						return { rows: [], hasMore: false, cursor: null };
					}
					const { data: anchorRow, error: anchorErr } = await serviceClient
						.from(prefixedTable("feed_items"))
						.select("created_at, created_image_id, prsn_created_images!inner(unavailable_at, meta)")
						.eq("created_image_id", anchorId)
						.eq("prsn_created_images.meta->>media_type", "video")
						.maybeSingle();
					if (anchorErr) throw anchorErr;
					if (!anchorRow?.created_at) return { rows: [], hasMore: false, cursor: null };
					const anchorMeta = anchorRow.prsn_created_images?.meta ?? null;
					if (
						!isFeedRowVideoCreation({
							media_type: anchorMeta?.media_type,
							meta: anchorMeta
						})
					) {
						return { rows: [], hasMore: false, cursor: null };
					}
					query = query.lte("created_at", String(anchorRow.created_at));
					const { data, error } = await query;
					if (error) throw error;
					const filtered = putAnchorCreationFirst(
						(data ?? [])
							.map(mapFeedRow)
							.filter((row) => {
								if (!isDoomSiteVideoRow(row)) return false;
								const rid = Number(row?.created_image_id ?? row?.id);
								if (rid === anchorId) return true;
								return rowIsStrictlyOlder(row, anchorRow.created_at, anchorId);
							}),
						anchorId
					);
					const hasMore = filtered.length > safeLimit;
					const pageRows = filtered.slice(0, safeLimit);
					const mapped = await enrichFeedCreationRows(viewerId, pageRows);
					const last = mapped.length > 0 ? mapped[mapped.length - 1] : null;
					const cursor = last
						? { after_created_image_id: String(last.created_image_id ?? last.id) }
						: null;
					return { rows: mapped, hasMore, cursor };
				}
				if (mode === "older_than") {
					const cursorId = Number(afterCreatedImageId);
					if (!Number.isFinite(cursorId) || cursorId <= 0) {
						return { rows: [], hasMore: false, cursor: null };
					}
					const { data: cursorRow, error: cursorErr } = await serviceClient
						.from(prefixedTable("feed_items"))
						.select("created_at, created_image_id, prsn_created_images!inner(unavailable_at, meta)")
						.eq("created_image_id", cursorId)
						.eq("prsn_created_images.meta->>media_type", "video")
						.maybeSingle();
					if (cursorErr) throw cursorErr;
					if (!cursorRow?.created_at) return { rows: [], hasMore: false, cursor: null };
					query = query.lte("created_at", String(cursorRow.created_at));
					const { data, error } = await query;
					if (error) throw error;
					const filtered = (data ?? [])
						.map(mapFeedRow)
						.filter((row) =>
							isDoomSiteVideoRow(row) &&
							rowIsStrictlyOlder(row, cursorRow.created_at, cursorId)
						);
					const hasMore = filtered.length > safeLimit;
					const pageRows = filtered.slice(0, safeLimit);
					const mapped = await enrichFeedCreationRows(viewerId, pageRows);
					const last = mapped.length > 0 ? mapped[mapped.length - 1] : null;
					const cursor = last
						? { after_created_image_id: String(last.created_image_id ?? last.id) }
						: null;
					return { rows: mapped, hasMore, cursor };
				}
				const { data, error } = await query;
				if (error) throw error;
				const mappedRows = (data ?? [])
					.map(mapFeedRow)
					.filter((row) => isDoomSiteVideoRow(row));
				const hasMore = mappedRows.length > safeLimit;
				const pageRows = mappedRows.slice(0, safeLimit);
				const mapped = await enrichFeedCreationRows(viewerId, pageRows);
				const last = mapped.length > 0 ? mapped[mapped.length - 1] : null;
				const cursor = last
					? { after_created_image_id: String(last.created_image_id ?? last.id) }
					: null;
				return { rows: mapped, hasMore, cursor };
			},
			getPageAfterImageCursor: async (
				viewerId,
				{
					limit = 20,
					includeOwnPosts = false,
					afterCreatedAt = "",
					afterCreatedImageId = 0
				} = {}
			) => {
				const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
				const cursorAt = String(afterCreatedAt ?? "");
				const cursorId = Number(afterCreatedImageId);
				if (viewerId === null || viewerId === undefined || !cursorAt) {
					return { rows: [], hasMore: false };
				}

				const rowIsStrictlyOlder = (item) => {
					const ra = String(item?.created_at ?? "");
					const ca = cursorAt;
					if (ra < ca) return true;
					if (ra > ca) return false;
					const rid = Number(item?.created_image_id ?? item?.id);
					return Number.isFinite(rid) && Number.isFinite(cursorId) && rid < cursorId;
				};

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
				if (includeOwnPosts) {
					followingIdSet.add(String(viewerId));
				}
				if (followingIdSet.size === 0) {
					return { rows: [], hasMore: false };
				}

				const followingIds = Array.from(followingIdSet);
				const fetchCap = Math.min(200, Math.max(safeLimit + 1, safeLimit * 3));
				const { data: pageData, error: pageError } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)"
					)
					.in("prsn_created_images.user_id", followingIds)
					.lte("created_at", cursorAt)
					.order("created_at", { ascending: false })
					.order("created_image_id", { ascending: false })
					.limit(fetchCap);
				if (pageError) throw pageError;

				const items = (pageData ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						unavailable_at,
						nsfw,
						meta,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (item.unavailable_at != null && item.unavailable_at !== "") return false;
					if (!followingIdSet.has(String(item.user_id))) return false;
					return rowIsStrictlyOlder(item);
				});

				const hasMore = filtered.length > safeLimit;
				const pageRows = filtered.slice(0, safeLimit);

				const createdImageIds = pageRows
					.map((item) => item.created_image_id)
					.filter((id) => id !== null && id !== undefined);

				if (createdImageIds.length === 0) {
					return { rows: pageRows, hasMore };
				}

				const authorIds = Array.from(
					new Set(
						pageRows
							.map((item) => item.user_id)
							.filter((id) => id !== null && id !== undefined)
							.map((id) => Number(id))
							.filter((id) => Number.isFinite(id) && id > 0)
					)
				);

				const [
					likeCountResult,
					commentCountResult,
					likedResult,
					profileResult,
					userResult
				] = await Promise.all([
					serviceClient
						.from(prefixedTable("created_image_like_counts"))
						.select("created_image_id, like_count")
						.in("created_image_id", createdImageIds),
					serviceClient
						.from(prefixedTable("created_image_comment_counts"))
						.select("created_image_id, comment_count")
						.in("created_image_id", createdImageIds),
					viewerId != null
						? serviceClient
							.from(prefixedTable("likes_created_image"))
							.select("created_image_id")
							.eq("user_id", viewerId)
							.in("created_image_id", createdImageIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("user_profiles"))
							.select("user_id, user_name, display_name, avatar_url")
							.in("user_id", authorIds)
						: Promise.resolve({ data: [], error: null }),
					authorIds.length > 0
						? serviceClient
							.from(prefixedTable("users"))
							.select("id, meta")
							.in("id", authorIds)
						: Promise.resolve({ data: [], error: null })
				]);

				if (likeCountResult.error) throw likeCountResult.error;
				if (commentCountResult.error) throw commentCountResult.error;
				if (likedResult.error) throw likedResult.error;
				if (profileResult.error) throw profileResult.error;
				if (userResult.error) throw userResult.error;

				const countById = new Map(
					(likeCountResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.like_count ?? 0)])
				);
				const commentCountById = new Map(
					(commentCountResult.data ?? []).map((row) => [String(row.created_image_id), Number(row.comment_count ?? 0)])
				);
				const likedIdSet = likedResult.data?.length
					? new Set((likedResult.data ?? []).map((row) => String(row.created_image_id)))
					: null;

				const profileByUserId = new Map(
					(profileResult.data ?? []).map((row) => [String(row.user_id), row])
				);
				const planByUserId = new Map();
				(userResult.data ?? []).forEach((row) => {
					const plan = row?.meta?.plan === "founder" ? "founder" : "free";
					planByUserId.set(String(row.id), plan);
				});

				const mapped = pageRows.map((item) => {
					const key =
						item.created_image_id === null || item.created_image_id === undefined
							? null
							: String(item.created_image_id);
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile =
						item.user_id !== null && item.user_id !== undefined
							? profileByUserId.get(String(item.user_id)) ?? null
							: null;
					const authorPlan =
						item.user_id != null ? (planByUserId.get(String(item.user_id)) ?? "free") : "free";
					return {
						...item,
						like_count: likeCount,
						comment_count: commentCount,
						viewer_liked: viewerLiked,
						author_user_name: profile?.user_name ?? null,
						author_display_name: profile?.display_name ?? null,
						author_avatar_url: profile?.avatar_url ?? null,
						author_plan: authorPlan
					};
				});

				return { rows: mapped, hasMore };
			},
			getLatestFeedSlotPackHead: async (
				viewerId,
				{ videoLimit = 12, imageLimit = 9, includeOwnPosts = false } = {}
			) => {
				if (viewerId === null || viewerId === undefined) {
					return { videos: [], images: [] };
				}
				const safeVid = Math.min(Math.max(1, Number(videoLimit) || 12), 50);
				const safeImg = Math.min(Math.max(1, Number(imageLimit) || 9), 50);

				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", viewerId);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((r) => r?.following_id)
						.filter((id) => id !== null && id !== undefined)
						.map((id) => String(id))
				);
				if (includeOwnPosts) followingIdSet.add(String(viewerId));

				const followingIds = Array.from(followingIdSet);
				const cols =
					"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)";

				const [siteVideoPage, imgResult] = await Promise.all([
					selectFeedItems.getSitePublishedVideoFeedPage(viewerId, {
						mode: "head",
						limit: safeVid
					}),
					followingIds.length > 0
						? serviceClient
						.from(prefixedTable("feed_items"))
						.select(cols)
						.in("prsn_created_images.user_id", followingIds)
						.not("prsn_created_images.meta->>media_type", "eq", "video")
						.order("created_at", { ascending: false })
						.order("created_image_id", { ascending: false })
						.limit(safeImg)
						: Promise.resolve({ data: [], error: null })
				]);
				if (imgResult.error) throw imgResult.error;

				const mapRow = (item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const unavailable_at = prsn_created_images?.unavailable_at ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest, title, filename, user_id, unavailable_at, nsfw, meta,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0, comment_count: 0, viewer_liked: false
					};
				};
				const filterRow = (item) =>
					item.user_id !== null &&
					item.user_id !== undefined &&
					(item.unavailable_at == null || item.unavailable_at === "") &&
					followingIdSet.has(String(item.user_id));

				let videos = Array.isArray(siteVideoPage?.rows) ? siteVideoPage.rows : [];
				let images = (imgResult.data ?? []).map(mapRow).filter(filterRow);
				images = await enrichFeedCreationRows(viewerId, images);
				return { videos, images };
			}
			};
			return selectFeedItems;
		})(),
selectExploreFeedItems: (() => {
			const exploreAll = async (viewerId) => {
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
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id, meta, title)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const meta = prsn_created_images?.meta ?? null;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						meta,
						nsfw,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						thumbnail_url: getThumbnailUrl(file_path || (filename ? `/api/images/created/${filename}` : null)),
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

				const full = filtered.map((item) => {
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
				return full;
			};

			// Paginated: same logic as exploreAll but limits the initial DB fetch so we don't pull the whole table.
			const explorePaginated = async (viewerId, { limit = 24, offset = 0 } = {}) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) return [];

				// Allow limit+1 (e.g. 101) so API can detect hasMore; cap at 500 for safety
				const lim = Math.min(Math.max(0, Number(limit) || 24), 500);
				const off = Math.max(0, Number(offset) || 0);

				const { data: followRows, error: followError } = await serviceClient
					.from(prefixedTable("user_follows"))
					.select("following_id")
					.eq("follower_id", id);
				if (followError) throw followError;

				const followingIdSet = new Set(
					(followRows ?? [])
						.map((row) => row?.following_id)
						.filter((fid) => fid !== null && fid !== undefined)
						.map((fid) => String(fid))
				);

				// Single paginated query path:
				// fetch the requested page directly with DB-side exclusion filters.
				const excludedAuthorIds = Array.from(
					new Set(
						[String(id), ...followingIdSet]
							.map((value) => Number(value))
							.filter((value) => Number.isFinite(value) && value > 0)
					)
				);
				let query = serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images!inner(filename, file_path, user_id, unavailable_at, meta, title)"
					)
					.not("prsn_created_images.user_id", "is", null)
					.is("prsn_created_images.unavailable_at", null)
					.order("created_at", { ascending: false })
					.range(off, off + lim - 1);
				if (excludedAuthorIds.length > 0) {
					query = query.not("prsn_created_images.user_id", "in", `(${excludedAuthorIds.join(",")})`);
				}

				const { data, error } = await query;
				if (error) throw error;

				const page = (Array.isArray(data) ? data : [])
					.map((row) => {
						const { prsn_created_images, ...rest } = row;
						const filename = prsn_created_images?.filename ?? null;
						const file_path = prsn_created_images?.file_path ?? null;
						const user_id = prsn_created_images?.user_id ?? null;
						const meta = prsn_created_images?.meta ?? null;
						const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
						const resolvedUrl = file_path || (filename ? `/api/images/created/${filename}` : null);
						const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
						return {
							...rest,
							title,
							filename,
							user_id,
							meta,
							nsfw,
							url: resolvedUrl,
							thumbnail_url: getThumbnailUrl(resolvedUrl),
							like_count: 0,
							comment_count: 0,
							viewer_liked: false
						};
					})
					.filter((item) => item?.user_id != null && typeof item?.url === "string" && item.url.length > 0);
				const createdImageIds = page
					.map((item) => item.created_image_id)
					.filter((cid) => cid !== null && cid !== undefined);

				if (createdImageIds.length === 0) return page;

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

				let likedIdSet = null;
				if (id !== null && id !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", id)
						.in("created_image_id", createdImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				const authorIds = [...new Set(
					page
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

				return page.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (countById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
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
			};

			return {
				all: exploreAll,
				paginated: explorePaginated
			};
		})(),
selectFeedBetaSitewideCatalog: createSelectFeedBetaSitewideCatalog(serviceClient, {
			prefixedTable,
			resolveFeedRowTitle,
			getThumbnailUrl
		}),
selectNewbieFeedItems: {
			all: async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return [];
				}

				const { data, error } = await serviceClient
					.from(prefixedTable("feed_items"))
					.select(
						"id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id, meta, title)"
					)
					.order("created_at", { ascending: false });
				if (error) throw error;

				const items = (data ?? []).map((item) => {
					const { prsn_created_images, ...rest } = item;
					const filename = prsn_created_images?.filename ?? null;
					const file_path = prsn_created_images?.file_path ?? null;
					const user_id = prsn_created_images?.user_id ?? null;
					const meta = prsn_created_images?.meta;
					const nsfw = !!(meta && typeof meta === "object" && meta.nsfw);
					const title = resolveFeedRowTitle(prsn_created_images?.title, rest.title);
					return {
						...rest,
						title,
						filename,
						user_id,
						nsfw,
						url: file_path || (filename ? `/api/images/created/${filename}` : null),
						like_count: 0,
						comment_count: 0,
						viewer_liked: false
					};
				});

				const viewerIdStr = String(id);
				const filtered = items.filter((item) => {
					if (item.user_id === null || item.user_id === undefined) return false;
					if (String(item.user_id) === viewerIdStr) return false;
					return true;
				});

				const createdImageIds = filtered
					.map((item) => item.created_image_id)
					.filter((createdImageId) => createdImageId !== null && createdImageId !== undefined);

				if (createdImageIds.length === 0) return [];

				const { data: countRows, error: countError } = await serviceClient
					.from(prefixedTable("created_image_like_counts"))
					.select("created_image_id, like_count")
					.in("created_image_id", createdImageIds);
				if (countError) throw countError;

				const likeById = new Map(
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

				const withEngagement = filtered.filter((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					if (!key) return false;
					const likes = likeById.get(key) ?? 0;
					const comments = commentCountById.get(key) ?? 0;
					return likes > 0 || comments > 0;
				});

				if (withEngagement.length === 0) return [];

				const finalImageIds = withEngagement.map((item) => item.created_image_id).filter(Boolean);

				let likedIdSet = null;
				if (id !== null && id !== undefined) {
					const { data: likedRows, error: likedError } = await serviceClient
						.from(prefixedTable("likes_created_image"))
						.select("created_image_id")
						.eq("user_id", id)
						.in("created_image_id", finalImageIds);
					if (likedError) throw likedError;
					likedIdSet = new Set((likedRows ?? []).map((row) => String(row.created_image_id)));
				}

				const authorIds = Array.from(new Set(
					withEngagement
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

				return withEngagement.map((item) => {
					const key = item.created_image_id != null ? String(item.created_image_id) : null;
					const likeCount = key ? (likeById.get(key) ?? 0) : 0;
					const commentCount = key ? (commentCountById.get(key) ?? 0) : 0;
					const viewerLiked = key && likedIdSet ? likedIdSet.has(key) : false;
					const profile = item.user_id != null ? profileByUserId.get(String(item.user_id)) ?? null : null;
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
selectPublishedBlogPostsForFeed: {
			all: async (limit = 30) => {
				const lim = Math.min(Math.max(1, Number(limit) || 30), 100);
				const { data, error } = await serviceClient
					.from(prefixedTable("blog_posts"))
					.select(
						"id, slug, title, description, body_md, status, published_at, author_user_id, updated_by_user_id, meta, created_at, updated_at"
					)
					.eq("status", "published")
					.order("published_at", { ascending: false })
					.limit(lim);
				if (error) throw error;
				return data ?? [];
			}
		}
}; }
