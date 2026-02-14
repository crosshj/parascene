# Related Creations – Implementation Plan

Concise, actionable plan for another assistant to implement. For philosophy and design decisions, see [RELATED_CREATIONS_DESIGN.md](RELATED_CREATIONS_DESIGN.md).

---

## Goal

- On the **creation detail page**, after the comments section, show a **related creations** grid (same card UX as the explore page).
- **Infinite scroll:** First batch = related to current creation; each next batch = related to the *last batch’s* creations (seed-based). Use a sentinel at the bottom to load more automatically (like explore).
- **v1 algorithm:** Content signals (lineage, same server+method, same creator, fallback) **plus click-next**. We record view→next-click transitions from day one; at first there is no transition data, so ranking is content-only (cold start). As data accumulates, we blend click-next into the score. All parameters are admin-tuneable.
- **Auth:** Related API requires auth (same as explore). Show related section only for published, non-failed creations.

---

## API Contract

**GET /api/creations/:id/related**

- **Query:** `limit` (default 10, cap e.g. 24), optional `seed_ids` (comma-separated creation IDs; cap e.g. 10 to limit backend load), optional `exclude_ids` (comma-separated: current + already shown).
- **Semantics:**  
  - No `seed_ids`: return up to `limit` related to `:id` (first batch).  
  - With `seed_ids`: return up to `limit` related to *any* of those seeds (next batch), excluding `exclude_ids` and `:id`.
- **Response:** `{ items: [...], hasMore: boolean }`. Each item has the same shape as explore: `id`, `title`, `summary`, `author`, `created_at`, `image_url`, `thumbnail_url`, `created_image_id`, `user_id`, `like_count`, `comment_count`, `viewer_liked`, `author_user_name`, `author_display_name`, `author_avatar_url`, `tags`. Use the same mapper as explore so `id` equals `created_image_id` for each item.
- **Auth:** Require `req.auth?.userId`; 401 if missing.

**POST /api/creations/transitions**

- **Purpose:** Record that a user went from creation `fromId` to creation `toId` (e.g. they clicked a related card). The client calls this when the creation-detail page loads with query param `?from=:fromId` (i.e. we record on destination load, not on link click).
- **Body:** `{ from_created_image_id, to_created_image_id }` (both creation IDs).
- **Semantics:** Upsert into transition table: increment count for (from_id, to_id), set `last_updated` to now. Each successful call counts as one transition. Enforce cap K per from_id: when a from_id has more than K rows, **evict by oldest last_updated** (keep the K most recently updated rows) so new click→view paths can emerge instead of being blocked by old high-count rows. Idempotent for the upsert operation; count increases on each call.
- **Auth:** Require `req.auth?.userId`; 401 if missing.
- **Client responsibility:** The server does not distinguish a genuine click from a refresh or scripted spam. The **client** must not spam: record at most once per (from, to) per session (e.g. guard with sessionStorage before calling; optionally strip `?from=` from the URL after a successful record so refresh does not resend). Without this, repeated refreshes or abuse could bias click-next counts.
- **Abuse:** The endpoint is client-triggered and thus abuseable (e.g. repeated POSTs to inflate a creation’s “related” rank). Mitigation is left to the client (no spam) and optionally to server-side rate-limiting per user (v1 or later).

---

## Backend (order of work)

1. **Policy knobs / config**
   - Add defaults for all related tuneables (see [Default parameter values](#default-parameter-values) below). Use keys under `related.*` (e.g. `related.lineage_weight`, `related.batch_size`).
   - Ensure adapter can read policy by key (existing `selectPolicies` / get-by-key). Add adapter method to read related params in one go (or read multiple keys). Add upsert for each key used by admin save.

2. **Transition table and recording (Supabase)**
   - **Schema:** Add table e.g. `prsn_related_transitions(from_created_image_id, to_created_image_id, count, last_updated)` with unique constraint on (from_created_image_id, to_created_image_id). `last_updated` is timestamptz, set on insert and on every increment. Index on from_created_image_id for lookups and trimming; index on (from_created_image_id, last_updated) to support evicting by oldest last_updated; index on count (or composite) for admin list sorted by count desc.
   - **Record transition:** Implement `recordTransition(fromId, toId)`: upsert (from, to), increment count, set last_updated = now(). Enforce **cap K per from_id**: when a from_id has more than K rows, delete the row(s) with the **oldest last_updated** (keep the K most recently updated) so new click→view paths can emerge. Call this from the transition API route.
   - **List for admin:** Implement `selectTransitions({ page, limit })`: return rows from transition table (include last_updated); order by count desc. Offset/limit for paging; return total count for hasMore/total. Optionally join to creations for from_title/to_title. Mock/SQLite: return empty list.
   - **Mock/SQLite:** Stub to no-op or in-memory so app runs without Supabase.

3. **DB layer (Supabase)**
   - Implement `selectRelatedToCreatedImage(createdImageId, viewerId, options)` where `options = { limit, seedIds?, excludeIds?, params? }`. If `seedIds` provided, compute related to that set; else related to `createdImageId`. Always exclude `excludeIds` and current creation. Apply tuneables from `params` (or read from policy knobs inside the function).
   - **Ranking (v1):** (1) **Content score:** For each candidate, assign the score of its best-matching signal (lineage, same server+method, same creator, fallback) using the tuneable weights. (2) **Click-next score:** For the seed id(s), read transition table (from_id, to_id, count, last_updated). Apply **time decay** so recent transitions matter more: e.g. `effective_count = count × 2^(- (now - last_updated) / half_life)` using `related.transition_decay_half_life_days` (or, if you prefer a hard window, only use rows where `last_updated` is within `related.transition_window_days`). **Do not filter out rows by age or by effective_count below a threshold**—include all transition rows in the blend so small or old signals (e.g. only 4 transitions) still contribute; they may be dominated by other signals in the final ranking, which is fine, but they must not disappear purely because of age. Normalize (e.g. by max effective_count per from_id) to get a 0–1 or 0–100 scale per candidate. When there is **no transition data** for the seed(s), skip this step. (3) **Blend:** `final_score = content_score + click_next_weight × click_next_score` (or equivalent; keep lineage_min_slots by reserving slots for lineage before or after blend). (4) Enforce **lineage_min_slots**. Sort by final_score descending, then **created_at descending (recency)**. Cap candidates per signal (`candidate_cap_per_signal`), merge, dedupe by id (keep highest score). Apply **random injection** (slots from `random_slots_per_batch` or `random_fraction`). Take top `limit`. Only published images.
   - Return rows that can be mapped to explore-like shape (need `created_image_id`, title, summary, author, file_path/filename, user_id, created_at; like/comment counts and profiles attached in API or in same query).
   - **Indexes:** Add expression index on `(published, (meta->>'mutate_of_id'))` and optionally GIN on `(meta->'history')`; expression index on `(published, (meta->>'server_id'), (meta->>'method'))`. Optional: table `prsn_created_image_lineage(created_image_id, ancestor_id)` with index on `ancestor_id` and populate from meta on write (faster lineage lookups).
   - **Mock/SQLite:** Stub `selectRelatedToCreatedImage` to return empty or a minimal list so app runs without Supabase.

4. **Related API route**
   - Register `GET /api/creations/:id/related` (e.g. in `api_routes/creations.js` or `api_routes/explore.js`). Parse `limit`, `seed_ids`, `exclude_ids` from query. Load related params (policy knobs). Call `selectRelatedToCreatedImage(id, viewerId, { limit, seedIds, excludeIds, params })`. Map result to same shape as explore (reuse `getThumbnailUrl` and a shared mapper or the same fields as `mapExploreItemsToResponse`). Return `{ items, hasMore }`. Set `hasMore` from whether you got `limit` items (or use a slightly larger fetch and then slice).

5. **Transition record API route**
   - Register `POST /api/creations/transitions`. Parse `from_created_image_id` and `to_created_image_id` from body. Require auth. Call `recordTransition(fromId, toId)`. Return 204 or 200. No response body needed.

6. **Admin API for related settings**
   - `GET /admin/related-settings`: return all `related.*` policy knob keys and values (and descriptions if stored). Admin-only.
   - `PATCH /admin/related-settings`: body = flat object of key/value (e.g. `related.lineage_weight: 100`). For each key, upsert into policy_knobs. Admin-only. Return updated settings.

7. **Admin API for click-next inspect**
   - `GET /admin/transitions`: list transition table rows for admin inspection. **Query:** `page` (default 1), `limit` (default 20, cap e.g. 100). **Response:** `{ items: [{ from_created_image_id, to_created_image_id, count, last_updated }], total, page, limit, hasMore }`. Optionally include minimal creation labels (e.g. `from_title`, `to_title` or ids only) for readability. Sort by count descending (or by from_id then count) so hottest transitions appear first. Admin-only.

---

## Frontend: Creation detail related section

1. **Placement**
   - In `public/pages/creation-detail.js`, after the comments block (after the `</div>` that closes `.comment-list`), add a section only when creation is published and not failed:
     - Heading (e.g. "More like this").
     - Container with `data-related-container`.
     - Grid wrapper reusing explore grid classes (e.g. `route-empty-image-grid` for the list of cards).
     - A sentinel element at the bottom (e.g. `data-related-sentinel`) for infinite scroll.
     - Optional: fallback "Load more" button like explore.

2. **First load**
   - After main creation and comments are loaded, call `GET /api/creations/:id/related?limit=10`. If no items, hide the section or show "No related creations yet". Else render cards into the grid (same card markup as explore: `route-card`, `route-card-image`, `route-media`, `route-details`, title, summary, author, link to `/creations/${created_image_id}`). Use same lazy-load pattern for images as explore (background on `.route-media` or img). **Click-next:** Each related card link must include the current creation as referrer so we can record the transition when the user clicks—e.g. link to `/creations/${created_image_id}?from=${currentCreationId}` (store `currentCreationId` from the detail page’s creation).

3. **Infinite scroll**
   - When the sentinel enters view (IntersectionObserver), call the API with `seed_ids` = the creation IDs from the *last batch* you appended, and `exclude_ids` = current creation ID + all creation IDs already shown. Use same `limit` (e.g. 10). Append new items to the grid; dedupe by id. Set `hasMore` from response; if false, stop observing or hide sentinel. Re-attach observer after each successful load so next scroll can trigger again.

4. **Card markup and transition recording**
   - Reuse structure from `public/components/routes/explore.js` (e.g. lines 582–620): same classes and data attributes so CSS applies. Reuse or duplicate the card HTML; ensure each item has `thumbnail_url` or `image_url`, `title`, `summary`, `created_at`, `author_*`, `created_image_id` for links and display. **Links:** Use `/creations/${item.created_image_id}?from=${currentCreationId}` so that when the user lands on the new creation, the page can record the transition. On the **creation-detail page**, on load: if query param `from` is present and is a valid creation ID, record the transition **only if not already recorded for this (from, to) in this session** (e.g. check sessionStorage key such as `related_transition_${from}_${to}`; if set, skip; else call `POST /api/creations/transitions` with `{ from_created_image_id: from, to_created_image_id: currentCreationId }`, then set the key). After a successful record, **strip `?from=` from the URL** (e.g. `history.replaceState`) so a refresh does not resend. This keeps the client from spamming and avoids biasing counts on refresh; abuse beyond that (scripted POSTs) is noted in the API contract and may be mitigated later with server-side rate-limiting.

5. **Styling**
   - Put section-specific classes in `public/global.css` if needed; otherwise reuse `.route-card`, `.route-card-image`, `.route-empty-image-grid` etc. from existing explore/creation styles.

---

## Admin UI: Related algorithm

1. **Nav and panel**
   - In `pages/app-admin.html`: add `<a data-route="related">Related</a>` in the nav. Add a content block with `data-route-content="related"` and a container (e.g. `id="related-algorithm-container"` or class `admin-related-page`).

2. **Load and render**
   - In `public/pages/admin.js`: in `handleAdminRouteChange`, add `case "related": loadRelatedAlgorithm(); break;`. Implement `loadRelatedAlgorithm()`: fetch `GET /admin/related-settings`, then render a form with sections: **Signal weights** (content + `click_next_weight`), **Lineage bias** (min slots), **Random injection** (fraction and/or slots per batch), **Batch & candidate caps** (batch_size, candidate_cap_per_signal), **Transition storage** (transition_cap_k, eviction by oldest last_updated), **Transition time** (transition_decay_half_life_days, or transition_window_days for hard window), **Fallback**. Precomputed cap (N) is not in v1—omit or “Coming later.” Each field: label, input (number or checkbox), short description (`.admin-detail`). Use existing admin CSS (`.admin-settings-section`, `.admin-settings-section-title`, `.admin-settings-field`, `.admin-settings-label`, `.admin-settings-input`).

3. **Save**
   - One "Save" button. On click: collect current form values, send `PATCH /admin/related-settings` with body of key/value. Show loading state and success/error message. No full reload required.

4. **Click-next inspect table**
   - On the same Related admin page, below the algorithm form, add a **“Click-next data”** section so admins can watch the transition table grow and change. **API:** Call `GET /admin/transitions?page=1&limit=20` when the Related route loads (or when a “Refresh” control is used). **Table:** Minimal, responsive table. Columns: **From**, **To**, **Count**, **Last updated** (last_updated). Optionally link from/to ids to creation pages or show short titles. Sort by count descending (server-driven). **Paging:** Prev/Next and/or page numbers; update `page` and refetch. **Responsive:** Use a minimal table (e.g. `.admin-table`); on narrow viewports allow horizontal scroll or collapse to a compact list/card layout so it stays usable. Reuse or add minimal admin table styles in `global.css` (e.g. `.admin-table`, `.admin-table th`, `.admin-table td`). Empty state: “No transition data yet. Click related cards on creation detail to record transitions.”

---

## Key files

| Area | File |
|------|------|
| Schema/indexes | `db/schemas/supabase_01.sql` (transition table + indexes) |
| DB adapter | `db/adapters/supabase.js` (selectRelatedToCreatedImage, recordTransition, selectTransitions); `db/adapters/mock.js`, `db/adapters/sqlite.js` (stubs) |
| API route | `api_routes/creations.js` or `api_routes/explore.js` (related + transition record) |
| Admin API | `api_routes/admin.js` (GET/PATCH /admin/related-settings, GET /admin/transitions) |
| Creation detail | `public/pages/creation-detail.js` |
| Explore card ref | `public/components/routes/explore.js` (appendExploreCards, sentinel) |
| Admin UI | `pages/app-admin.html`, `public/pages/admin.js` |
| Thumbnail | `api_routes/utils/url.js` (getThumbnailUrl) |

---

## Default parameter values

Use these for initial policy_knob values (or defaults when key is missing):

| Key | Default | Description |
|-----|---------|-------------|
| `related.lineage_weight` | 100 | Score for lineage (ancestor/child). |
| `related.lineage_min_slots` | 2 | Minimum lineage results in top N. |
| `related.same_server_method_weight` | 80 | Score for same server+method. |
| `related.same_creator_weight` | 50 | Score for same creator. |
| `related.fallback_weight` | 20 | Score for recent published fill. |
| `related.transition_cap_k` | 50 | Max destinations per from_id; when exceeded, evict by oldest last_updated (keep K most recent) so new paths can emerge. |
| `related.transition_decay_half_life_days` | 7 | Half-life in days for time decay when ranking: effective_count = count × 2^(-age_days / half_life). Decay approaches zero but never reaches it—old transitions always contribute a little (decayed signal is better than no signal). Use 0 to disable decay (raw count). |
| `related.transition_window_days` | 0 | If > 0, only use transition rows where last_updated is within this many days (hard window; older rows contribute zero). Ignored if transition_decay_half_life_days > 0. Prefer decay over window so long-tail history still counts. |
| `related.random_slots_per_batch` | 0 | Reserve this many slots per batch for random published items. |
| `related.batch_size` | 10 | Items per request / batch. |
| `related.candidate_cap_per_signal` | 100 | Max candidates per signal before merge. |
| `related.fallback_enabled` | true | Whether to use recent published when needed. |

(Add more keys as you add more tuneables; keep all in admin UI.)

---

## Performance considerations

- **Related API is read-time only (v1).** Every request computes content signals (lineage, same server+method, same creator, fallback) and blends with click-next—no precomputed cache. That means multiple queries or one heavier query per request. **Mitigation:** Rely on the planned indexes; keep `candidate_cap_per_signal` and `batch_size` bounded; implement `selectRelatedToCreatedImage` so that the top-N result is fetched in one or two queries (e.g. get candidate ids + scores in one pass, then single `WHERE id IN (...)` with joins for creation + like/comment counts + profiles). Avoid N+1 when building the response.

- **Seed-based “next batch” is the heaviest path.** When the client sends `seed_ids` with many IDs (e.g. 10), the backend must gather candidates for *all* seeds (content + transitions for each from_id), merge, dedupe, score, and sort. Candidate set size grows with the number of seeds. **Mitigation:** Cap `seed_ids` in the API (e.g. max 10) and keep `batch_size` modest. Reuse a single transition lookup `WHERE from_created_image_id IN (seed_ids)` rather than one query per seed.

- **Transition write and trim.** `recordTransition` does an upsert (cheap). Enforcing the per–from_id cap K means deleting the row(s) with oldest last_updated when a from_id exceeds K rows. **Mitigation:** Trim only when over cap; use a single DELETE with a subquery (e.g. delete rows for this from_id that are not in the set of K rows with most recent last_updated). Optionally trim asynchronously (e.g. background job or queue) so the request returns quickly; (background job) so the write returns quickly. Evicting by recency (not by lowest count) lets new paths emerge.

- **Admin transitions list.** `GET /admin/transitions` with `ORDER BY count DESC` and paging needs an index that supports that sort (e.g. on `count DESC`). An exact `COUNT(*)` for total can be expensive on large tables. **Mitigation:** Index the transition table for the admin sort. For `total` / `hasMore`, consider fetching `limit + 1` rows and inferring `hasMore` from that, and either omit `total` or use an approximate count so the admin list stays fast.

- **Later.** The design's "precomputed related" table (and optionally caching popular related lists) is the right long-term fix for hot paths; v1's bounded caps and indexes keep things acceptable until then.

---

## Future / room to grow

The v1 design is set up so you can evolve without a rewrite:

- **Server-side recording:** Today the client POSTs the transition. The next step is to record the transition **when the server serves the creation-detail request** that includes `?from=` (e.g. in the handler that returns creation by id: if query has from, call recordTransition then return the creation). One request = one transition, no client spam. Keep GET read-only in v1 and add this when you want to harden.
- **Rate-limiting:** Add per-user (or per-IP) rate limits on `POST /api/creations/transitions` when abuse is a concern.
- **Time decay/window:** Already in place (last_updated, decay or window params). You can tune half-life or window without schema changes.
- **Precomputed related:** A job that materializes "top N related per creation" from the transition table (and content signals) gives fast reads; the current schema and time-aware counts are the right input.
- **Learned models:** If you add embedding or sequence models later, the transition table (and optional event stream) is the right training signal; the schema does not block that.

---

## Clarifications (why these choices)

- **Within-signal order: recency.** We sort by `created_at` descending so that among equal-weight candidates we show newest first. Recency avoids a like-count join and keeps the implementation simple; it also favors fresh content for discovery. A “within-tier by likes” option can be added later as a tuneable.
- **Random: fraction vs slots per batch.** The design allows either a fraction of slots or a fixed number per batch (e.g. 1–2). We support both: if `random_slots_per_batch` > 0 we use that; otherwise we use `random_fraction`. So admins can set “2 random per batch” or “10% random” without code changes.
- **Click-next cold start.** At launch the transition table is empty, so ranking is content-only. As users click from one creation to another (e.g. via related cards with `?from=`), we record transitions and blend click-next into the score. No special “cold start” mode is required—the blend formula naturally does nothing when there are no rows for the seed(s).
- **Transition storage cap (K) and eviction.** We expose `transition_cap_k` (max destinations per from_id). When over cap we evict by oldest last_updated (keep K most recently updated), not by lowest count, so new click→view paths can emerge. Precomputed cap (N) is still "later" and can be omitted or "Coming later."
- **Transition time decay/window.** We store last_updated and support transition_decay_half_life_days (exponential decay when ranking) or transition_window_days (hard window). Decay never goes to zero—old transitions always contribute a small positive weight; we never exclude a row from the blend based on age or low effective_count. Small signals (e.g. only a few old transitions) still contribute; they may be outranked by stronger signals, which is fine, but they must not be zeroed out purely due to age. Decay is preferred so long-tail signal is still used. This matches idiomatic practice at scale.
- **Click-next inspect table.** The admin "Click-next data" table includes from, to, count, last_updated (paged) so admins can watch the transition table and see recency. Responsive: table scrolls or stacks on small screens.

---

## Validation

- Open a published creation; scroll past comments; see "More like this" and a grid of related cards. Scroll to bottom; next batch loads automatically. Cards link to other creations.
- Admin → Related: see all parameters; change one, Save; reload creation detail and confirm behavior reflects new value (e.g. lower batch_size → smaller first batch). See “Click-next data” table (paged); when empty, message explains that clicking related cards will fill it; after some clicks, table shows from → to, count with paging.
- Unpublished or failed creation: no related section.
- Logged-out or no auth: related API returns 401; related section can be hidden or not shown for unauthenticated users.
- Click-next: open a creation, click a related card (link has `?from=...`); on the new page, transition should be recorded. After some traffic, related results for that first creation should start to reflect “clicked after this” (if click_next_weight > 0).
