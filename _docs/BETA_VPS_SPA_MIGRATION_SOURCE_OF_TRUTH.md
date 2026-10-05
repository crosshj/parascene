# VPS/Beta migration guidance

This is the canonical home for migration and cutover requirements. The [VPS migration tracker](BETA_VPS_MIGRATION_TRACKER.md) is the current checklist of remaining scope; plans, feature documents and agent instructions reference this policy rather than restating requirements.

For client ownership, composition, controllers, and overlay routing, follow
[VPS client architecture and cleanup contract](BETA_VPS_CLIENT_ARCHITECTURE.md).
That document defines the target structure; it does not declare the port complete.

## Reference implementation

**The active WWW SPA is the only default reference for the VPS/Beta frontend migration.**

We are bringing the SPA over. The deprecated standalone/page-oriented WWW code is not the design reference and must go away as much as practical. Do not use standalone route markup, standalone route CSS, old page shells, or old page-specific breakpoints just because they are easier to locate.

Before writing or moving VPS frontend code:

1. Find the active WWW SPA route and its actual DOM hierarchy.
2. Find the shared SPA builders and behavior modules that produce that hierarchy.
3. Trace the active SPA parent-to-child CSS chain, including containing widths, gaps, padding, breakpoints, and container queries.
4. Port that structure and behavior into VPS, replacing only API, resource, navigation, and build seams.
5. If no active SPA equivalent exists, document the exception and the new decision before introducing a pattern.

## Deployment and build boundary

**VPS code must never import runtime code from outside the `vps/` directory.**

That means no imports from `api_routes/`, `public/`, `src/`, or other legacy/application trees in VPS server or client modules. Those trees may be inspected as references, but required behavior must be deliberately ported into a VPS-owned module. The Docker deployment contains `vps/`; an import that works only because the monorepo happens to have a parent directory is a deployment bug.

When shared behavior is needed:

- use the active WWW SPA code as the reference;
- port the required implementation into `vps/`;
- keep the port’s boundary and ownership clear;
- verify the module graph from the Docker image’s `/app` root before deploying.

## Creations example

The Creations browse feature is a completed port of the active WWW SPA chat/pseudo-channel surface. It is not a port of the deprecated standalone `app-route-creations` page or the abandoned `prsn_creations` table. The VPS `/api/creations` endpoint is canonical for `prsn_created_images`; the view owns list loading, offset pagination, optimistic pending cards, status polling, bounded lazy media loading, media selection, grouped covers/carousels/playlists, badges/privacy/status presentation, refresh/filter state, and grid markup/styles. Create workflow/composers and Creation Detail have separate owners and are not missing pieces of the browse view.

The active source surface is:

- route construction: `src/chat/chatPage.js`
- card construction: `public/shared/feedCardBuild.js`
- browse layout: `public/global.css` around `.chat-page--pseudo-browse-view`
- shared media/group/badge helpers under `public/shared/`

The feature replaces WWW network/navigation seams with the VPS request/resource client and route hooks, scopes WWW global CSS to VPS feature CSS, and uses VPS-owned events. Do not import the deprecated `public/components/routes/creations.js` module or its older fixed `content-cards-image-grid` rules.

`GET /api/creations?limit=50&offset=0&challenge_only=0` returns `{ creations: [], has_more, limit, offset }`. Each row supplies the media and presentation fields consumed by the grid, including `id`, `filename`, `file_path`, media URLs/type, dimensions, status, timestamps, title/description, metadata, NSFW, and moderation state. The API owns visibility filtering and pagination; the client must not paginate a broad local list.

The Creations browse migration is complete. Its regression checklist covers loading strategy, pagination, media thumbnail selection, badges/privacy, infinite scrolling, grouped items, and header/empty-state behavior.

## Feed and Doom Scroll port

The Feed port uses the active lane construction in `src/chat/chatPage.js`,
`src/chat/feed/feedChannelView.js`, `feedChannelData.js`, and
`feedChannelChallenge.js`; card/media behavior comes from the active shared
`feedCardBuild.js`. Preserve desktop API ordering and the mobile alternating
spotlight/card layout. The first mobile page requests `mobile_chat_v1`; later
pages carry the server cursor and ranked-feed acknowledgement.

Doom Scroll uses the active `src/chat/feed/doomScrollMount.js` and
`doomScrollView.js`, including native/group video playback, YouTube Shorts,
mute/progress controls, follow, likes, sharing and comments. VPS owns its native
overlay and comments dialog, with router-owned slide URL changes. The API port
retains WWW ranking, catalog fallback, composition, editorial pins, challenge
engagement, seen/impression tracking and timeline selection under `vps/`.

Local fixture browser validation is recorded in the cutover log. Live beta
acceptance remains in the tracker; the old progress overview is retired.

## Import adaptation

- Port required modules into their canonical VPS owner; do not create `vps/client/vendor` or a mirrored WWW source tree.
- Adapt imports in source files using native VPS dependencies. Do not use Rollup aliases, path remapping, dynamic-import rewriting or file-specific transforms to compensate for WWW paths.
- Keep Rollup limited to general build responsibilities: HTML/CSS loading, output, minification and boundary validation.
- `npm run build` in `vps/` must pass before a frontend change is complete. Unresolved local runtime imports remain incomplete even if output is generated.

## Creation-detail overlay and routing

Creation detail is not a normal route rendered into the page outlet. The overlay is app functionality owned by the layout/app shell, with the detail view mounted inside an app-level overlay host. It must remain independent of the underlying view that opened it.

Routing and overlay state are one system:

- A deep-loaded `/creations/:id` URL must resolve a valid underlying/default route but leave it dormant, reveal and mount creation detail first, and only start the background when detail signals a terminal ready/error state or the overlay is dismissed—whichever happens first. Session refresh and background loading must not delay or flash ahead of detail.
- A card click must preserve the already-loaded creation row/seed, update history, and open the same overlay path used by a deep link.
- The overlay must preserve the underlying route and scroll state while open.
- Closing, dismissing, or pressing Back must restore the correct underlying URL and state rather than leaving a detail route in the outlet or producing a blank shell.
- Navigating between details must update overlay history and content without tearing down the app shell.
- The detail view must be mounted into the layout's app-level overlay region, not by `CreationsView` and not as a normal router outlet page. There is no separate overlay controller; region occupancy is the overlay lifecycle.

The creation-detail overlay requirements above describe the completed VPS ownership contract and remain regression criteria for future changes.

## Completion and cutover

- Preserve the requested feature scope. No silent deletion or replacement of behavior during cleanup.
- A shell, static imports or successful initial load do not establish a completed feature port.
- Resolve document-wide selectors, delayed listeners and navigation globals into mounted feature lifetimes; verify action-specific API contracts and teardown.
- Dated Creation Detail API observations remain in the [cutover log](BETA_CUTOVER_LOG.md#creation-detail-api-observations-2026-10-01).
- Review deep links, seed handoff, Back/Forward, dismiss/reopen, dismissal during loading, scroll retention and session expiry. Retained controllers must survive overlays without duplicate subscriptions; unmount must dispose owned work.
- Building alone does not verify browser behavior. Resolve unclear WWW behavior or ownership before continuing the affected migration step.
