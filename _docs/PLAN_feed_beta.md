# Plan: Feed [beta]

Status: course-corrected — Redis hot path for seen + shared catalog snapshot. No Postgres seen table.

Goal: fast first pages that feel alive; short memory (seen TTL ~30d); no long analytics history on the feed path.

Opt-in via `user.meta.feedBetaEnabled`. `GET /api/feed` uses `pullFeedBetaRows` when `canAccessFeedBeta`.

## Architecture

**Shared catalog (all users)**

- QStash every 15 min: `feed_beta_catalog_rebuild` → hydrates recent/hot/back_pool/video_head once → Redis key `feed-beta:catalog:v1` (20 min TTL)
- `GET /api/feed` reads snapshot from Redis; slices back pool by page seed in memory
- Fallback: smaller live DB pull if Redis miss
- Per request: one batch `likes_created_image` query for `viewer_liked` on catalog ids only

**Seen (per user)**

- Impression batch → Redis SET `feed-beta:seen:{userId}` + 30d TTL (no Postgres)
- Feed read merges Redis seen + legacy `meta.feedBetaSeen` (cap 400)
- Liked exclusion uses existing likes table, not rollup columns

**Not on hot path**

- Postgres seen rollup removed (Redis only)

## Ops

- Redis: same Upstash env as visit pulse (`UPSTASH_REDIS_REST_*`)
- First deploy / after cold start: `node scripts/analytics/feed-beta-catalog-rebuild.js`
- Schedules: `node infra/qstash/sync.cjs --only parascene-feed-beta-catalog-rebuild`

## Key files

- Catalog: `api_routes/feedBeta/catalogSnapshot.js`, `catalogRebuild.js`, `catalog.js`
- Seen: `api_routes/feedBeta/seenRedis.js`, `seen.js`
- Impressions: `public/shared/feedImpressionBeacon.js`
- Worker: `api/worker/jobs.js`

## Deferred

- `feed_events`, `creation_stats`, Bayesian scoring
- Feed sessions (stable page 2+ ordered list in Redis)
- Admin tuning UI for pool knobs

## Reference

`_docs/PLAN_feed_beta_chatgpt.md`
