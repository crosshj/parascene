# Design: Mobile creation detail (chat shell)

Faster mobile creation viewing in chat shell. Not desktop SPA takeover (yet).

## Problem

- `/creations/:id` is slow: full reload, `loadDeps`, API waterfall before paint.
- Most visits already have feed-card data on the prior page.
- Chat SPA handles feed, explore, creations, doom; detail is still a full page.

## Not doing yet

- Desktop detail inside chat shell (sidebar, 720px lane, canvas — layout would diverge).
- Replacing standalone `/creations/:id` for direct links, share, profile, admin.
- Full detail parity in mobile mount (lineage, publish, landscape, admin → standalone).

## Two mobile modes (keep both)

Video-only doom — feed video tap, vertical snap + autoplay, tail from `/api/feed/doom` (feed video order, site fallback). Existing behavior in `doomScrollMount.js`.

Creation-detail mount — feed card tap (scope TBD), snap hero then scroll, related grid below, grid tap navigates with `?from=`. New `mountMobileCreationDetail`; do not reuse doom pager for related tail.

## Why related is not doom swipe

Recsys uses click transitions (`/creations/:to?from=:current` → `POST /api/creations/transitions`). Doom swipe is in-place — no nav, no `?from=`, no signal. Grid taps must navigate.

## Creation-detail mount UX

One scroller, two regimes.

Hero: ~full viewport, scroll-snap (`proximity` on container; hero `min-height: 100dvh`, `scroll-snap-align: start`, `scroll-snap-stop: always`). Open on snap 0 from feed. Seed from feed item; revalidate `GET /api/create/images/:id` in background. Title, author, likes, caption; muted video on hero when video. Link to standalone detail for heavy UI.

Below hero: related grid, normal infinite scroll, same sentinel pattern as `initRelatedSection`. No nested scroll inside hero. Optional hint that more is below.

Related: `GET /api/creations/:id/related` (same paging as desktop). Tap → same mount, new id, `?from=` + transition POST. Back behavior TBD (scroll restore vs hero-only).

## Desktop

Unchanged. `/creations/:id` full page. Doom on desktop already bails to standalone (`navigateWithinChatShell`).

## Today in code

- Mobile feed video → doom via `resolveFeedLaneVideoToDoomHref` in `src/chat/chatPage.js`.
- Feed image → full page `/creations/:id`.
- Related: `initRelatedSection`, `recordTransitionFromQuery` in `public/pages/creation-detail.js`.
- `fetchCreationEmbedPayload` cache in `userText.js` lost on full navigation.

## Rejected as primary path

- sessionStorage seed on standalone page (still pays reload).
- Doom tail wired to related API (wrong UX + transitions).

## Open

- Feed only or explore / creations lanes too?
- Video cards: doom only or also detail mount?
- Images in doom vs detail mount only (`createDoomSlideElement` is video-centric).
- Grid tap: push history per creation vs replace?
- URL in mount: `/creations/:id` via chat shell or `/chat/...`?
- Full detail link placement.

## v1

- Mobile feed tap → `mountMobileCreationDetail`, pass feed seed.
- Snap hero + related grid, shared related logic with detail page.
- Grid tap → same mount, `?from=`.
- Standalone detail for full page + all desktop.
- Doom unchanged for mobile feed video.

## Build notes

- New mount module, not `doomScrollMount.js`.
- Extract or share related fetch/render with `creation-detail.js`.
- CSS: one scroller; name hero vs related regions in code for clarity.

## Key files

- `src/chat/chatPage.js`
- `src/chat/feed/doomScrollMount.js`
- `src/chat/feed/doomFeedData.js`
- `public/pages/creation-detail.js`
- `api_routes/creations.js`
- `public/shared/feedCardBuild.js`

## Deferred

- Desktop SPA detail.
- sessionStorage seed on standalone.
- Prefetch detail API on card hover.
