# Related Creations – Phased Implementation

Work from [PLAN_RELATED_CREATIONS.md](PLAN_RELATED_CREATIONS.md) split into phases. Each phase is shippable or testable on its own. Dependencies flow forward; later phases assume prior phases are done.

---

## Phase 1: Config and transition storage ✅ Done

**Goal:** Policy knobs for related algorithm and storage for click-next transitions. No UI yet.

| # | Task | Notes |
|---|------|--------|
| 1.1 | **Policy knobs** | Add defaults for all `related.*` keys (see plan Default parameter values). Ensure adapter can read by key; add method to read related params in one go; add upsert for admin save. |
| 1.2 | **Transition schema** | In `db/schemas/supabase_01.sql`: table `prsn_related_transitions(from_created_image_id, to_created_image_id, count, last_updated)` with unique on (from, to). Indexes: from_id; (from_id, last_updated) for eviction; count (or composite) for admin list. |
| 1.3 | **recordTransition** | In Supabase adapter: upsert (from, to), increment count, set last_updated = now. Enforce cap K per from_id: when over K rows, delete by oldest last_updated (keep K most recent). |
| 1.4 | **selectTransitions** | In Supabase adapter: `selectTransitions({ page, limit })` → rows ordered by count desc; return total for hasMore. Optional: join for from_title/to_title. |
| 1.5 | **Stubs** | Mock/SQLite: recordTransition no-op or in-memory; selectTransitions return empty list. App runs without Supabase. |

**Deliverable:** Policy knobs readable; transitions can be recorded and listed; stubs in place.

---

## Phase 2: Related API (content-only) ✅ Done

**Goal:** GET related and POST transition routes. Ranking uses content signals only (click-next blend can be 0 or skipped until Phase 4).

| # | Task | Notes |
|---|------|--------|
| 2.1 | **selectRelatedToCreatedImage** | In Supabase adapter: `selectRelatedToCreatedImage(createdImageId, viewerId, { limit, seedIds?, excludeIds?, params })`. If seedIds: related to that set; else related to createdImageId. Exclude excludeIds and current creation. **Content-only for now:** lineage, same server+method, same creator, fallback; weights from params; lineage_min_slots; candidate_cap_per_signal; random injection; sort by score then created_at desc; only published. Return rows mappable to explore shape. Click-next lookup optional (skip or weight=0). Indexes as in plan. Mock/SQLite: stub return empty or minimal. |
| 2.2 | **GET /api/creations/:id/related** | Parse limit (default 10, cap 24), seed_ids (cap 10), exclude_ids. Auth required (401 if missing). Load related params; call selectRelatedToCreatedImage; map to same shape as explore (reuse getThumbnailUrl / mapper). Return `{ items, hasMore }`. |
| 2.3 | **POST /api/creations/transitions** | Parse from_created_image_id, to_created_image_id from body. Auth required. Call recordTransition(fromId, toId). Return 204 or 200. |

**Deliverable:** First batch and seed-based next batches work; transitions can be recorded via API. No UI yet.

---

## Phase 3: Creation detail UI ✅ Done

**Goal:** “More like this” section on creation detail with infinite scroll and transition recording from the client.

| # | Task | Notes |
|---|------|--------|
| 3.1 | **Placement** | In `public/pages/creation-detail.js`, after comments: section only when published and not failed. Heading “More like this”, container `data-related-container`, grid (reuse explore grid classes), sentinel `data-related-sentinel`. Optional “Load more” button. |
| 3.2 | **First load** | After creation + comments loaded, GET `/api/creations/:id/related?limit=10`. If no items: hide section or “No related creations yet”. Else render cards (same markup as explore). Links: `/creations/${created_image_id}?from=${currentCreationId}`. Lazy-load images like explore. |
| 3.3 | **Infinite scroll** | IntersectionObserver on sentinel. On enter view: GET with seed_ids = last batch IDs, exclude_ids = current + all shown. Append items; dedupe by id. hasMore → stop observing or hide sentinel when false. |
| 3.4 | **Transition recording** | On creation-detail load: if query `from` present and valid, check sessionStorage `related_transition_${from}_${to}`; if not set, POST /api/creations/transitions with { from_created_image_id: from, to_created_image_id: currentId }, then set key. After success, strip `?from=` via history.replaceState. |
| 3.5 | **Styling** | Reuse .route-card, .route-card-image, .route-empty-image-grid etc.; add section-specific classes in global.css only if needed. |

**Deliverable:** User sees related grid on creation detail; infinite scroll works; clicking a related card and landing records transition once per session; URL cleaned.

---

## Phase 4: Click-next in ranking ✅ Done

**Goal:** Full v1 algorithm: blend click-next with content score, time decay, and eviction.

| # | Task | Notes |
|---|------|--------|
| 4.1 | **Click-next in selectRelatedToCreatedImage** | For seed id(s), read transition table (from_id, to_id, count, last_updated). Apply time decay: effective_count = count × 2^(-age_days / half_life) (or hard window if transition_window_days > 0). Do not filter out rows by age or low effective_count—all rows contribute. Normalize to 0–1 (or 0–100) per candidate. When no transition data for seeds, skip. Blend: final_score = content_score + click_next_weight × click_next_score. Enforce lineage_min_slots. Sort final_score desc, then created_at desc. |
| 4.2 | **Cap K and eviction** | Ensure recordTransition enforces transition_cap_k: when from_id has > K rows, delete by oldest last_updated (keep K most recent). Use param from policy knobs. |
| 4.3 | **Params** | All ranking params (transition_decay_half_life_days, transition_window_days, click_next_weight, etc.) read from related.* in selectRelatedToCreatedImage. |

**Deliverable:** Related results improve as users click; cold start remains content-only; tuneables drive behavior.

---

## Phase 5: Admin UI and APIs ✅ Done

**Goal:** Admins can view/edit related settings and inspect the transition table.

| # | Task | Notes |
|---|------|--------|
| 5.1 | **GET /admin/related-settings** | Return all related.* keys and values (and descriptions if stored). Admin-only. |
| 5.2 | **PATCH /admin/related-settings** | Body: flat key/value (e.g. related.lineage_weight: 100). Upsert each into policy_knobs. Admin-only. Return updated settings. |
| 5.3 | **GET /admin/transitions** | Query: page (default 1), limit (default 20, cap 100). Response: { items, total, page, limit, hasMore }. Sort by count desc. Optional: from_title, to_title. Admin-only. |
| 5.4 | **Admin nav and panel** | In app-admin: nav link `data-route="related"`; content block `data-route-content="related"`. In admin.js: case "related" → loadRelatedAlgorithm(). |
| 5.5 | **Related algorithm form** | loadRelatedAlgorithm(): GET /admin/related-settings; render form (signal weights, lineage min slots, random injection, batch/candidate caps, transition cap K, decay/window, fallback). One Save button → PATCH with current values; show success/error. |
| 5.6 | **Click-next inspect table** | Same Related page: “Click-next data” section. GET /admin/transitions?page=1&limit=20. Table: From, To, Count, Last updated. Paging: Prev/Next or page numbers. Responsive (scroll or compact layout). Empty: “No transition data yet. Click related cards on creation detail to record transitions.” |

**Deliverable:** Admin can tune related algorithm and inspect transition data.

---

## Summary

| Phase | Focus | User-visible | Status |
|-------|--------|--------------|--------|
| 1 | Config + transition table + record/list + stubs | No | ✅ Done |
| 2 | Related API (content-only) + transition POST | No (API only) | ✅ Done |
| 3 | Creation detail section + infinite scroll + transition recording | Yes | ✅ Done |
| 4 | Click-next in ranking (blend, decay, cap K) | Yes (better related results) | ✅ Done |
| 5 | Admin APIs + Related settings form + transitions table | Yes (admin) | ✅ Done |

Validation steps from the end of [PLAN_RELATED_CREATIONS.md](PLAN_RELATED_CREATIONS.md) apply after Phase 3 (basic) and Phase 4 (click-next), and Phase 5 (admin flows).
