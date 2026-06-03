# Plan: Feed [beta] (chat SPA only)

Ranked discovery feed for chat **`#feed-beta`**. Opt-in only. **Do not regress chat `#feed` or legacy app feed** — same cards, same mobile spotlight layout, better source and ranking.

## Principle: only make it better

Keep from chat `#feed` today

- Full feed cards: video autoplay, images, group carousel, likes, hide, NSFW
- `assembleFeedItems`: tips, blog, challenge engagement on page 1
- Mobile: `partitionChatFeedMobileAlternating` — slots are **video vs non-video**, not follow graph
- Infinite scroll pager pattern (`createPseudoColumnPager` + load-more tail)

Improve in beta only

- Discovery: hot, new, catalog unseen, newcomer + mention boost, small follow sprinkle
- No Explore-style “hide authors you follow”
- Refresh can resample page 1; seen dedupe
- **Two-thread sampler** (video / other) so mobile spotlights always have a video supply

Do not change

- Chat **`#feed`** — still `/api/feed`, server slot-pack + cursor as today
- Legacy **`app-route-feed`** — still `/api/feed`
- Doom scroll, explore, recsys related

## Surface scope

In

- Pseudo-channel **`feed-beta`** (`/chat/c/feed-beta`)
- `GET /api/feed-beta`
- Sidebar **Feed [beta]** when `feedBetaEnabled`

Out

- App shell feed route, app nav
- Replacing `#feed` for everyone
- Beta `slot_pack`, `feed_cursor`, `feed_after_*` (no server slot-pack for beta)

## Architecture

```
GET /api/feed-beta
  → sampleVideoThread()     ─┐
  → sampleOtherThread()     ─┼→ mergeBetaPage() → rows
  → hydrate ids             ─┘
  → assembleFeedItems({ feedSurface: 'chat' })
  → { items, hasMore }

GET /api/feed  →  unchanged (#feed + legacy)
```

Chat client

```
#feed       →  /api/feed, mobileChatSlotPack: true (unchanged)
#feed-beta  →  /api/feed-beta, mobileChatSlotPack: false
              →  offset pagination only
              →  initial mobile: partitionChatFeedMobileAlternating(ordered)
              →  load-more: plain card append (same as #feed tail)
```

Reuse server interleave helper only (not slot-pack pull):

- `interleaveSlotPackHead` from `pullMobileChatSlotPackFeed.js` — merge video + other **samples** into one ordered list for the page (4v+3i × 3 head budget optional on page 1; remainder = tail in feed order)

## Two-thread algo (core)

Two ranked streams, same rules in each:

| Thread | Contents |
|--------|----------|
| **Video** | `media_type === 'video'` + valid `video_url` |
| **Other** | Image (and non-video) creations eligible for feed cards |

Not in threads: tips, blog, engagement — injected by `assembleFeedItems` after merge on `offset === 0`.

Per thread, same pool draws (counts tunable via `feed_beta.*`):

- hot (24h / 7d)
- new publish
- newcomer (author **or** @mentions newcomer — `textMentions.js`)
- catalog unseen (minus `seen`)
- follow sprinkle (small; fallback if no follows)
- score bumps: newcomer_author, newcomer_mentioned (mention slightly less), follow_author ~10%, freshness

**No** excluding followed user ids from any pool.

### Read path: pull both, merge

1. Sample `V` ids from video thread, `O` ids from other thread (separate offsets on load-more: `video_offset`, `other_offset`, or one page budget split).
2. Hydrate both; preserve per-thread order.
3. **mergeBetaPage**:
   - Page 1 mobile-friendly: `interleaveSlotPackHead(videos, others)` for structured prefix (matches 3× 2×2 + between strips), then append tail from remaining video+other in round-robin or thread order.
   - Desktop or simple mode: interleave lightly or video chunk + other chunk; client partition still works.
4. `refresh=1` (page 1 only): resample both threads; do not use image feed_cursor.

### Why two threads

- Matches mobile slots (video vs not) in the **engine**, not by accident in one shuffle.
- Avoids empty spotlight grids when the catalog is image-heavy.
- Tune “more hot video” vs “more newcomer images” independently.

## Per user

- `seen` — don’t repeat in `#feed-beta`
- Optional prebuilt queue later; v0 sample at request is OK at 13k scale
- Taste / semantic later (optional tail on either thread)

## Full parity (cards)

- Merged rows → `{ rows, hasMore, isNewbieFeed }` → `assembleFeedItems` + `pullChallengeFeedSnapshot` when `offset === 0`
- Same JSON shape as `/api/feed` for chat pager
- `feed_surface: 'chat'`

## API surface

- `GET /api/feed-beta?limit=&offset=` (and/or `video_offset` + `other_offset` if split)
- `?refresh=1` — resample both threads for page 1
- Auth + `feedBetaEnabled` meta opt-in only
- **No** `slot_pack`, **no** `feed_cursor` on beta

## Mobile slots (no cursor slot-pack)

- Server: two threads + merge (optional `interleaveSlotPackHead` on page 1 prefix)
- Client: **`partitionChatFeedMobileAlternating`** on first paint — same as `#feed`, include `feed-beta` in lane checks beside `feed`
- Load-more: append cards only; no re-partition (same as `#feed`)

## At publish / on engagement

- Publish: pools, newcomer flags on creation meta, thread membership (video vs other)
- Like / view in beta: bump hot pools, `seen`; `feedBeta/hooks.js` one-liners from create/likes (v1b OK)

## Tuning (policy_knobs `feed_beta.*`)

Worth admin later (mirror `related.*`); v0 defaults in code.

- Per-thread slot counts (hot, new, newcomer, catalog, follow)
- `newcomer_account_days`, multipliers (author vs mentioned, follow nudge)
- Page 1 interleave prefix on/off or length
- Not admin: 4v+3i geometry (`chatFeedMobilePartition.js` constants)

## Small footprint

- All beta logic: `api_routes/feedBeta/`
- Reuse: `assembleFeedItems`, `interleaveSlotPackHead`, `textMentions`, `selectFeedItemsByCreationIds`, `partitionChatFeedMobileAlternating`, `feedCardBuild.js`
- Chat: `apiPath` param + `feed-beta` lane; **no** fork of card DOM
- **No** edits to `pullMobileChatSlotPackFeed` behavior for `#feed`

New modules (target)

- `index.js` — router, gate
- `pools.js`, `newcomer.js`, `seen.js`
- `sampleVideoThread.js`, `sampleOtherThread.js`
- `mergeBetaPage.js` — interleave + tail
- `pullFeedBetaRows.js` — orchestrate
- `hooks.js`

## Files touched

Backend — new: `api_routes/feedBeta/*` (above)

Backend — edit: `api/index.js`, `api_routes/user.js`, `api_routes/admin.js`; optional `likes.js` / publish hook

Chat — edit: `feedChannelData.js`, `chatPage.js` (feed-beta lane + mobile partition branch), `chatSidebarRoster.js`; maybe `chatViewportShellSync.js`, `pages.js` route allowlist

Admin: opt-in toggle (API-first OK)

Tests: `feedBeta.merge.test.js`, `feedBeta.threads.test.js` (slot mix, newcomer, no follow exclusion)

Do not touch: `feed.js` app route, `app.html`, app nav, `api_routes/feed.js`, `#feed` pager slot-pack config, `recsys.js`

## Rollout

1. Two-thread sample + merge + `/api/feed-beta` + tests
2. Chat `#feed-beta` + opt-in + mobile partition (no beta slot_pack)
3. Seen + refresh
4. Publish/like hooks + policy knobs

## Open questions

- Newcomer N days / follower threshold
- Split offsets vs single offset with fixed V/O ratio per page
- Empty beta: fallback `isNewbieFeed` vs custom copy
- Page 1 always interleave prefix on mobile, or client-only partition from flat merge
