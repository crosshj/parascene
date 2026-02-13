# Related Creations – Philosophy, Design, and Decisions

This doc explains the *why* and the main design choices. For step-by-step implementation, see [PLAN_RELATED_CREATIONS.md](PLAN_RELATED_CREATIONS.md).

---

## Why related creations?

The goal is discovery and “doom-scrolling” from a single creation: after viewing one image, the user sees more like it and can keep clicking. The related section is the main lever to get someone to the *next* creation quickly—similar to how YouTube and Netflix surface “next” content.

---

## The “real” algorithm: what do viewers click next?

The algorithm that actually drives “click next” on big platforms is **behavioral**: *what do users who viewed this item go to next?* Not just “similar content,” but “what do people click on after this?”

**Names for this:**

- **Next-item (or successor) recommendation** – recommend items often chosen *after* this one.
- **Session-based / sequential recommendation** – use the sequence of views and clicks in a session.
- **Transition-based (Markov-style)** – from item A, recommend B with highest P(click B | viewed A).
- **Click-through / watch-next** – industry shorthand.

**Implication:** We need **view → next click** data (a transition table of aggregated counts). **Click-next is in v1:** we record transitions from day one and blend them into ranking. At launch there is no transition data, so ranking is purely content-based; as users click through (e.g. from related cards), we record (from_id, to_id) and start blending. Content signals (lineage, same server/method, same creator, fallback) both prime the pump and remain in the blend so lineage and quality stay visible. Transition data is **time-aware** (timestamp per row, decay or window when ranking) so the system behaves like larger platforms and new paths can emerge.

---

## Always bias on lineage (ancestor/child)

Lineage is not only for cold start. **We always keep ancestor/child as a strong bias.** Someone mutating an image is a strong signal they liked the original; children and ancestors are intentionally related. So we give lineage a permanent boost (e.g. minimum slots or score bonus) even when we add click-next, so “mutated from this / this was mutated from” stays visible.

---

## Infinite “related of related” feed

- **First batch:** Related to the *current* creation.
- **Next batches:** Related to the *last batch’s* creations (seed-based). Dedupe so we never show the same creation twice.
- The feed can keep going; each page is “related to these seeds,” not “next page of the same list.” API supports `seed_ids` and `exclude_ids` for this.

---

## Ranking: tuneable weights from v1

- **v1:** We use **numeric weights per signal** (content: lineage, same server+method, same creator, fallback) plus a **click-next weight**. When we have transition data for this creation, we blend: e.g. `final_score = content_score + click_next_weight × click_next_score` (with click_next_score from aggregated “clicked after this” counts). When we have *no* transition data yet—cold start—click-next contributes nothing and ranking is content-only. Within each signal we sort by **recency** (newest first). Lineage gets a **minimum slots** guarantee so it stays visible. At launch, transition data is empty so behavior is content-only; as data accumulates, click-next naturally starts to influence results.

---

## Everything is tuneable

Every value that affects what appears, how it’s ranked, or how much we store is a **named, admin-editable parameter**. No magic numbers in code. We use policy knobs (e.g. `related.*`) and an admin UI so admins can rebalance the algorithm without a deploy. That includes: signal weights, click-next weight, lineage min slots, random injection (fraction or slots per batch), batch size, candidate caps, fallback on/off, transition storage cap (K), transition time decay or window (so recent behavior weighs more), and—when we add precomputed related—precomputed cap (N).

---

## Time-based signals (idiomatic, room to grow)

- **Transition data is time-aware.** We store a timestamp (e.g. `last_updated`) with each (from_id, to_id, count) row. When *ranking*, we treat recent transitions as more important. **Exponential decay** (e.g. effective_score = count × 2^(-age / half_life)) is preferred: it never decays down to zero—old transitions always contribute a small positive amount. A decayed signal is better than no signal at all, so long-tail history still helps. **Small signals must not disappear purely because of age:** we never exclude a transition row from the blend based on age or low decayed weight. A creation with only a few old transitions (e.g. 4) still gets that click-next contribution; it’s fine if other signals (content or stronger transitions) dominate and outrank it, but we don’t zero it out. A **hard time window** (only rows updated in the last N days) does zero out older data; use it only when you explicitly want to ignore the long tail.
- **Eviction by recency, not just count.** When we cap at **K** destinations per from_id, we evict the **oldest** (by `last_updated`) or the row with the **lowest decayed score**, not the row with the lowest raw count. So a new (A, Z) with count=1 and fresh timestamp can replace a stale (A, B) that hasn’t been clicked in a long time. This matches how large systems keep recommendations responsive to recent behavior.
- We do *not* keep every view→click event forever; we aggregate, cap, and let time do the rest.

## Bounded storage: no exponential growth

- For **any given image** we store only a **limited set** of related targets (and optionally weights). No unbounded growth with clicks or views.
- **Click-next (v1):** Store aggregated counts per (from_id, to_id) plus **last_updated**. We count each navigation (user lands on creation B with `?from=A`) as one transition; same user revisiting or refreshing increments the same (A, B) again. Cap at **K** destinations per from_id; when over cap, **evict by oldest last_updated** (or lowest decayed score) so new paths can emerge. So storage is O(creations × K). At first the table is empty; it fills as users click from one creation to another.
- **Precomputed related (later):** At most **N** related rows per creation (admin-tuneable). Job writes top N and replaces. Storage is O(creations × N).

---

## Random injection (exploration)

We sometimes inject **random** items into the feed so the algorithm gets tested. If we only show top-ranked items, we never learn whether other items would have been clicked. Reserving a small fraction of slots (or 1–2 per batch) for random published creations gives us exploration and data to tune weights. This is **exploration vs exploitation**. The fraction (or slots per batch) is admin-tuneable.

---

## Tables

- **v1:** We need a **transition table** for click-next: e.g. `prsn_related_transitions(from_created_image_id, to_created_image_id, count, last_updated)` with unique on (from, to). Aggregated counts with a timestamp so we can apply time windows or decay at read time; capped at K destinations per from_id, evicting by oldest `last_updated` so new paths can emerge. Content signals are computed at read time from existing data (`prsn_created_images.meta` for lineage, server_id, method). Optional: a small **lineage table** for faster lineage lookups.
- **Later (precomputed):** One more table e.g. `prsn_related_creations(created_image_id, related_id, reason, score)` for YouTube-style fast reads. This is not a “big graph”—we have a small lineage DAG and filters; “transitive” is at most one extra hop (related of related).

---

## Summary of decisions

| Decision | Choice |
|----------|--------|
| v1 algorithm | Content signals (lineage, same server+method, same creator, fallback) + click-next; cold start = content-only until transition data exists. |
| Ranking v1 | Tuneable weights per content signal + click-next weight; blend when transition data present; within-signal order by recency. |
| Lineage | Always biased (min slots or score boost), not just cold start. |
| Config | Policy knobs (`related.*`); all tuneables in admin UI. |
| Infinite scroll | Seed-based paging; sentinel triggers load more (like explore). |
| Storage | Bounded: K destinations per from_id for transitions (v1), evict by oldest last_updated so new paths emerge; N related per creation for precomputed (later); both tuneable. Transition data is time-aware (window or decay). |
| Exploration | Random injection; fraction/slots tuneable. |
| Click-next | In v1: record transitions from day one; rank using content + blend when data exists; at first no data so content-only. |
| Admin inspect | Admins can inspect click-next data in a paged, responsive, minimal table (from → to, count, last_updated) so they can watch the transition table grow and change over time. |

---

## Room to grow (future)

The v1 design is deliberately aligned with patterns used at scale so we can evolve without a rewrite:

- **Server-side recording:** Today the client POSTs the transition; the ideal long-term is to record the transition **when the server serves the creation-detail request** that includes `?from=` (e.g. in the same GET that returns the creation). One request = one transition, no client spam, no trust in the client. We keep GET read-only in v1 and document this as the next step.
- **Rate-limiting:** The transition endpoint is abuseable; add per-user (or per-IP) rate limits when needed.
- **Time decay/window:** We already store `last_updated` and use decay or a window for ranking and eviction. That’s the same idea as “count in last N days” or exponential decay used elsewhere; we can tune half-life or window without changing the schema.
- **Precomputed related:** A background job that materializes “top N related per creation” gives fast reads and scales; the transition table and time-based signals remain the input to that job.
- **Learned models:** If we later add embedding or sequence models, the transition table (and optional event stream) is the right training signal; the schema and time-awareness don’t block that.
