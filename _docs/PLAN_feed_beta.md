# Plan: Feed [beta]

Status: core backend + most correctness work shipped. Remaining: one integration test, device QA on mobile spotlight, manual sign-off, optional polish.

Opt-in via `user.meta.feedBetaEnabled`. `GET /api/feed` uses `pullFeedBetaRows` when `canAccessFeedBeta` (opted in and not `forceLegacyFeed`). Same URLs/UI; legacy path unchanged for everyone else.

## Done means

Beta user gets a discovery feed that:

- Uses ranked pools (not a flat catalog shuffle)
- Keeps mobile 4v+3i×3 slot-pack with working spotlight videos
- Reshuffles page 1 on open; page 2+ scrolls without breaking session logic
- Dedupes via `feedBetaSeen` (API-served IDs) + excludes liked items from pool draws
- Deep scroll (page 5+): relaxed seen/liked filters; `hasMore` stays true through page 5
- Under-filled pages backfill from random DB slice (`db_random_fallback`)
- Max 2 creations per author per page (slot-pack head exempt from cap pass)
- Each card has honest `feed_beta_why`; modal does not claim viewport/impression “seen”
- Beta user can force classic feed via Settings → Force legacy feed (`meta.forceLegacyFeed`)
- Passes `npm test -- test/feedBeta` + manual QA below

Not in v1 done: viewport impressions, analytics tables, Redis feed sessions, 21-pool mobile editorial, comment/reply pools, Bayesian scoring, admin tuning UI, publish/like hooks.

## Shipped

API / pull

- `/api/feed` branch → `api_routes/feedBeta/*` + `assembleFeedItems`
- Access: `feedBetaEnabled`; opt-out `forceLegacyFeed` (`access.js`, profile PATCH, nav respects effective beta)
- Pools: hot_24h, hot_7d, new, newcomer, catalog_unseen, catalog_relaxed (page 5+), follow_sprinkle, fill, site_video_head, db_random_fallback
- Two threads → `mergeBetaPage` + slot-pack interleave
- Catalog batch: recent + engaged + back slice + video head; random fallback when merge under-fills
- `feedBetaSeen` persisted before response (cap 400); page-token cursor for chat load-more
- Creator cap: `creatorCap.js`, `maxCreationsPerAuthorPerPage: 2`
- Pagination: `hasMoreThroughPage: 5`, `relaxFiltersFromPage: 5`, `maxPageIndex: 40`
- Liked rows treated as seen for pool filtering (`seen.js`)

UI

- Admin opt-in toggle (`app-modal-user`)
- Nav `[beta]` labels when effective beta active (`feedBetaNav.js`)
- Settings → Force legacy feed (beta participants only)
- Card menu → “Why am I seeing this?” (`feedBetaWhyModal.js`)

Tests (run `npm test -- test/feedBeta`)

- access (incl. forceLegacyFeed), cursor, merge, score, threads, pools, poolTakes, videoHead, reason, nav, seen, hasMore, pagination/creatorCap, randomFallback
- apiFeed (route-shaped integration), catalog (sitewide vs explore), followSprinkle, requirements, goldenPath, prodCatalog

## Open (do in order)

1. ~~Integration test — `GET /api/feed` beta branch~~ — `test/feedBeta.apiFeed.test.js` (route helper + mocks; not HTTP supertest).

2. Mobile spotlight QA — beta user, chat `#feed`, `slot_pack=mobile_chat_v1` page 1: three 2×2 video strips filled (not skeletons). Fix in `pullFeedBetaRows` / video head path if red.

3. Manual QA — run checklist below; fix anything red.

Optional polish (not blocking done)

- Friendly pool labels in why modal (map `developer.pool` → “Rising today”, etc.; today modal shows summary + dev JSON)
- Widen catalog candidate limits in `params.js` if feed feels repetitive despite random fallback
- Document newcomer pool limitation in `reason.js` or plan (authors only from current catalog batch + account age)

## Manual QA

Beta user unless noted. Chat `#feed` and app Home `/feed`.

- Page 1 order changes on refresh
- Page 2+ appends; no duplicates from page 1
- Infinite scroll past page 5 (hasMore does not stop early)
- Mobile: three 2×2 video strips populated
- Hot/new near top; follow sprinkle occasional, not dominant
- ⋮ → “Why am I seeing this?” — honest copy, developer block present
- Settings → Force legacy feed ON → classic follow feed, nav drops `[beta]`; OFF → beta feed returns
- Admin disables `feedBetaEnabled` → legacy feed; force-legacy toggle hidden
- NSFW off still filters; cards match legacy shape (video, groups, tips, challenge card page 1)

## Key files

- Pull: `api_routes/feedBeta/pullFeedBetaRows.js`, `pools.js`, `mergeBetaPage.js`, `catalog.js`, `hasMore.js`, `randomFallback.js`, `creatorCap.js`, `reason.js`, `seen.js`, `params.js`
- Catalog DB: `db/feedBetaSitewideCatalog.js`
- Access: `api_routes/feedBeta/access.js`
- API route: `api_routes/feed.js` (beta branch + await `updateUserFeedBetaSeen`)
- Transform: `api_routes/feed/transformFeedCreationRow.js`
- Profile: `api_routes/user.js` PATCH `forceLegacyFeed`; `public/components/modals/profile.js`
- UI: `public/shared/feedCardBuild.js`, `feedBetaWhyModal.js`, `feedBetaNav.js`
- Admin opt-in: `public/components/modals/user.js`, `api_routes/admin.js`

## Post-v1 defer

- Viewport impression beacons + `user_creation_seen`
- `feed_events`, `creation_stats` windows, better hot scoring
- Feed session: precomputed ordered ID list per visit
- Pools: recentComment, ownActivity
- Per-slot mobile 21-pool editorial + fallbacks
- Publish/like hooks; `feed_beta.*` policy knobs; taste vectors

## Reference

Aspirational spec (not v1 done bar): `_docs/PLAN_feed_beta_chatgpt.md`
