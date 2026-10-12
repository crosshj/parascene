# Plan: Feed sessions with ranked batches

Goal: a feed that never stalls or loops, stays interesting, and is simple to run. Lead with the best of recent, let the archive compete, and allow repeats once they are far enough back.

Scope: the app feed ranking in `server/services/feed/ranking`. WWW keeps its current feed.

Why: hard "seen" exclusion dries up the pools for heavy viewers (oceanman has seen 5,734 of 5,984 published). Relaxed pages then redraw the same top items. The stopgap added on 2026-10-10 (session served set plus a newest-to-oldest walk) fixes the stall but adds another layer.

## Model

- Seen is a soft penalty with time decay, never an exclusion. Seen recently ranks low; seen weeks ago ranks a little low.
- Session repeat window: the last ~300 served ids per session are excluded. Older items may return.
- Rank in batches: on page 1, score all candidate sources together (recent, hot, new, newcomer, recent comment, follow, archive) and apply the diversity rules. Store ~200 ordered ids in a Redis session list.
- Pages are slices of the session list. When fewer than one page remains, rank the next batch, excluding only the repeat window.
- The archive is a candidate source with an underseen and quality boost. No separate mode or chronological walk.
- Keep: impressions (50% visible for ~1s), 2 per creator per page, mobile page 1 slot pattern, page 1 fresh per visit or refresh.

## Phase 1: soft seen and repeat window

- Replace the hard seen and liked filters in pool draws with score multipliers (decay by last-seen age).
- Cap the session served set to a rolling window of ~300.
- Remove `relaxFiltersFromPage` and the relaxed pool path.
- Done when: a heavy viewer pages 40+ without stalls or near-term repeats, and page time is unchanged.

## Phase 2: ranked batches in the session list

- Batch builder: one ranking pass yields ~200 ordered ids. Redis list key `feed-beta:session:{userId}:{sessionId}`, TTL 2h.
- Page request: read slice, hydrate rows, refill the batch when it runs low.
- Cursor: session id plus offset in the list (replaces the page-index sentinel cursor).
- hasMore: true while the published catalog is non-empty.
- Delete: `hasMoreThroughPage`, `maxPageIndex`, random page fill retries, the `from_the_past` walk (`fillBetaPageFromPast`, `getOlderThan`), and most of `hasMore.js` and `continuation.js`.
- Done when: page 2+ costs one Redis read plus hydration, and the ranking code is one scoring function plus one batch builder.

## Open questions

- Seen decay curve (half-life ~7 days?) and the multiplier floor.
- Repeat window size (300 items, or time-based like 24h).
- Should likes stay a soft penalty or a hard exclusion?
- Batch size versus freshness: re-rank on refill only, or also after N minutes.

## Related

- Intent: `_docs/PLAN_feed_beta_chatgpt.md` (feed session, diversity, underseen catalog)
- Current architecture: `_docs/PLAN_feed_beta.md`
