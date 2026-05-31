# Plan: grouped creations and multi-source video creations

Follow-up product work on top of `meta.group.kind === group_creations` (sources archived; group row is cover + `source_creations`; feed carousel; detail thumbs, set cover, ungroup; publish/unpublish on group row).

## Shared contract (publish as gateway)

Publishing the parent row grants context-scoped read of named source/member creation ids for viewers of that parent, even when those sources are not globally published. Reuse the same pattern as `lineage_of` on `GET /api/create/images/:id` and media routes; extend delegation so member fetches and image/video bytes stay aligned with metadata access.

## 1) Grouped creation — open items

Schema / API follow-up: canonical member list, ordering, add/remove before publish, feed card vs single thumb.

### Share follow-up

- OG/social preview uses wide crop (`variant=wide`); portrait groups may look cropped in unfurl cards while the link page is correct.
- Multi-image file export (zip, multi-file native share, upload all sources).

### Creation detail — still disabled or pending

- queue from frame (video only)

Tier 1:

- Set avatar reachable in more menu

Tier 2:

- Delete: optional cascade (restore sources, delete sources, or require ungroup first); owner delete today only marks group row unavailable

Tier 3:

- Challenge submit rules for groups
- Creator copy: publish exposes group/cover; sources stay archived
- Edit sync into `meta.group.source_creations` and/or live source rows (group row edit works; embedded source snapshots may stay stale until refresh)

## 2) Video built from several creations

- User selects multiple creations; the app produces one video output stored as a single new creation row.
- That video row is the published gateway; frame or segment-level links to source creation ids live in meta (or related table, TBD).
- Creation job pipeline for multi-input video, storage of `video` meta, UI for picking sources and provenance on detail / lineage strip.
- Delegation must include every id the parent exposes (sources, not only linear `history`), so modal and thumbnails do not regress to blank or 404.

## Cross-cutting

- Decide canonical storage for member/source ids on the parent row (JSON meta vs join table) for queries, RLS, and indexing.
- One API helper: "may this viewer read creation X in the context of parent P?" — reuse for images API, media bytes, feed payloads.
- Docs or in-app copy: publishing the parent reveals named sources in context; it does not necessarily publish those sources to the global feed.

## Done when

- Both flows create a single publishable row; feed and detail behave consistently with current creations.
- Viewers of the published parent can load source thumbnails and detail/modal paths without requiring each source to be published, within the delegation rules above.
- Unpublished parent cannot be used to scrape arbitrary other users' private creations by id stuffing (same guardrails as current lineage delegation).
