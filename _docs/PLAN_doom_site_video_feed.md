# Plan: site-wide video timeline (doom + spotlight)

## Goal

- One global timeline: all published videos on the platform (no follow filter)
- Sort: `feed_items.created_at` DESC, `created_image_id` DESC
- Doom: start at anchor; never show videos newer than anchor; scroll = older only
- Mobile spotlight: first N rows of that same timeline (as if anchor = newest site video)
- Chat `#feed` tail: followed mixed feed only (unchanged); images between spotlights still followed
- Explore: do not change routes or behavior
- No backwards compat: remove doom-via-`/api/feed?creation_media=video` and `getVideoFeedPage`

## Not in scope

- Explore refactors
- Desktop doom routing (unless already broken — fix only if touched)
- New spotlight UI; only data source changes

## Architecture

### Shared DB (one query family)

`selectFeedItems.getSitePublishedVideoFeedPage(viewerId, opts)`

- `mode: head` — newest `limit` videos (spotlight slot-pack head)
- `mode: from_anchor` — `startCreationId`: anchor row + fill with strictly older videos
- `mode: older_than` — `afterCreatedAt` + `afterCreatedImageId` (or resolve from `afterCreatedImageId` only)

Filters (same spirit as feed today):

- `media_type = video`
- published / not `unavailable_at`
- NSFW per viewer `enableNsfw`

No follow join. No explore exclusion.

Reuse comparator from `feedRowIsStrictlyOlderThanCursor` / slot-pack cursor helpers where possible.

### HTTP

**`GET /api/feed/doom`** — doom client only

- Mount: `?start={created_image_id}&limit=`
- More: `?after_created_image_id=&limit=` (server resolves `created_at`)
- Response: `{ items, hasMore, cursor }` — feed-shaped creation rows via existing transform/enrich

**`GET /api/feed`** — chat feed client only

- Slot-pack page one: video head calls `getSitePublishedVideoFeedPage` `mode: head` (replace followed video query in `getLatestFeedSlotPackHead`)
- Tail: keep `getPageAfterImageCursor` on followed feed
- Cursor boundary: still derived from oldest head video + oldest head image (videos global, images followed)

### Client

- `doomScrollMount.js` → `/api/feed/doom` only
- `feedChannelData.js` / slot-pack pager → `/api/feed` only
- new `src/chat/feed/doomFeedData.js` — mount + loadMore wrappers

## Delete (no compat)

Files:

- `src/chat/feed/doomOrderCore.js`
- `api_routes/feed/pullVideoFeedRows.js`

Code paths:

- `getVideoFeedPage` — supabase, sqlite, mock
- `/api/feed` branch: `creation_media=video`
- `feedChannelData` `videosOnly` option
- Doom: `feedAccumulated`, anchor-hunt loop, trim/merge/dedupe, `/api/feed` append, offset paging
- Doom: `/api/creations/:id/summary` fallback (unless anchor missing / deleted — optional minimal 404 UX)

## Phases

### 1 — DB + doom API

- Implement `getSitePublishedVideoFeedPage` in supabase (reference impl)
- Add `api_routes/feed/doom.js` (or `pullDoomFeedRows.js` + route in feed router)
- Register route on app
- Unit tests: head order; from_anchor includes anchor, no newer; older_than no gaps/overlaps; NSFW off

### 2 — Doom client

- `doomFeedData.js` + wire `mountChatDoomScroll`
- Mount: one request → render slides → scroll to anchor (index 0)
- IO / idle prefetch: `after_created_image_id` from last slide or response `cursor`
- Remove deleted imports and feed pager usage
- Manual: open from feed card, spotlight, mid-list; scroll tail no skips

### 3 — Spotlight head

- `getLatestFeedSlotPackHead`: videos via `mode: head`; images query unchanged (followed)
- Verify spotlight[0] matches newest site video; tail still followed-only
- Manual: mobile `#feed` load + load-more

### 4 — sqlite + mock

- Same `getSitePublishedVideoFeedPage` contract
- Drop `getVideoFeedPage` from both

### 5 — cleanup

- Grep for `creation_media=video`, `getVideoFeedPage`, `videosOnly`, `doomOrderCore`
- Remove dead comments in `doomScrollMount` about `/api/feed` offset bursts

## Done when

- Doom never calls `/api/feed` or `creation_media=video`
- Feed client never calls `/api/feed/doom`
- Spotlight videos are site-wide; chat tail is followed-only
- No `getVideoFeedPage` in repo
- Doom pagination is cursor-only
- Offset skip bug class gone for doom

## Risks / notes

- Slot-pack cursor: global video head + followed image head — confirm tail doesn’t duplicate spotlight videos (dedupe by `created_image_id` in tail if needed)
- Large `feed_items` table: cursor + limit; avoid offset
- `doomScrollMount.js` stays large (playback/UI); expect ~200–350 lines removed there, not half the file
