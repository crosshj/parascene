## Investigate Orphan Embeddings (Dry Run)

Timestamp (UTC): `2026-03-18T19:15:58Z`

Script:
- `node db/maintenance/cleanup-embeddings-orphans.js dr --batch-size 1000`

Dry-run results:
- `scanned_embeddings_rows`: `1381`
- `candidate_embeddings_to_delete`: `3`
- `deleted_embeddings_rows`: `0` (dry run)
- `candidate_examples_created_image_ids`: `[2779, 2780, 3593]`

Notes / next checks:
- These `created_image_id`s exist in `prsn_created_embeddings` but either:
  - the corresponding `prsn_created_images` row is missing, or
  - `prsn_created_images.published` is not `true` (or not `1`).
- If we want to confirm which case applies per id, we can query `prsn_created_images` for:
  - `id IN (2779, 2780, 3593)`

