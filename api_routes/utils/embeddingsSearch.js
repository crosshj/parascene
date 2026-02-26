/**
 * Shared semantic search by text: embed query (cached or Replicate) → pgvector nearest.
 * Used by /api/embeddings/search and /api/explore/search/semantic so they call in-process instead of HTTP.
 */

import Replicate from "replicate";
import { getSupabaseServiceClient } from "./supabaseService.js";
import { getTextEmbeddingFromReplicate } from "./embeddings.js";

const RPC_NEAREST = "prsn_created_embeddings_nearest";
const SEARCH_CACHE_TABLE = "prsn_search_embedding_cache";
const RPC_SEARCH_CACHE_RECORD_USAGE = "prsn_search_embedding_cache_record_usage";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_OFFSET = 500;

function normalizeSearchQuery(q) {
	if (typeof q !== "string") return "";
	return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseLimit(v) {
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

function parseOffset(v) {
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_OFFSET) : 0;
}

/**
 * Run semantic search: embed query (from cache or Replicate), then nearest-neighbour RPC.
 * @param {{ q: string, limit?: number, offset?: number }} opts
 * @returns {Promise<{ ids: number[], idToDistance: Map<number, number>, hasMore: boolean }>}
 * @throws {{ statusCode: number, message: string }} for HTTP-style errors
 */
export async function runSemanticSearch(opts) {
	const q = typeof opts?.q === "string" ? opts.q.trim() : "";
	if (!q) throw { statusCode: 400, message: "Missing query (q)." };
	const normalized = normalizeSearchQuery(q);
	if (!normalized) throw { statusCode: 400, message: "Missing query (q)." };
	const limit = opts?.limit != null ? parseLimit(String(opts.limit)) : DEFAULT_LIMIT;
	const offset = opts?.offset != null ? parseOffset(String(opts.offset)) : 0;

	const supabase = getSupabaseServiceClient();
	if (!supabase) throw { statusCode: 503, message: "Embeddings unavailable." };

	let embedding = null;
	const { data: cached, error: cacheErr } = await supabase
		.from(SEARCH_CACHE_TABLE)
		.select("id, embedding")
		.eq("normalized_query", normalized)
		.maybeSingle();
	if (!cacheErr && cached?.embedding) {
		await supabase.rpc(RPC_SEARCH_CACHE_RECORD_USAGE, { p_cache_id: cached.id });
		embedding = cached.embedding;
	}
	if (!embedding || !Array.isArray(embedding)) {
		const token = process.env.REPLICATE_API_TOKEN;
		if (!token) throw { statusCode: 503, message: "Search unavailable (no REPLICATE_API_TOKEN)." };
		const replicate = new Replicate({ auth: token });
		embedding = await getTextEmbeddingFromReplicate(replicate, q);
		if (!embedding || !Array.isArray(embedding)) {
			throw { statusCode: 502, message: "Failed to embed query." };
		}
		const { data: inserted, error: insertErr } = await supabase
			.from(SEARCH_CACHE_TABLE)
			.insert({ normalized_query: normalized, embedding })
			.select("id")
			.single();
		if (!insertErr && inserted?.id) {
			await supabase.rpc(RPC_SEARCH_CACHE_RECORD_USAGE, { p_cache_id: inserted.id });
		}
	}

	const { data: nearestRaw, error: rpcErr } = await supabase.rpc(RPC_NEAREST, {
		target_embedding: embedding,
		exclude_id: null,
		lim: limit + 1,
		off: offset
	});
	if (rpcErr) {
		console.error("[embeddingsSearch] RPC:", rpcErr);
		throw { statusCode: 500, message: "Similarity search failed." };
	}
	const hasMore = Array.isArray(nearestRaw) && nearestRaw.length > limit;
	const nearest = hasMore ? nearestRaw.slice(0, limit) : (nearestRaw ?? []);
	const ids = nearest.map((r) => Number(r?.created_image_id)).filter((n) => Number.isFinite(n) && n > 0);
	const idToDistance = new Map((nearest ?? []).map((r) => [Number(r.created_image_id), Number(r.distance)]));
	return { ids, idToDistance, hasMore };
}
