import express from "express";
import { createClient } from "@supabase/supabase-js";
import { getThumbnailUrl } from "./utils/url.js";
import { recommendWithDataSource } from "../db/recommend/recsysWrapper.js";

const RELATED_LIMIT_CAP = 40;
const RELATED_EXCLUDE_IDS_CAP = 200;
const RECSYS_RANDOM_ONLY_SEEN_THRESHOLD = 120;
let supabaseServiceClient = null;

function getSupabaseServiceClient() {
	if (supabaseServiceClient) return supabaseServiceClient;
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return null;
	supabaseServiceClient = createClient(url, key);
	return supabaseServiceClient;
}

function parseRecsysConfigFromParams(params, limit) {
	return {
		lineageWeight: Math.max(0, parseInt(params["related.lineage_weight"], 10) || 100),
		lineageMinSlots: Math.max(0, parseInt(params["related.lineage_min_slots"], 10) || 2),
		sameServerMethodWeight: Math.max(0, parseInt(params["related.same_server_method_weight"], 10) || 80),
		sameCreatorWeight: Math.max(0, parseInt(params["related.same_creator_weight"], 10) || 50),
		fallbackWeight: Math.max(0, parseInt(params["related.fallback_weight"], 10) || 20),
		candidateCapPerSignal: Math.max(1, Math.min(500, parseInt(params["related.candidate_cap_per_signal"], 10) || 100)),
		randomSlotsPerBatch: Math.max(0, parseInt(params["related.random_slots_per_batch"], 10) || 0),
		fallbackEnabled: true,
		hardPreference: true,
		clickNextWeight: 50,
		transitionCapPerFrom: Math.max(1, parseInt(params["related.transition_cap_k"], 10) || 50),
		decayHalfLifeDays: parseFloat(params["related.transition_decay_half_life_days"]),
		windowDays: Math.max(0, parseFloat(params["related.transition_window_days"]) || 0),
		batchSize: limit + 1,
		now: () => Date.now(),
		rng: Math.random,
		coldMode: "auto",
		coldConfidenceThreshold: 0.35,
		coldExploreFraction: 0.7,
		coldExploreMinGuessSlots: 2
	};
}

async function buildRecsysInputsWithSupabase(client, seedId, excludeIds, params) {
	const cap = Math.max(1, Math.min(500, parseInt(params["related.candidate_cap_per_signal"], 10) || 100));
	const excludeSet = new Set((excludeIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0));
	excludeSet.add(Number(seedId));

	const { data: seedRows, error: seedErr } = await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("id", seedId)
		.eq("published", true)
		.limit(1);
	if (seedErr) throw seedErr;
	const anchor = seedRows?.[0];
	if (!anchor) return null;

	const byId = new Map();
	const addRows = (rows) => {
		for (const row of rows || []) {
			const id = Number(row?.id);
			if (!Number.isFinite(id) || id < 1 || excludeSet.has(id)) continue;
			if (!byId.has(id)) byId.set(id, row);
		}
	};

	const parentIds = anchor?.meta?.mutate_of_id != null
		? [Number(anchor.meta.mutate_of_id)].filter((id) => Number.isFinite(id) && id > 0 && !excludeSet.has(id))
		: [];
	const lineageOr = `meta->>mutate_of_id.eq.${seedId}`;
	addRows((await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("published", true)
		.or(lineageOr)
		.limit(cap)).data);

	if (parentIds.length > 0) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.in("id", parentIds)
			.eq("published", true)
			.limit(cap)).data);
	}

	const sid = anchor?.meta?.server_id;
	const method = anchor?.meta?.method;
	if (sid != null && method != null) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.eq("published", true)
			.or(`and(meta->>server_id.eq.${sid},meta->>method.eq.${method})`)
			.limit(cap)).data);
	}

	if (anchor?.user_id != null) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.eq("published", true)
			.eq("user_id", anchor.user_id)
			.limit(cap)).data);
	}

	addRows((await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("published", true)
		.order("created_at", { ascending: false })
		.limit(cap)).data);

	const { data: transitions, error: transErr } = await client
		.from("prsn_related_transitions")
		.select("from_created_image_id,to_created_image_id,count,last_updated")
		.eq("from_created_image_id", seedId);
	if (transErr) throw transErr;

	return { anchor, pool: [anchor, ...byId.values()], transitions: transitions ?? [] };
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function mapRelatedItemsToResponse(items, viewerLikedIds, reasonMetaByCreationId = null) {
	const likedSet = new Set((viewerLikedIds ?? []).map(String));
	return (Array.isArray(items) ? items : []).map((item) => {
		const imageUrl = item?.url ?? null;
		const author = item?.author_display_name ?? item?.author_user_name ?? "";
		const creationId = item?.created_image_id ?? item?.id ?? null;
		const reasonMeta = reasonMetaByCreationId?.get?.(Number(creationId));
		return {
			id: item?.id,
			title: escapeHtml(item?.title != null ? item.title : "Untitled"),
			summary: escapeHtml(item?.summary != null ? item.summary : ""),
			author,
			author_user_name: item?.author_user_name ?? null,
			author_display_name: item?.author_display_name ?? null,
			author_avatar_url: item?.author_avatar_url ?? null,
			tags: item?.tags ?? null,
			created_at: item?.created_at,
			image_url: imageUrl,
			thumbnail_url: getThumbnailUrl(imageUrl),
			created_image_id: item?.created_image_id ?? item?.id ?? null,
			user_id: item?.user_id ?? null,
			like_count: Number(item?.like_count ?? 0),
			comment_count: Number(item?.comment_count ?? 0),
			viewer_liked: likedSet.has(String(item?.id ?? item?.created_image_id)),
			reason_labels: Array.isArray(reasonMeta?.labels) ? reasonMeta.labels : [],
			reason_details: Array.isArray(reasonMeta?.details) ? reasonMeta.details : [],
			recsys_score: Number.isFinite(Number(reasonMeta?.score)) ? Number(reasonMeta.score) : null,
			recsys_click_score: Number.isFinite(Number(reasonMeta?.click_score)) ? Number(reasonMeta.click_score) : null,
			recsys_click_share: Number.isFinite(Number(reasonMeta?.click_share)) ? Number(reasonMeta.click_share) : null
		};
	});
}

function recsysReasonDetailsForItem(anchor, candidate, reasons) {
	const out = [];
	const anchorId = Number(anchor?.id);
	const candidateId = Number(candidate?.id);
	const anchorTitle = anchor?.title ?? null;
	const candidateTitle = candidate?.title ?? null;
	for (const reason of reasons || []) {
		if (reason === "clickNext") {
			out.push({
				type: "clickNext",
				label: "Users clicked next from anchor",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "lineage") {
			let label = "Same lineage";
			if (candidate?.meta?.mutate_of_id != null && Number(candidate.meta.mutate_of_id) === anchorId) {
				label = "Child of anchor";
			} else if (anchor?.meta?.mutate_of_id != null && Number(anchor.meta.mutate_of_id) === candidateId) {
				label = "Parent of anchor";
			}
			out.push({
				type: "lineage",
				label,
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "sameCreator") {
			out.push({
				type: "sameCreator",
				label: "Same creator",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "sameServerMethod") {
			out.push({
				type: "sameServerMethod",
				label: "Same server/method",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "fallback") {
			out.push({
				type: "fallback",
				label: "Fallback candidate",
				related_creation_id: Number.isFinite(candidateId) ? candidateId : null,
				related_creation_title: candidateTitle
			});
			continue;
		}
		out.push({
			type: String(reason),
			label: String(reason),
			related_creation_id: null,
			related_creation_title: null
		});
	}
	return out;
}

export default function createCreationsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/creations", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const creations = await queries.selectCreationsForUser.all(user.id);
		return res.json({ creations });
	});

	router.get("/api/creations/:id/related", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), RELATED_LIMIT_CAP);
			const excludeIdsRaw = req.query.exclude_ids;
			const excludeIds = typeof excludeIdsRaw === "string" && excludeIdsRaw
				? excludeIdsRaw
					.split(",")
					.map((s) => parseInt(s.trim(), 10))
					.filter((n) => Number.isFinite(n))
					.slice(0, RELATED_EXCLUDE_IDS_CAP)
				: undefined;
			const seenCount = Math.max(0, parseInt(req.query.seen_count, 10) || 0);
			const forceRandom = String(req.query.force_random || "0") === "1";

			const params = await queries.getRelatedParams?.get?.() ?? {};
			let ids = [];
			let hasMore = false;
			let reasonMetaByCreationId = null;
			const supabaseClient = getSupabaseServiceClient();
			if (!supabaseClient) {
				return res.status(500).json({ error: "Recsys engine is unavailable." });
			}
			let recsysInputs = null;
			const recsysConfig = parseRecsysConfigFromParams(params, limit);
			if (forceRandom || seenCount >= RECSYS_RANDOM_ONLY_SEEN_THRESHOLD) {
				recsysConfig.randomSlotsPerBatch = limit;
				recsysConfig.fallbackEnabled = true;
				recsysConfig.hardPreference = false;
			}
			const recsys = await recommendWithDataSource({
				config: recsysConfig,
				context: { seedId: id, userId: req.auth?.userId ?? null },
				loadInputs: async () => {
					const built = await buildRecsysInputsWithSupabase(
						supabaseClient,
						id,
						excludeIds,
						params
					);
					recsysInputs = built;
					return built;
				}
			});
			const top = recsys.items.slice(0, limit + 1);
			ids = top.map((row) => Number(row.id)).filter((n) => Number.isFinite(n) && n > 0).slice(0, limit);
			hasMore = top.length > limit;
			if (recsysInputs?.anchor && Array.isArray(recsys.items)) {
				const byId = new Map((recsysInputs.pool || []).map((x) => [Number(x?.id), x]));
				reasonMetaByCreationId = new Map();
				for (const row of recsys.items) {
					const candidate = byId.get(Number(row.id));
					const labels = Array.isArray(row.reasons) ? row.reasons : [];
					reasonMetaByCreationId.set(Number(row.id), {
						labels,
						details: recsysReasonDetailsForItem(recsysInputs.anchor, candidate, labels),
						score: row.score,
						click_score: row.click_score,
						click_share: row.click_share
					});
				}
			}

			if (!ids || ids.length === 0) {
				return res.json({ items: [], hasMore: false });
			}

			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			const items = typeof feedByCreation === "function" ? await feedByCreation(ids) : [];
			const viewerLikedIds = typeof queries.selectViewerLikedCreationIds?.all === "function"
				? await queries.selectViewerLikedCreationIds.all(req.auth?.userId, ids)
				: [];
			const itemsWithImages = mapRelatedItemsToResponse(items, viewerLikedIds, reasonMetaByCreationId);

			return res.json({ items: itemsWithImages, hasMore: !!hasMore });
		} catch (err) {
			console.error("[creations] related error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load related creations." });
		}
	});

	router.get("/api/creations/:id/summary", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			if (typeof feedByCreation !== "function") {
				return res.status(500).json({ error: "Feed lookup unavailable" });
			}
			const rows = await feedByCreation([id]);
			if (!Array.isArray(rows) || rows.length === 0) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const viewerLikedIds = typeof queries.selectViewerLikedCreationIds?.all === "function"
				? await queries.selectViewerLikedCreationIds.all(req.auth?.userId, [id])
				: [];
			const items = mapRelatedItemsToResponse(rows, viewerLikedIds);
			return res.json({ item: items[0] || null });
		} catch (err) {
			console.error("[creations] summary error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load creation summary." });
		}
	});

	router.post("/api/creations/transitions", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const fromId = req.body?.from_created_image_id != null ? parseInt(req.body.from_created_image_id, 10) : null;
			const toId = req.body?.to_created_image_id != null ? parseInt(req.body.to_created_image_id, 10) : null;
			if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId < 1 || toId < 1 || fromId === toId) {
				return res.status(400).json({ error: "Invalid from_created_image_id or to_created_image_id" });
			}

			const recordTransition = queries.recordTransition?.run;
			if (typeof recordTransition !== "function") {
				return res.status(204).end();
			}

			await recordTransition(fromId, toId);
			return res.status(204).end();
		} catch (err) {
			console.error("[creations] transitions error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to record transition." });
		}
	});

	return router;
}
