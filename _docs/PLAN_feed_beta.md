# Plan: Feed [beta] — finish to done

Backend swap on `GET /api/feed` when `user.meta.feedBetaEnabled`. Same URLs/UI. Legacy path unchanged for everyone else.

## Done means

Opt-in users get a discovery feed that:

- Uses ranked pools (not a flat shuffle of the catalog)
- Keeps mobile 4v+3i×3 layout with working spotlight videos
- Reshuffles page 1 on open; page 2+ scrolls without reshuffling the session logic we have today
- Dedupes repeats via `feedBetaSeen` and explains each card via `feed_beta_why`
- Does not lie in UI copy about “seen” or “underseen”
- Passes automated tests + a short manual QA checklist

Done does not mean: viewport impressions, analytics tables, feed sessions in Redis, per-slot 21-pool mobile editorial, comment/reply pools, own-activity pool, Bayesian scoring, admin tuning UI, or publish/like hooks. Those are post-done.

## Already shipped

- `/api/feed` branch → `api_routes/feedBeta/*` + `assembleFeedItems`
- Pools per page: hot_24h, hot_7d, new, newcomer, catalog_unseen, follow_sprinkle (+ fill)
- Two threads (video / other) → `mergeBetaPage` + slot-pack interleave
- Candidate catalog: recent + top engaged + back slice + video head
- `feedBetaSeen` on serve (cap 400, `user.meta`)
- Page-token cursor for chat load-more
- `feed_beta_why` stamped at pool draw / merge; “Why am I seeing this?” in card menu
- Admin opt-in toggle; nav `[beta]` labels
- Tests: access, cursor, merge, score, threads, pools, videoHead, reason, nav

## Gaps blocking done

1. **Honest “seen / catalog” story** — Today “catalog_unseen” = not in `feedBetaSeen` (server-served IDs), not viewport, not impression-based underseen. Either fix copy in `reason.js` to match behavior, or add minimal impression infra (see phase 2). Until then, do not claim “you have not been shown it.”

2. **Mobile spotlight videos** — Must reliably fill 12 video slots for beta slot-pack page 1 (site video head, no seen filter on spotlight). Verify on device; fix if still empty.

3. **Catalog still feels thin** — Candidate set is ~500 recent + engaged + one random back slice (~300). Most of ~13k never enters the pool. For done: widen fetch limits or pull two back-catalog slices per page so catalog_unseen has real depth.

4. **No creator cap per page** — Same author can dominate a page. For done: max 2 creations per `user_id` per page in `pullFeedBetaRows` or pool draw.

5. **Newcomer detection is narrow** — Only authors in the current catalog batch + account age. For done: acceptable if documented; optional stretch: small cached newcomer id set (account age query, not full exposure model).

6. **Integration test missing** — `GET /api/feed` beta branch returns same keys as legacy + `feed_beta_why` on creation rows.

7. **No manual QA sign-off** — Need one checklist run (below) before calling beta done.

## Do next (order)

### Phase 1 — Correctness (ship blockers)

- [ ] Verify mobile spotlight videos end-to-end (beta user, chat `#feed`, slot_pack page 1)
- [ ] Update `reason.js` user copy: catalog pool = “from your catalog mix — not on your recent Feed [beta] list yet” (or similar); remove “shown” unless we measure viewport
- [ ] Max 2 items per creator per page when merging rows
- [ ] Add integration test: beta `/api/feed` response shape + `feed_beta_why` on sampled creations
- [ ] Run manual QA checklist; fix anything red

### Phase 2 — Flesh out content (still in v1 done)

- [ ] Widen catalog: bump `recentFetchLimit` / `backCatalogFetchLimit` or second back-catalog draw with different seed
- [ ] Map `feed_beta_why.developer.pool` → short user labels (Rising today, New creation, From the catalog, etc.) in modal
- [ ] Document in code comment on `seen.js`: `feedBetaSeen` = served-on-API, not viewport

### Phase 3 — Post-done (explicit defer)

- Viewport impression beacons + `user_creation_seen` table
- `feed_events` (source_pool, position, impression/click/like) for tuning
- `creation_stats` windows (24h/7d) and better hot scoring
- Feed session: precompute ~100–200 ordered IDs per visit
- Pools: recentComment, ownActivity
- Per-slot mobile 21-pool editorial plan + fallbacks
- Publish/like hooks; `feed_beta.*` policy knobs; taste vectors

## Manual QA checklist

Beta user, chat `#feed` and app Home `/feed`:

- Page 1 looks different on refresh (not identical order every time)
- Page 2+ appends without duplicates from page 1
- Mobile: three 2×2 video strips populated (not skeleton placeholders)
- Hot/new items appear near top (not only stale catalog)
- Newcomer / follow items appear occasionally, follows do not dominate
- ⋮ → “Why am I seeing this?” shows pool + developer block
- Toggle off `feedBetaEnabled` → legacy follow feed behavior returns
- NSFW off still filters; cards match legacy (video, groups, tips, challenge card page 1)

## Key files

- Pull: `api_routes/feedBeta/pullFeedBetaRows.js`, `pools.js`, `mergeBetaPage.js`, `catalog.js`, `reason.js`
- Seen: `api_routes/feedBeta/seen.js`, `db/supabase.js` (`updateUserFeedBetaSeen`)
- API: `api_routes/feed.js`, `transformFeedCreationRow.js`
- UI: `public/shared/feedCardBuild.js`, `feedBetaWhyModal.js`
- Params: `api_routes/feedBeta/params.js`

## Reference

External spec comparison: `_docs/PLAN_feed_beta_chatgpt.md` — aspirational; not the done bar for v1.
