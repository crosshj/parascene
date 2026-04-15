# Plan: grouped creations and multi-source video creations

Follow-up product work: two new shapes that still map to the existing creation / feed row model in the DB, and both rely on the same visibility contract as lineage today.

## Shared contract (publish as gateway)

Publishing the parent row grants context-scoped read of named source/member creation ids for viewers of that parent, even when those sources are not globally published (including other creators). Same idea as `lineage_of` delegation on `GET /api/create/images/:id` and media routes: the published parent is the gateway; ids must be listed on that parent in a canonical way the API trusts.

## 1) Grouped creation

- User groups several existing creations into one logical creation that can be published like any other.
- Feed and detail treat the group row as the primary item; members are sources referenced from the parent (metadata or a normalized member list, TBD).
- Follow-up: schema and API for member list, ordering, add/remove before publish, and how feed cards show the group vs a single thumb.
- Follow-up: extend delegation checks so fetches for member ids use the group parent id as context (same pattern as `lineage_of` today), and ensure image/video bytes routes stay aligned with metadata access.

## 2) Video built from several creations

- User selects multiple creations; the app produces one video output that is stored as a single new creation row.
- That video row is the published gateway; frame or segment-level links to source creation ids live in meta (or related table, TBD).
- Follow-up: creation job pipeline for multi-input video, storage of `video` meta, and UI for picking sources and showing provenance on the detail page / lineage strip.
- Follow-up: delegation must include every id the parent exposes (sources, not only linear `history`), so modal and thumbnails do not regress to blank or 404.

## Cross-cutting follow-up

- Decide canonical storage for member/source ids on the parent row (JSON meta vs join table) for queries, RLS, and indexing.
- One place in the API that answers "may this viewer read creation X in the context of parent P?" and reuse it for images API, media bytes, and any new feed payloads.
- Docs or in-app copy for creators: publishing the parent reveals named sources in context; it does not necessarily publish those sources to the global feed.

## Done when

- Both flows create a single publishable row; feed and detail behave consistently with current creations.
- Viewers of the published parent can load source thumbnails and detail/modal paths without requiring each source to be published, within the delegation rules above.
- Unpublished parent cannot be used to scrape arbitrary other users' private creations by id stuffing (same guardrails as current lineage delegation).
