# Plan: chat feed alternating spotlight / normal

Terse notes. Full rationale was in the Cursor plan export.

## Goal

- Rhythm (mobile chat feed only): one 2×2 spotlight (four videos), then three regular feed cards, repeated. Between three spotlight sections you get three regular items between consecutive grids (not a mistaken larger batch count elsewhere).
- Canonical slice before flat tail: grid → 3 cards → grid → 3 cards → grid → then flat feed (videos allowed as normal cards).
- Mobile: multiple spotlight strips and card chunks in that pattern, matching current visual language (same tiles and cards as today).
- Desktop: flat feed cards only, same order as today, no spotlight grids.

## Stop alternating after three spotlight groups

- After three spotlight grids have been placed down the page (three blocks of four videos each), stop carving videos into spotlight strips.
- Everything below that threshold renders as the existing flat feed cards, including video creations (same card chrome as today, no duplicate rows).
- Implement as part of the partition pass: a counter for spotlight groups completed; once it reaches three, the rest of the ordered list is emitted as a single flat tail (no further spotlight chunks).

Note on counts: three 2×2 grids use twelve feed rows as spotlight videos (3×4). With three regular cards between consecutive grids only, that is two normal chunks (3+3 = six rows), not nine. If you later want a third chunk of three after the last grid before the flat tail, say so; partition rules would use nine normal-slot rows instead.

## API / cache

- Leave GET /api/feed flat with offset and limit. Do not reshape the stream on the server for v1 so main app feed and paging stay valid.
- version_feed knob and service worker feed invalidation stay as-is. Layout is presentation only; no new version key.

## Data flow

pseudoColumnPager getItems returns one flat ordered list (newest first). Partition turns that list into an ordered sequence of segments (spotlight groups of four videos, normal groups of three rows, then flat tail after cap). feedChannelView walks segments and builds DOM: repeat spotlight strip plus route-cards chunk per cycle; desktop skips spotlight and flattens to one card column in API order.

## First page size (open)

- Today chat feed uses FEED_CHANNEL_PAGE_SIZE (20) from feedChannelData.js with createPseudoColumnPager and createChatFeedFetchPage.
- To paint the full ribbon you need twelve spotlight-eligible videos plus six normal-slot rows (two groups of three between three grids), eighteen rows if types line up; feeds mix tips and images so fetch size may need to be higher than eighteen or you accept partial strips until more loads.
- Earlier mistaken arithmetic (for example thirty-six) does not apply; this layout is three four-video grids and two three-card gaps unless you add a third normal chunk after the third grid.

## Partition

Pure function in feedCardBuild (extends or replaces today’s partitionFeedVideosForChatSpotlight which only peels the first four videos).

- Inputs: ordered items, max spotlight groups (3), sizes four and three, predicates for video spotlight vs normal slot.
- Walk in feed order. Spotlight chunk: next four rows that pass isFeedRowVideoCreation. After spotlight groups one and two only, take a normal chunk of three before the next spotlight. After spotlight group three, go straight to flat tail (no third normal chunk unless product decides otherwise).
- Normal chunk: next three rows that match the normal rule (still open).
- Stop after three spotlight groups; append all remaining items as flat tail (videos allowed).
- Nothing consumed in spotlight may appear again below.

Open decision: normal means either any non-video row (tips, blog, engagement, images) or only non-video creations with separate rules for tips and blog.

Partial chunks ok when fewer than four videos or fewer than three normals before the cap.

## Frontend adaptation (concrete)

Today:

- loadFeedChannelMessages in chatPage.js builds one routeWrap via createChatFeedChannelElements with a single spotlight from partitionFeedVideosForChatSpotlight(ordered, 4) and one cards column for remainingItems.
- loadMoreFeedLanePseudoChannelMessages appends new cards only; spotlight never updates.

Changes:

- Replace single peel with segment-aware partition (above). Desktop branch: render ordered list as today’s flat cards only (no spotlight nodes), preserving scroll-append behavior for load more.
- Mobile branch: createChatFeedChannelElements becomes segment-driven (multiple spotlight wrappers plus cards sections interleaved), or a small builder loops segment types and appends the same primitives already used (createChatFeedMobileSpotlightElement, createFeedItemCard). Reuse existing classes so look stays as now.
- Initial load: after pager.loadInitial, run partition on full ordered list, build DOM from segments.
- Load more: pseudoColumnPager still appends to its flat list; mobile must rebuild the feed column from pseudoColumnPager.getItems() so new items can insert new spotlight strips and re-split correctly, or use a more complex incremental strategy (v1 favors full rebuild from list for correctness).
- feedChannelView.js: extend createChatFeedChannelElements or add a sibling that accepts segment arrays instead of one spotlightVideos + one ordered card list.
- Optional: separate initial pageSize for feed channel only so first response often fills three cycles (see First page size).

Files:

- src/shared/feedCardBuild.js (partition; mirror public/shared/feedCardBuild.js if required by repo convention)
- src/chat/feed/feedChannelView.js
- src/chat/chatPage.js (loadFeedChannelMessages, loadMoreFeedLanePseudoChannelMessages for feed lane)
- src/chat/feed/feedChannelData.js (page size tuning for initial fetch only if adopted)
- public/global.css (spacing between repeated spotlight blocks; mobile-only rules already in place)

## Load more

Current load more only appends cards and does not rebuild the top spotlight. Alternating layout plus three-group cap requires either rebuild-from-full-list on mobile after each older fetch or a careful incremental layout (harder).

## Checklist

- No duplicate items across segments.
- After three spotlight groups, videos only appear as normal cards below.
- Desktop has no spotlight chrome and preserves flat API order.
- Sentinel and infinite scroll still work.
- Skeleton states if multiple strips during load.

## Todos

- Pick normal predicate.
- Add segment partition helper (max three spotlight groups, alternating four + three, flat tail) in feedCardBuild and mirror public copy if needed.
- feedChannelView segment builder plus desktop flat branch.
- chatPage wiring for initial build and loadMore rebuild or incremental strategy.
- Tune FEED_CHANNEL_PAGE_SIZE or initial-fetch strategy if needed.
- CSS for repeated spotlight spacing.
- Sanity check SW and version_feed unchanged.
