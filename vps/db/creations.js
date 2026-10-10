import {creationEligibleForLatestCommentsStream} from '../services/create/latestCommentsVisibility.js';
import { commentAllowsUnpublishedCreation } from '../services/create/postedCreationAccess.js';
import {getActiveEditorialPins} from '../services/feed/editorialPin.js';
import path from "node:path";

const IMAGE_BUCKET = "prsn_created-images";
const THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";
const CREATION_FIELDS = "id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at";

// Keep the VPS image-list boundary self-contained. The deployment image contains
// only vps/, so it must not import from the legacy WWW/API tree.
function isHiddenInGroupMeta(meta) {
	if (!meta || typeof meta !== "object") return false;
	return [meta.hidden_in_group, meta.hidden_in_project].some((value) => {
		const id = Number(value);
		return Number.isFinite(id) && id > 0;
	});
}

function safeKey(value) {
	const key = String(value || "").trim();
	if (!key || key.length > 1024 || key.startsWith("/") || key.includes("..") || key.includes("\\") || /[\0-\x1f\x7f]/.test(key)) return null;
	if (key.split("/").some((part) => !part || part === ".")) return null;
	return key;
}

function storageObjectUrl(supabaseUrl, bucket, key) {
	const encoded = [bucket, ...key.split("/")].map(encodeURIComponent).join("/");
	return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encoded}`;
}

function fitKey(key) {
	const ext = path.extname(key);
	return ext ? `${key.slice(0, -ext.length)}_fit.jpg` : `${key}_fit.jpg`;
}

function pageQuery(client, userId, limit, offset, challengeOnly, viewerEnableNsfw) {
	let query = client
		.from("prsn_created_images")
		.select(CREATION_FIELDS)
		.eq("user_id", userId)
		.is("unavailable_at", null)
		.is("meta->>hidden_in_group", null)
		.is("meta->>hidden_in_project", null)
		.order("created_at", { ascending: false });
	if (challengeOnly) query = query.not("meta->>challenge_submissions", "is", null).neq("meta->>challenge_submissions", "[]");
	if (!viewerEnableNsfw) query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
	return query.range(offset, offset + limit);
}

function positiveIds(values, cap = 100) {
	return [...new Set((Array.isArray(values) ? values : [])
		.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, cap);
}

function parseMeta(value) {
	if (value && typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value === "string") {
		try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
		catch { return {}; }
	}
	return {};
}

function lineageIds(meta) {
	const parsed = typeof meta === "string" ? (() => { try { return JSON.parse(meta); } catch { return {}; } })() : meta;
	return new Set(positiveIds([
		...(Array.isArray(parsed?.history) ? parsed.history : []),
		...(Array.isArray(parsed?.direct_parent_ids) ? parsed.direct_parent_ids : [])
	], 500));
}

function whoLabel(profile) {
	const value = String(profile?.user_name || profile?.display_name || "").trim();
	return value ? `@${value}` : "";
}

export function createCreationsStore({ client, supabaseUrl, serviceRoleKey }) {
	return {
		async list(userId, { limit = 50, offset = 0, challengeOnly = false, viewerEnableNsfw = false } = {}) {
			const { data, error } = await pageQuery(client, userId, limit, offset, challengeOnly, viewerEnableNsfw);
			if (error) throw error;
			const rows = (Array.isArray(data) ? data : []).filter((row) => !isHiddenInGroupMeta(row?.meta));
			return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
		},
		async listByIds(userId, ids) {
			const safeIds = positiveIds(ids);
			if (!safeIds.length) return [];
			let query = client
				.from("prsn_created_images")
				.select(CREATION_FIELDS)
				.eq("user_id", userId)
				.is("unavailable_at", null)
				.in("id", safeIds);
			const { data, error } = await query;
			if (error) throw error;
			return (Array.isArray(data) ? data : []).filter((row) => !isHiddenInGroupMeta(row?.meta));
		},
		async byIdForCommentProof(viewerId, creationId, commentId) {
			const id = Number(creationId);
			const cid = Number(commentId);
			const uid = Number(viewerId);
			if (![id, cid, uid].every((value) => Number.isInteger(value) && value > 0)) return null;
			const imageResult = await client.from("prsn_created_images").select(CREATION_FIELDS).eq("id", id).maybeSingle();
			if (imageResult.error) throw imageResult.error;
			const image = imageResult.data;
			if (!image) return null;
			const commentResult = await client.from("prsn_comments_created_image").select("id, created_image_id, text").eq("id", cid).maybeSingle();
			if (commentResult.error) throw commentResult.error;
			const comment = commentResult.data;
			if (!comment) return null;
			let parent = null;
			if (Number(comment.created_image_id) !== id) {
				const parentResult = await client.from("prsn_created_images").select("id, user_id, published, unavailable_at").eq("id", comment.created_image_id).maybeSingle();
				if (parentResult.error) throw parentResult.error;
				parent = parentResult.data;
			}
			return commentAllowsUnpublishedCreation({ image, comment, parent, viewerId: uid }) ? image : null;
		},
		// Only call after verifying a share token for this exact creation.
		async byIdForShare(creationId) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return null;
			const { data, error } = await client.from("prsn_created_images").select(CREATION_FIELDS).eq("id", id).maybeSingle();
			if (error) throw error;
			if (!data || (data.status || "completed") !== "completed" || (data.unavailable_at != null && data.unavailable_at !== "")) return null;
			return data;
		},
		async byIdForViewer(userId, creationId, { isAdmin = false } = {}) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return null;
			const { data, error } = await client
				.from("prsn_created_images")
				.select(CREATION_FIELDS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw error;
			if (!data) return null;
			const owner = Number(data.user_id) === Number(userId);
			const published = data.published === true || data.published === 1;
			const unavailable = data.unavailable_at != null && data.unavailable_at !== "";
			let discussable=published;if(!owner&&!published&&!isAdmin&&!unavailable){let activeEditorialPinCreationIds=new Set();if(!creationEligibleForLatestCommentsStream(data)){const pins=await getActiveEditorialPins({selectPolicyByKey:{get:async key=>{const {data,error}=await client.from('prsn_policies').select('value').eq('key',key).maybeSingle();if(error)throw error;return data;}}});activeEditorialPinCreationIds=new Set(pins.map(pin=>Number(pin.created_image_id)).filter(Number.isFinite));}discussable=creationEligibleForLatestCommentsStream(data,{activeEditorialPinCreationIds});}
if ((!owner && !discussable && !isAdmin) || (unavailable && !isAdmin)) return null;
			return data;
		},
		async lineageAncestorForViewer(userId, creationId, parentId, { isAdmin = false } = {}) {
			const id = Number(creationId);
			const lineageParentId = Number(parentId);
			if (![id, lineageParentId].every((value) => Number.isInteger(value) && value > 0)) return null;
			const parent = await this.byIdForViewer(userId, lineageParentId, { isAdmin });
			if (!parent || !lineageIds(parent.meta).has(id)) return null;
			const { data, error } = await client
				.from("prsn_created_images")
				.select(CREATION_FIELDS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw error;
			return data || null;
		},
		async nsfwFlags(ids) {
			const safeIds = positiveIds(ids);
			if (!safeIds.length) return {};
			const { data, error } = await client.from("prsn_created_images").select("id, meta").in("id", safeIds);
			if (error) throw error;
			return Object.fromEntries((data || []).map((row) => [String(row.id), Boolean(row?.meta?.nsfw)]));
		},
		async likeMeta(userId, creationId) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return { like_count: 0, viewer_liked: false, liked_by: [] };
			const [countResult, likesResult, viewerResult] = await Promise.all([
				client.from("prsn_created_image_like_counts").select("created_image_id, like_count").eq("created_image_id", id).maybeSingle(),
				client.from("prsn_likes_created_image").select("user_id, created_at").eq("created_image_id", id).order("created_at", { ascending: false }).limit(400),
				client.from("prsn_likes_created_image").select("id").eq("created_image_id", id).eq("user_id", userId).maybeSingle()
			]);
			if (countResult.error) throw countResult.error;
			if (likesResult.error) throw likesResult.error;
			if (viewerResult.error) throw viewerResult.error;
			const likes = likesResult.data || [];
			const likeCount = Math.max(0, Number(countResult.data?.like_count) || 0);
			const userIds = positiveIds((likes || []).map((row) => row.user_id), 400);
			let profiles = [];
			if (userIds.length) {
				const result = await client.from("prsn_user_profiles").select("user_id, user_name, display_name").in("user_id", userIds);
				if (result.error) throw result.error;
				profiles = result.data || [];
			}
			const byUser = new Map(profiles.map((profile) => [Number(profile.user_id), profile]));
			const labels = (likes || []).map((row) => whoLabel(byUser.get(Number(row.user_id)))).filter(Boolean);
			const visible = labels.slice(0, 5);
			const others = Math.max(0, likeCount - visible.length);
			return { like_count: likeCount, viewer_liked: Boolean(viewerResult.data), liked_by: others ? [...visible, others] : visible };
		},
		async setLiked(userId, creationId, liked) {
			const values = { user_id: Number(userId), created_image_id: Number(creationId) };
			const result = liked
				? await client.from("prsn_likes_created_image").upsert(values, { onConflict: "user_id,created_image_id", ignoreDuplicates: true })
				: await client.from("prsn_likes_created_image").delete().eq("user_id", values.user_id).eq("created_image_id", values.created_image_id);
			if (result.error) throw result.error;
			return this.likeMeta(userId, creationId);
		},
		async comments(creationId, { order = "asc", limit = 50, offset = 0, viewerId = null } = {}) {
			const ascending = order !== "desc";
			const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
			const safeOffset = Math.max(0, Number(offset) || 0);
			const { data, error, count } = await client
				.from("prsn_comments_created_image")
				.select("id, user_id, created_image_id, text, created_at, updated_at, meta", { count: "exact" })
				.eq("created_image_id", Number(creationId))
				.order("created_at", { ascending })
				.range(safeOffset, safeOffset + safeLimit - 1);
			if (error) throw error;
			const comments = data || [];
			return { commentCount: Number(count) || 0, rows: await enrichCreationComments(client, comments, viewerId) };
		},
		async tips(creationId, { order = "asc", limit = 50, offset = 0 } = {}) {
			const ascending = order !== "desc";
			const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
			const safeOffset = Math.max(0, Number(offset) || 0);
			const { data, error } = await client
				.from("prsn_tip_activity")
				.select("id, from_user_id, created_image_id, amount, message, source, meta, created_at, updated_at")
				.eq("created_image_id", Number(creationId))
				.order("created_at", { ascending })
				.range(safeOffset, safeOffset + safeLimit - 1);
			if (error) throw error;
			const tips = data || [];
			const userIds = positiveIds(tips.map((row) => row.from_user_id), 400);
			let profiles = [];
			let users = [];
			if (userIds.length) {
				const [profilesResult, usersResult] = await Promise.all([
					client.from("prsn_user_profiles").select("user_id, user_name, display_name, avatar_url").in("user_id", userIds),
					client.from("prsn_users").select("id, meta").in("id", userIds)
				]);
				if (profilesResult.error) throw profilesResult.error;
				if (usersResult.error) throw usersResult.error;
				profiles = profilesResult.data || [];
				users = usersResult.data || [];
			}
			const profileByUser = new Map(profiles.map((row) => [Number(row.user_id), row]));
			const planByUser = new Map(users.map((row) => [Number(row.id), row?.meta?.plan === "founder" ? "founder" : "free"]));
			return tips.map((row) => {
				const profile = profileByUser.get(Number(row.from_user_id));
				return {
					id: row.id,
					user_id: row.from_user_id,
					created_image_id: row.created_image_id,
					amount: row.amount,
					message: row.message,
					source: row.source,
					meta: row.meta,
					created_at: row.created_at,
					updated_at: row.updated_at,
					user_name: profile?.user_name ?? null,
					display_name: profile?.display_name ?? null,
					avatar_url: profile?.avatar_url ?? null,
					plan: planByUser.get(Number(row.from_user_id)) || "free"
				};
			});
		},
		async related(creationId, { limit = 10, excludeIds = [], viewerEnableNsfw = false, seenCount = 0, forceRandom = false } = {}) {
			const seedId = Number(creationId);
			const safeLimit = Math.min(40, Math.max(1, Number(limit) || 10));
			const excluded = new Set(positiveIds([seedId, ...excludeIds], 201));
			const { data: seed, error: seedError } = await client.from("prsn_created_images")
				.select("id,user_id,created_at,published,meta,title")
				.eq("id", seedId).eq("published", true).is("unavailable_at", null).maybeSingle();
			if (seedError) throw seedError;
			if (!seed) return { rows: [], hasMore: false };
			const seedMeta = parseMeta(seed.meta);

			const knobRows = await client.from("prsn_policy_knobs").select("key,value").like("key", "related.%");
			if (knobRows.error) throw knobRows.error;
			const knobs = Object.fromEntries((knobRows.data || []).map((row) => [row.key, row.value]));
			const knob = (name, fallback) => {
				const value = Number(knobs[`related.${name}`]);
				return Number.isFinite(value) ? value : fallback;
			};
			const maxCandidates = Math.max(20, Math.min(500, knob("candidate_cap_per_signal", 100)));
			const poolById = new Map();
			const addCandidates = (rows) => {
				for (const row of rows || []) {
					const id = Number(row?.id);
					if (!Number.isInteger(id) || id <= 0 || excluded.has(id) || isHiddenInGroupMeta(row.meta)) continue;
					if (!viewerEnableNsfw && row.meta?.nsfw === true) continue;
					poolById.set(id, row);
				}
			};
			const selectCandidates = () => {
				let query = client.from("prsn_created_images").select(CREATION_FIELDS)
					.eq("published", true).is("unavailable_at", null)
					.is("meta->>hidden_in_group", null).is("meta->>hidden_in_project", null)
					.order("published_at", { ascending: false }).limit(maxCandidates);
				if (!viewerEnableNsfw) query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
				return query;
			};
			const candidatesResult = await selectCandidates();
			if (candidatesResult.error) throw candidatesResult.error;
			addCandidates(candidatesResult.data);
			const candidateFields = "id,user_id,filename,file_path,width,height,color,status,created_at,published,published_at,title,description,meta,unavailable_at";
			const addCandidateQuery = async (query) => {
				const result = await query;
				if (result.error) throw result.error;
				addCandidates(result.data);
			};
			const lineageQuery = client.from("prsn_created_images").select(candidateFields)
				.eq("published", true).is("unavailable_at", null).or(`meta->>mutate_of_id.eq.${seedId}`).limit(maxCandidates);
			await addCandidateQuery(lineageQuery);
			const parentId = Number(seedMeta.mutate_of_id);
			if (Number.isInteger(parentId) && parentId > 0 && !excluded.has(parentId)) {
				await addCandidateQuery(client.from("prsn_created_images").select(candidateFields)
					.eq("id", parentId).eq("published", true).is("unavailable_at", null).limit(1));
			}
			const serverId = seedMeta.server_id;
			const method = seedMeta.method;
			if (serverId != null && method != null) {
				await addCandidateQuery(client.from("prsn_created_images").select(candidateFields)
					.eq("published", true).is("unavailable_at", null)
					.or(`and(meta->>server_id.eq.${serverId},meta->>method.eq.${method})`).limit(maxCandidates));
			}
			if (seed.user_id != null) {
				await addCandidateQuery(client.from("prsn_created_images").select(candidateFields)
					.eq("published", true).is("unavailable_at", null).eq("user_id", seed.user_id).limit(maxCandidates));
			}

			const transitionResult = await client.from("prsn_related_transitions")
				.select("to_created_image_id,count,last_updated")
				.eq("from_created_image_id", seedId)
				.order("last_updated", { ascending: false })
				.limit(Math.max(1, Math.min(500, knob("transition_cap_k", 50))));
			if (transitionResult.error) throw transitionResult.error;
			const transitions = transitionResult.data || [];
			const transitionIds = positiveIds(transitions.map((row) => row.to_created_image_id), 500).filter((id) => !excluded.has(id));
			const fetchByIds = async (ids) => {
				if (!ids.length) return;
				let query = client.from("prsn_created_images").select(CREATION_FIELDS)
					.in("id", ids).eq("published", true).is("unavailable_at", null)
					.is("meta->>hidden_in_group", null).is("meta->>hidden_in_project", null);
				if (!viewerEnableNsfw) query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
				const result = await query;
				if (result.error) throw result.error;
				addCandidates(result.data);
			};
			await fetchByIds(transitionIds);

			let semanticById = new Map();
			let semanticPageFull = false;
			const semanticWeight = Math.max(0, knob("semantic_weight", 50));
			const semanticWeightNoClick = Math.max(0, Math.min(100, knob("semantic_weight_no_click_next", 95)));
			const semanticMaxDistance = Math.max(0, Math.min(2, knob("semantic_distance_max", 0.8)));
			const embeddingResult = await client.from("prsn_created_embeddings").select("embedding_multi")
				.eq("created_image_id", seedId).maybeSingle();
			if (!embeddingResult.error && embeddingResult.data?.embedding_multi) {
				const nearestResult = await client.rpc("prsn_created_embeddings_nearest", {
					target_embedding: embeddingResult.data.embedding_multi,
					exclude_id: seedId,
					lim: Math.min(100, Math.max(safeLimit * 2, safeLimit + 50)),
					off: Math.min(Math.max(0, excludeIds.length - 1), 500),
				});
				if (!nearestResult.error && Array.isArray(nearestResult.data)) {
					semanticPageFull = nearestResult.data.length >= Math.min(100, Math.max(safeLimit * 2, safeLimit + 50));
					semanticById = new Map(nearestResult.data
						.map((row) => [Number(row.created_image_id), Number(row.distance)])
						.filter(([id, distance]) => Number.isInteger(id) && !excluded.has(id) && Number.isFinite(distance) && distance <= semanticMaxDistance));
					await fetchByIds([...semanticById.keys()]);
				}
			}

			const randomOnly = forceRandom || Number(seenCount) >= 120;
			if (randomOnly) {
			let countQuery = client.from("prsn_created_images").select("id", { count: "exact", head: true }).eq("published", true).is("unavailable_at", null);
			if (!viewerEnableNsfw) countQuery = countQuery.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
			const countResult = await countQuery.neq("id", seedId);
			if (countResult.error) throw countResult.error;
			const total = Math.max(0, Number(countResult.count) || 0);
			if (!total) return { rows: [], hasMore: false };
			const windowSize = Math.max(safeLimit * 8, safeLimit + 1);
			const maxStart = Math.max(0, total - windowSize);
			const start = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0;
			let randomQuery = client.from("prsn_created_images").select(CREATION_FIELDS)
				.eq("published", true).is("unavailable_at", null)
				.is("meta->>hidden_in_group", null).is("meta->>hidden_in_project", null)
				.order("created_at", { ascending: false }).range(start, Math.min(total - 1, start + windowSize - 1)).neq("id", seedId);
			if (!viewerEnableNsfw) randomQuery = randomQuery.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
			const randomResult = await randomQuery;
			if (randomResult.error) throw randomResult.error;
			const randomRows = (randomResult.data || []).filter((row) => !isHiddenInGroupMeta(row.meta));
			for (let i = randomRows.length - 1; i > 0; i -= 1) {
				const j = Math.floor(Math.random() * (i + 1));
				[randomRows[i], randomRows[j]] = [randomRows[j], randomRows[i]];
			}
			return { rows: randomRows.slice(0, safeLimit), hasMore: total > safeLimit };
			}

			const createdAt = (row) => new Date(row?.created_at || 0).getTime();
			const clickCounts = new Map();
			for (const transition of transitions) {
				const id = Number(transition.to_created_image_id);
				if (!poolById.has(id)) continue;
				const ageDays = Math.max(0, (Date.now() - new Date(transition.last_updated || 0).getTime()) / 86400000);
				const halfLife = knob("transition_decay_half_life_days", 7);
				const decay = halfLife > 0 ? Math.pow(0.5, ageDays / halfLife) : 1;
				const windowDays = knob("transition_window_days", 0);
				if (windowDays > 0 && ageDays > windowDays) continue;
				clickCounts.set(id, (clickCounts.get(id) || 0) + Number(transition.count || 0) * decay);
			}
			const maxClick = Math.max(0, ...clickCounts.values());
			const hasClickNext = transitions.length > 0;
			const recsysWeight = hasClickNext ? knob("recsys_weight", 50) : 100 - semanticWeightNoClick;
			const effectiveSemanticWeight = hasClickNext ? semanticWeight : semanticWeightNoClick;
			const fallbackWeight = knob("fallback_weight", 20);
			const fallbackCandidates = [...poolById.values()].filter((row) => Math.abs((Date.now() - createdAt(row)) / 86400000) <= 7);
			const fallbackPool = fallbackCandidates.length ? fallbackCandidates : [...poolById.values()];
			const recsysRows = [...poolById.values()].map((row) => {
				const id = Number(row.id);
				const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
				const lineage = Number(meta.mutate_of_id) === seedId || Number(seedMeta.mutate_of_id) === id;
				const sameCreator = Number(row.user_id) === Number(seed.user_id);
				const sameServerMethod = seedMeta.server_id != null && seedMeta.method != null &&
					String(meta.server_id) === String(seedMeta.server_id) && String(meta.method) === String(seedMeta.method);
				const clickScore = clickCounts.get(id) || 0;
				const clickShare = maxClick > 0 ? clickScore / maxClick : 0;
				let recsysScore = (lineage ? knob("lineage_weight", 100) : 0) +
					(sameCreator ? knob("same_creator_weight", 50) : 0) +
					(sameServerMethod ? knob("same_server_method_weight", 80) : 0) +
					(clickShare * 50);
				const fallback = fallbackPool.some((candidate) => Number(candidate.id) === id);
				if (fallback) recsysScore += fallbackWeight * 0.1;
				const reasons = [lineage && "lineage", clickScore > 0 && "clickNext", sameCreator && "sameCreator", sameServerMethod && "sameServerMethod", fallback && "fallback"].filter(Boolean);
				return { row, recsysScore, lineage, clickScore, reasons };
			});
			const recsysMax = Math.max(1, ...recsysRows.map((entry) => entry.recsysScore));
			const ranked = recsysRows.map((entry) => {
				const distance = semanticById.get(Number(entry.row.id));
				const semanticScore = distance == null ? 0 : 1 / (1 + Math.max(0, distance));
				const recsysNorm = entry.recsysScore / recsysMax;
				const score = (recsysWeight * recsysNorm + effectiveSemanticWeight * semanticScore) / Math.max(1, recsysWeight + effectiveSemanticWeight);
				return { ...entry, score, semanticScore, reasons: distance == null ? entry.reasons : [...entry.reasons, "semanticSimilar"] };
			});
		const reasonTier = (entry) => entry.reasons.includes("clickNext") ? 0 : entry.reasons.includes("lineage") ? 1 : entry.reasons.some((reason) => ["sameCreator", "sameServerMethod", "fallback"].includes(reason)) ? 2 : 4;
		ranked.sort((a, b) => reasonTier(a) - reasonTier(b) || (reasonTier(a) === 0 ? b.clickScore - a.clickScore : 0) || b.score - a.score || createdAt(b.row) - createdAt(a.row));
			const lineageMin = Math.max(0, Math.min(safeLimit, knob("lineage_min_slots", 2)));
			const lineageRows = ranked.filter((entry) => entry.lineage).slice(0, lineageMin);
			const randomSlots = Math.max(0, Math.min(safeLimit, knob("random_slots_per_batch", 0)));
			const deterministicSize = safeLimit - randomSlots;
			const clickRanked = ranked.filter((entry) => entry.reasons.includes("clickNext")).sort((a, b) => b.clickScore - a.clickScore || b.score - a.score);
			const deterministic = clickRanked.slice(0, deterministicSize);
			const deterministicIds = new Set(deterministic.map((entry) => Number(entry.row.id)));
			const familyTarget = Math.min(deterministicSize, lineageMin);
			let familyCount = deterministic.filter((entry) => entry.lineage).length;
			for (const entry of lineageRows) {
				if (deterministic.length >= deterministicSize || familyCount >= familyTarget) break;
				const id = Number(entry.row.id);
				if (deterministicIds.has(id)) continue;
				deterministic.push(entry);
				deterministicIds.add(id);
				familyCount += 1;
			}
			for (const entry of ranked) {
				if (deterministic.length >= deterministicSize) break;
				const id = Number(entry.row.id);
				if (deterministicIds.has(id)) continue;
				deterministic.push(entry);
				deterministicIds.add(id);
			}
			const exploration = fallbackPool.filter((row) => !deterministicIds.has(Number(row.id)));
			for (let i = exploration.length - 1; i > 0; i -= 1) {
				const j = Math.floor(Math.random() * (i + 1));
				[exploration[i], exploration[j]] = [exploration[j], exploration[i]];
			}
			const exploreEntries = exploration.slice(0, randomSlots).map((row) => ({ row, score: 0, lineage: false, clickScore: 0, reasons: ["exploreRandom"] }));
			let selected = [...deterministic, ...exploreEntries];
			const coldConfidence = Math.min(1, clickCounts.size / 3) * 0.5 +
				Math.min(1, lineageRows.length / 3) * 0.2 +
				Math.min(1, ranked.filter((entry) => entry.reasons.includes("sameCreator")).length / 5) * 0.15 +
				Math.min(1, ranked.filter((entry) => entry.reasons.includes("sameServerMethod")).length / 5) * 0.15;
			if (coldConfidence < 0.35) {
				const guessSlots = Math.max(0, Math.min(safeLimit, 2));
				const exploreSlots = Math.max(0, Math.min(safeLimit - guessSlots, Math.floor(safeLimit * 0.7)));
				const guesses = ranked.slice(0, guessSlots);
				const guessedIds = new Set(guesses.map((entry) => Number(entry.row.id)));
				const coldExplore = fallbackPool.filter((row) => !guessedIds.has(Number(row.id)));
				for (let i = coldExplore.length - 1; i > 0; i -= 1) {
					const j = Math.floor(Math.random() * (i + 1));
					[coldExplore[i], coldExplore[j]] = [coldExplore[j], coldExplore[i]];
				}
				const explored = coldExplore.slice(0, exploreSlots).map((row) => ({ row, score: 0, lineage: false, clickScore: 0, reasons: ["exploreRandom"] }));
				const fill = ranked.filter((entry) => !guessedIds.has(Number(entry.row.id))).slice(0, Math.max(0, safeLimit - guesses.length - explored.length));
				selected = [...guesses, ...explored, ...fill];
			}
			const tier = (entry) => entry.reasons.includes("clickNext") ? 0 : entry.reasons.includes("lineage") ? 1 : entry.reasons.some((reason) => ["sameCreator", "sameServerMethod", "fallback"].includes(reason)) ? 2 : entry.reasons.includes("exploreRandom") ? 3 : 4;
			selected.sort((a, b) => tier(a) - tier(b) || (tier(a) === 0 ? b.clickScore - a.clickScore : 0) || b.score - a.score);
			const selectedIds = selected.map((entry) => Number(entry.row.id));
			const reasonById = new Map(selected.map((entry) => [Number(entry.row.id), entry.reasons]));
			const { data: finalRows, error: finalError } = await client.from("prsn_created_images")
				.select(CREATION_FIELDS).in("id", selectedIds).eq("published", true).is("unavailable_at", null);
			if (finalError) throw finalError;
			const byId = new Map((finalRows || []).filter((row) => !isHiddenInGroupMeta(row.meta) && (viewerEnableNsfw || row.meta?.nsfw !== true)).map((row) => [Number(row.id), row]));
			return { rows: selectedIds.map((id) => byId.get(id)).filter(Boolean).map((row) => ({ ...row, related_reasons: reasonById.get(Number(row.id)) || [] })), hasMore: ranked.length > safeLimit || semanticPageFull };
		},
		async owns(userId, creationId) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return false;
			const { data, error } = await client
				.from("prsn_created_images")
				.select("id")
				.eq("id", id)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return Boolean(data);
		},
		async ownsMedia(userId, creationId, key) {
			const id = Number(creationId);
			const safe = safeKey(key);
			if (!Number.isInteger(id) || id <= 0 || !safe) return false;
			const { data, error } = await client
				.from("prsn_created_images")
				.select("filename, file_path, meta")
				.eq("id", id)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			if (!data) return false;
			return creationMediaKeys(data).some((value) => safe === safeKey(value));
		},
		async canAccessMedia(userId, creationId, key, { isAdmin = false } = {}) {
			const id = Number(creationId);
			const safe = safeKey(key);
			if (!Number.isInteger(id) || id <= 0 || !safe) return false;
			const row = await this.byIdForViewer(userId, id, { isAdmin });
			return Boolean(row && creationMediaKeys(row).some((value) => safe === safeKey(value)));
		},

		async signedPlaybackUrl(filename, expiresIn = 6 * 60 * 60) {
			const key = safeKey(filename);
			if (!key || typeof client?.storage?.from !== "function") return null;
			try {
				const { data, error } = await client.storage.from(IMAGE_BUCKET).createSignedUrl(key, expiresIn);
				const url = typeof data?.signedUrl === "string" ? data.signedUrl : "";
				if (error || !url) return null;
				const target = new URL(url);
				const origin = new URL(supabaseUrl);
				if (target.protocol !== origin.protocol || target.host !== origin.host) return null;
				return target.toString();
			} catch {
				return null;
			}
		},
		async fetchMedia(filename, { variant = "", method = "GET", range, signal } = {}) {
			const key = safeKey(filename);
			if (!key) return new Response(null, { status: 404 });
			const normalizedVariant = String(variant || "").trim().toLowerCase();
			const bucket = normalizedVariant === "thumbnail" || normalizedVariant === "fit" ? THUMBNAIL_BUCKET : IMAGE_BUCKET;
			const objectKey = normalizedVariant === "fit" ? fitKey(key) : key;
			const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
			if (range) headers.Range = range;
			let response = await fetch(storageObjectUrl(supabaseUrl, bucket, objectKey), { method, headers, signal, redirect: "manual" });
			if (!response.ok && normalizedVariant === "fit") {
				response = await fetch(storageObjectUrl(supabaseUrl, THUMBNAIL_BUCKET, key), { method, headers, signal, redirect: "manual" });
			}
			// WWW treats derivative thumbnails as optional. A missing derivative must not
			// turn a valid creation into a blank tile, especially for older media.
			if (!response.ok && (normalizedVariant === "thumbnail" || normalizedVariant === "fit")) {
				response = await fetch(storageObjectUrl(supabaseUrl, IMAGE_BUCKET, key), { method, headers, signal, redirect: "manual" });
			}
			return response;
		},
		async mintAudioPlaybackUrl(objectId, window = {}) {
			if (!/^o_[a-f0-9]{24}$/.test(String(objectId || ""))) throw new Error("Invalid audio object");
			const { data: server, error } = await client
				.from("prsn_servers")
				.select("server_url, auth_token, server_config")
				.eq("id", 6)
				.maybeSingle();
			if (error) throw error;
			let origin = "";
			try { origin = new URL(server?.server_url).origin; } catch { /* missing or invalid host */ }
			if (!origin) throw new Error("Audio host is not configured");
			const headers = { Accept: "application/json", "Content-Type": "application/json" };
			const extraHeaders = server?.server_config?.custom_headers;
			if (extraHeaders && typeof extraHeaders === "object") {
				for (const [key, value] of Object.entries(extraHeaders)) if (value != null) headers[key] = String(value);
			}
			if (typeof server.auth_token === "string" && server.auth_token.trim()) headers.Authorization = `Bearer ${server.auth_token.trim()}`;
			const response = await fetch(`${origin}/cdn/objects/${encodeURIComponent(objectId)}/links`, {
				method: "POST", headers, body: JSON.stringify(window), signal: AbortSignal.timeout(20_000)
			});
			if (!response.ok) throw new Error(`Audio host returned ${response.status}`);
			const payload = await response.json();
			const url = typeof payload?.url === "string" ? payload.url.trim() : "";
			if (!url) throw new Error("Audio host returned no playback URL");
			return url;
		},
		safeKey
	};
}

export function creationMediaKey(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	if (!meta || typeof meta !== "object") meta = null;
	const group = meta?.group && typeof meta.group === "object" ? meta.group : null;
	if (group?.kind === "group_v2") {
		const cover = (Array.isArray(group.items) ? group.items : []).find((item) => item?.cover) || group.items?.[0];
		const view = cover?.view && typeof cover.view === "object" ? cover.view : null;
		const coverPath = view?.filePath || view?.file_path || view?.url || view?.filename;
		if (coverPath) return creationMediaKey({ file_path: coverPath, filename: view?.filename });
	}
	if (group?.kind === "group_creations") {
		const sources = Array.isArray(group.source_creations) ? group.source_creations : [];
		const coverId = Number(group.cover_source_id);
		const cover = sources.find((source) => Number(source?.id) === coverId) || sources[0];
		if (cover) return creationMediaKey(cover);
	}
	const filePath = String(row?.file_path || "").trim();
	for (const marker of ['/api/images/created/', '/api/videos/created/', '/api/creations/media/']) {
		const markerIndex = filePath.indexOf(marker);
		if (markerIndex >= 0) {
			const encoded = filePath.slice(markerIndex + marker.length).split("?", 1)[0];
			try { return decodeURIComponent(encoded); } catch { return encoded; }
		}
	}
	if (filePath && !filePath.startsWith("http://") && !filePath.startsWith("https://")) return filePath.replace(/^\/+/, "");
	return String(row?.filename || "").trim();
}

export function creationAudioCdnId(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	const cdnId = meta?.audio && typeof meta.audio === "object" ? String(meta.audio.cdn_id || "").trim() : "";
	return /^o_[a-f0-9]{24}$/.test(cdnId) ? cdnId : "";
}

function mediaKeyFromValue(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	for (const marker of ["/api/images/created/", "/api/videos/created/", "/api/creations/media/"]) {
		const markerIndex = raw.indexOf(marker);
		if (markerIndex < 0) continue;
		const encoded = raw.slice(markerIndex + marker.length).split("?", 1)[0];
		try { return decodeURIComponent(encoded); } catch { return encoded; }
	}
	if (raw.startsWith("http://") || raw.startsWith("https://")) return "";
	return raw.replace(/^\/+/, "");
}

export function creationVideoMediaKey(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	if (!meta || typeof meta !== "object") meta = null;
	const video = meta?.video && typeof meta.video === "object" ? meta.video : null;
	return mediaKeyFromValue(
		row?.video_url ||
		row?.video_path ||
		meta?.video_url ||
		video?.file_path ||
		video?.filePath ||
		video?.url
	);
}

export function creationMediaKeys(row) {
	const values = [creationMediaKey({ filename: row?.filename, file_path: row?.file_path }), creationVideoMediaKey(row)];
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	const audio = meta?.audio && typeof meta.audio === "object" ? meta.audio : {};
	for (const cover of [meta?.cover_url, meta?.cover_image_url, audio.cover_url, audio.cover_image_url, audio.thumbnail_url]) {
		const key = mediaKeyFromValue(cover);
		if (key) values.push(key);
	}
	const group = meta?.group && typeof meta.group === "object" ? meta.group : null;
	const sources = group?.kind === "group_creations"
		? group.source_creations
		: group?.kind === "group_v2"
			? (Array.isArray(group.items) ? group.items.map((item) => {
				const view = item?.view || {};
				return { ...view, file_path: view.filePath || view.file_path || view.url, video_url: view.videoUrl || view.video_url };
			}) : [])
			: [];
	for (const source of Array.isArray(sources) ? sources : []) {
		values.push(creationMediaKey(source), creationVideoMediaKey(source));
	}
	return [...new Set(values.filter(Boolean))];
}


export async function enrichCreationComments(client, comments, viewerId) {
			const commentIds = positiveIds(comments.map((row) => row.id), 200);
			let reactionRows = [];
			if (commentIds.length) {
				const result = await client.from("prsn_comment_reactions").select("comment_id, emoji_key, user_id").in("comment_id", commentIds);
				if (result.error) throw result.error;
				reactionRows = result.data || [];
			}
			const userIds = positiveIds([
				...comments.map((row) => row.user_id),
				...reactionRows.map((row) => row.user_id)
			], 400);
			let profiles = [];
			let users = [];
			if (userIds.length) {
				const [profilesResult, usersResult] = await Promise.all([
					client.from("prsn_user_profiles").select("user_id, user_name, display_name, avatar_url").in("user_id", userIds),
					client.from("prsn_users").select("id, meta").in("id", userIds)
				]);
				if (profilesResult.error) throw profilesResult.error;
				if (usersResult.error) throw usersResult.error;
				profiles = profilesResult.data || [];
				users = usersResult.data || [];
			}
			const profileByUser = new Map(profiles.map((row) => [Number(row.user_id), row]));
			const planByUser = new Map(users.map((row) => [Number(row.id), row?.meta?.plan === "founder" ? "founder" : "free"]));
			const reactionsByComment = new Map();
			for (const reaction of reactionRows) {
				const commentId = Number(reaction.comment_id);
				const emojiKey = String(reaction.emoji_key || "");
				if (!emojiKey) continue;
				if (!reactionsByComment.has(commentId)) reactionsByComment.set(commentId, { reactions: {}, viewer_reactions: [], counts: {} });
				const entry = reactionsByComment.get(commentId);
				if (!entry.reactions[emojiKey]) entry.reactions[emojiKey] = [];
				entry.counts[emojiKey] = (entry.counts[emojiKey] || 0) + 1;
				const label = whoLabel(profileByUser.get(Number(reaction.user_id)));
				if (label) entry.reactions[emojiKey].push(label);
				if (Number(reaction.user_id) === Number(viewerId)) entry.viewer_reactions.push(emojiKey);
			}
			for (const entry of reactionsByComment.values()) {
				entry.viewer_reactions = [...new Set(entry.viewer_reactions)];
				for (const [emojiKey, labels] of Object.entries(entry.reactions)) {
					const total = entry.counts[emojiKey] || 0;
					const visible = labels.slice(0, 5);
					entry.reactions[emojiKey] = total > visible.length ? [...visible, total - visible.length] : visible;
				}
				delete entry.counts;
			}
	const replyIds=positiveIds(comments.map(row=>parseMeta(row.meta)?.reply?.referenced_id),200);let existingReplies=new Set();if(replyIds.length){const {data,error}=await client.from('prsn_comments_created_image').select('id').in('id',replyIds);if(error)throw error;existingReplies=new Set((data||[]).map(row=>Number(row.id)));}
return comments.map((row) => {
					const profile = profileByUser.get(Number(row.user_id));
					const reactionMeta = reactionsByComment.get(Number(row.id));
					return { ...row,...(parseMeta(row.meta)?.reply?{reply_parent_exists:existingReplies.has(Number(parseMeta(row.meta).reply.referenced_id))}:{}), meta: row.meta || {}, user_name: profile?.user_name ?? null, display_name: profile?.display_name ?? null, avatar_url: profile?.avatar_url ?? null, plan: planByUser.get(Number(row.user_id)) || "free", reactions: reactionMeta?.reactions || {}, viewer_reactions: reactionMeta?.viewer_reactions || [] };
				})
}
