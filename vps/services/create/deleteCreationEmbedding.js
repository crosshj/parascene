const EMBEDDINGS_TABLE = "prsn_created_embeddings";
export async function deleteCreationEmbedding(supabase, createdImageId) {
	if (!supabase || !Number.isFinite(createdImageId) || createdImageId < 1) return;
	const { error } = await supabase
		.from(EMBEDDINGS_TABLE)
		.delete()
		.eq("created_image_id", createdImageId);
	if (error) throw error;
}
