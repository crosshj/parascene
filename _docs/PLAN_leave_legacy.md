# Plan: stop using _legacy

The running server and client do not import `_legacy`. What still reaches into it is maintenance scripts, plus one comparison test. The deploy package excludes `_legacy`, so those scripts only run from a full checkout.

Blog and help are separate from that import list. Blog still exists only in `_legacy`. Help already runs from this app.

## Blog

Port the public blog onto this app. Today `_legacy/api_routes/blog.js` renders HTML:

- `GET /blog` reads `_legacy/pages/blog/index.md` and fills `{{BLOG_POST_LIST}}`.
- `GET /blog/{slug}` is the canonical post. `GET /blog/{campaignId}/{slug}` is a tracked campaign link. A view is recorded for database posts.
- Published posts merge markdown files under `_legacy/pages/blog/` with `selectPublishedBlogPosts`. The same slug prefers the database row. Production caches that list for 60 seconds.
- `?preview=1` shows a draft to a signed-in admin or that post's author.

Also port the editor and admin API in `_legacy/api_routes/blog_admin.js` (`/api/blog/...`: list, create, patch, delete, publish, archive, campaigns). The editor page is `GET /create/blog/:id`. `pullBlogFeedItems` puts published database posts on the first feed page. File-only posts are not in that feed.

`scanBlogDirectory` in `_legacy/lib/blog/parseAndScan.js` is only used by the blog pages and `scripts/backfill/migrate-blog-to-db.mjs`.

## Help

Help is already served by `server/routes/help.js` from `server/pages/help` (`/help`, `/api/help`, `/api/help/search`). It is not read from `_legacy`.

Open question: move those pages to the repo root instead of leaving them under `server/pages`.

## Scripts that still import _legacy

`openDb()` from `_legacy/db` stays because these scripts call the old query catalog. `createDb()` and `createSupabaseContext()` are a different object. They do not expose the same methods (`selectCreatedImageByIdAnyUser`, `selectCompletedVideoCreationsForPosterBackfill`, `selectUsers`, the email-campaign queries, and the rest).

- `scripts/backfill/backfill-video-first-frame-posters.js`
- `scripts/backfill/backfill-audio-covers.js`
- `scripts/backfill/backfill-audio-clips-from-share-audio.js`
- `scripts/backfill/repair-video-creation-metadata.js`
- `scripts/backfill/migrate-blog-to-db.mjs` (also `scanBlogDirectory`)
- `scripts/debug/compare_grouped_vs_regular_creation.js`
- `scripts/debug/debug-google-photos-auth.js`
- `scripts/monitoring/debug-first-creation-nudge.js`
- `scripts/monitoring/debug-signup-onboarding.cjs` (`_legacy/db/supabase.js`)
- `scripts/analytics/overview-refresh.js` (also `getNotificationDisplayName`)
- `scripts/analytics/feed-beta-catalog-rebuild.js` (also the rebuild job below)

Jobs that were never ported:

- `runVisitPulseFlush` (`_legacy/api_routes/utils/visitPulseFlush.js`), called by `scripts/analytics/visit-pulse-flush.js`. Day-key math already lives in `server/services/feed/visitPulse.js`. The Redis-to-database flush does not. This is the same job the QStash schedule posts to `/api/worker/jobs`.
- `runFeedBetaCatalogRebuild` (`_legacy/api_routes/feedBeta/catalogRebuild.js`), called by `scripts/analytics/feed-beta-catalog-rebuild.js`. The new server can drop a catalog snapshot. It does not rebuild one. This is the other `/api/worker/jobs` schedule.
- `getNotificationDisplayName` (`_legacy/api_routes/utils/displayName.js`), called by the overview refresh. The new app formats names with `formatWhoLabel` in `server/services/feed/whoMeta.js`, which is a different helper.

## Test

`test/messages-presentation-parity.test.js` reads `_legacy` message source and chat CSS on purpose, to compare them with the port. It is not part of the running app.

## Done already

Utility imports in the other scripts now call `server/services` and `client/shared` (audio covers and clips, thumbnails, letterboxing, avatars, hero previews, styles, feed version, visit-pulse day keys, challenge parsing). The payout type comment points at `client/shared/challenges/model/ranking.js`.
