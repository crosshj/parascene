# Plan: grouped creations and multi-source video creations

Follow-up product work: two new shapes that still map to the existing creation / feed row model in the DB, and both rely on the same visibility contract as lineage today.

## Shared contract (publish as gateway)

Publishing the parent row grants context-scoped read of named source/member creation ids for viewers of that parent, even when those sources are not globally published (including other creators). Same idea as `lineage_of` delegation on `GET /api/create/images/:id` and media routes: the published parent is the gateway; ids must be listed on that parent in a canonical way the API trusts.

## 1) Grouped creation

- User groups several existing creations into one logical creation that can be published like any other.
- Feed and detail treat the group row as the primary item; members are sources referenced from the parent (metadata or a normalized member list, TBD).
- Implemented: `meta.group.kind === group_creations`; sources archived; group row has cover + `source_creations`; feed carousel; detail thumbs, set cover, ungroup (unpublished); publish/unpublish on group row.
- Follow-up: schema and API for member list, ordering, add/remove before publish, and how feed cards show the group vs a single thumb.
- Follow-up: extend delegation checks so fetches for member ids use the group parent id as context (same pattern as `lineage_of` today), and ensure image/video bytes routes stay aligned with metadata access.

### Share

Public share page (`/s/v1/...`, `api_routes/pages.js`, `public/pages/share.js`):

- Link mint points at the group row; page shows carousel (source URLs with share delegation), portrait/landscape layout from group dimensions.
- Cover image: `GET /api/share/.../image` resolves storage via cover source (not synthetic `group/...` filename).

Share modal (`app-modal-share`, opened from creation detail with `isGroupCreation`):

- Enabled for groups: copy link, QR, SMS, email, X, Facebook, Reddit, LinkedIn, device link share (URL only).
- Hidden for groups (single-image export only — cover, not full group): device image file, open watermarked image, Google Photos, Vynly.
- Follow-up: OG/social preview uses wide crop (`variant=wide`); portrait groups may look cropped in unfurl cards while the link page is correct.
- Follow-up: multi-image file export (zip, multi-file native share, upload all sources).

### Creation detail actions (checklist)

Shipped:

- [x] Publish / un-publish on group row
- [x] Detail: thumbs, set cover, ungroup (unpublished)
- [x] Feed group carousel
- [x] Share pill on detail (link targets use public share page above)

Still disabled in UI (`creation-detail.js` `actionsContext`):

- edit, mutate, delete, queue for later, queue from frame, retry, more-info

Bug fix:

- [ ] Decouple `hideActions` from `hasGroupPublishActions` (`creation-detail.js`)
- [ ] Show more menu for published groups when viewer is not owner (copy link, etc.)
- [ ] Non-owners on published groups: like, tip, follow visible again

Tier 1 — enable in UI (low risk):

- [ ] Show edit pill (group title/description/NSFW only)
- [ ] Show queue for later in more menu (decide: cover vs active thumb `source_id`)
- [ ] Set avatar reachable in more menu after menu fix

Tier 2 — design + API before enable:

- [ ] Delete: define cascade (restore sources, delete sources, or require ungroup first)
- [ ] Mutate: cover-only label or mutate-from-selected-source + lineage

Tier 3 — defer:

- [ ] Challenge submit rules for groups
- [ ] Creator copy: publish exposes group/cover; sources stay archived
- [ ] Edit sync into `meta.group.source_creations` and/or live source rows

Remove `actionsContext` disables when each remaining item above is done.

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
