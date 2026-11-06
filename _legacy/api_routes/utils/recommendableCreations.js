/**
 * Helpers for creations that may appear in feeds, related, and semantic search.
 */

export function isRecommendableCreationRow(row) {
	if (!row) return false;
	const id = Number(row.id ?? row.created_image_id);
	if (!Number.isFinite(id) || id < 1) return false;
	const published = row.published === true || row.published === 1;
	const unavailableAt = row.unavailable_at;
	const unavailable = unavailableAt != null && String(unavailableAt).trim() !== "";
	return published && !unavailable;
}

/**
 * Keep only published, available creation ids, preserving input order.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number[]} ids
 * @param {{ imagesTable?: string }} [opts]
 * @returns {Promise<number[]>}
 */
export async function filterRecommendableCreationIds(supabase, ids, opts = {}) {
	const imagesTable = opts.imagesTable || "prsn_created_images";
	const orderedIds = (Array.isArray(ids) ? ids : [])
		.map((id) => Number(id))
		.filter((id) => Number.isFinite(id) && id > 0);
	if (orderedIds.length === 0 || !supabase) return [];

	const uniqueIds = [...new Set(orderedIds)];
	const { data, error } = await supabase
		.from(imagesTable)
		.select("id, published, unavailable_at")
		.in("id", uniqueIds);
	if (error) throw error;

	const ok = new Set(
		(data ?? [])
			.filter(isRecommendableCreationRow)
			.map((row) => Number(row.id))
	);
	return orderedIds.filter((id) => ok.has(id));
}
