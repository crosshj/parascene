# Plan: Feed [beta]

Status: v0 shipped. Optional polish and post-v0 pools/editorial landed in code. Remaining defer items need new DB tables and/or client impression beacons.

Opt-in via `user.meta.feedBetaEnabled`. `GET /api/feed` uses `pullFeedBetaRows` when `canAccessFeedBeta` (opted in and not `forceLegacyFeed`). Same URLs/UI; legacy path unchanged for everyone else.

## Shipped (v0 + follow-up)

API / pull

- Ranked pools: hot_24h, hot_7d, new, newcomer, recent_comment, own_activity, catalog_unseen, catalog_relaxed (page 5+), follow_sprinkle, fill, db_random_fallback
- Mobile chat `#feed` page 1: 21-slot editorial draw (`mobileSlotPack.js`) — per-slot pool + media type with fallbacks (replaces site_video_head for beta slot-pack)
- Wider catalog fetch limits in `params.js`
- Blog post merge on beta app Home `/feed` page 1 (parity with legacy; still skipped on chat slot-pack page 1)
- `feed_beta_why.label` friendly pool labels + why modal label line
- Newcomer pool limitation documented in `reason.js`
- Viewport impressions: `prsn_user_creation_seen` + `POST /api/feed/impression` + client beacons on feed cards (beta only); pool exclusion reads DB + legacy `meta.feedBetaSeen`

UI

- Admin opt-in, nav `[beta]`, force legacy feed (enrolled only), why modal

Tests: `npm test -- test/feedBeta`

## Post-v0 defer (needs external work)

- `feed_events`, `creation_stats` rolling windows, Bayesian hot scoring
- Feed session: precomputed ordered ID list per visit (Redis or Postgres + TTL)
- Admin tuning UI for `feed_beta.*` policy knobs
- Publish/like hooks to refresh stats; taste vectors; prune job for stale `prsn_user_creation_seen` rows

## Key files

- Pull: `api_routes/feedBeta/pullFeedBetaRows.js`, `pools.js`, `mobileSlotPack.js`, `mergeBetaPage.js`, `catalog.js`, `hasMore.js`, `randomFallback.js`, `creatorCap.js`, `reason.js`, `seen.js`, `params.js`
- Assembly: `api_routes/feed/resolveFeedAssemble.js`
- Catalog DB: `db/feedBetaSitewideCatalog.js`
- UI: `public/shared/feedBetaWhyModal.js`, `feedBetaNav.js`, `feedCardBuild.js`

## Reference

Aspirational spec: `_docs/PLAN_feed_beta_chatgpt.md`
