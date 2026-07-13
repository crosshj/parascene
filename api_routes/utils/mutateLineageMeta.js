/**
 * Mutate-style lineage fields for a new creation derived from a parent.
 * `history` is oldest → newest ancestors and does not include the new creation's own id.
 *
 * @param {object|null|undefined} sourceMeta
 * @param {number|string} sourceId
 * @returns {{ history: number[], mutate_of_id: number, direct_parent_ids: number[] } | null}
 */
export function buildMutateLineageMetaFields(sourceMeta, sourceId) {
	const sid = Number(sourceId);
	if (!Number.isFinite(sid) || sid <= 0) return null;
	const prior = Array.isArray(sourceMeta?.history) ? sourceMeta.history : [];
	const priorIds = prior
		.map((v) => Number(v))
		.filter((n) => Number.isFinite(n) && n > 0);
	return {
		history: [...priorIds, sid],
		mutate_of_id: sid,
		direct_parent_ids: [sid],
	};
}
