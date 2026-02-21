# Plan: pgvector (semantic relatedness)

Minimal checklist for adding semantic relatedness via pgvector, in phase order.

1. **Schema:** Enable pgvector extension and add vector column(s) / embeddings table where needed
2. **Embeddings pipeline:** Generate and store embeddings (e.g. for creations, prompts, or searchable text) at publish and for backfill
3. **Backfill:** Local script (run locally) to backfill embeddings for existing rows
4. **API:** Expose similarity search (related-to-item; semantic app search optional / lower priority)
5. **Test page (HTML/JS/CSS):** Simple local page to validate embeddings and search. Semantic search (search string → embed → similarity) is the easiest to test here. Also:
   - Main image from `id` in query params (when `id` present)
   - Below it, thumbnails + short descriptions of nearest neighbours by text and image embedding
   - Clicking a thumbnail reloads the page with that item’s `id` in the query params
   - **Search:** Input to run search string → embed → similarity; show results as same thumbnails + descriptions so both “related to this image” and “similar to this query” can be tested
6. **App UI / ranking (major):** The hard part is integrating the image+meta ↔ image+meta case (related to this item) with the existing recommender/ranking algorithm in the app. Semantic search is easier to add later; focus here on how related results combine with the recommender.
