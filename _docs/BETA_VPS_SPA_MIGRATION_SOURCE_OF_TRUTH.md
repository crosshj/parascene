# VPS/Beta migration guidance

This is the canonical home for migration and cutover requirements. Plans, feature documents and agent instructions reference this policy rather than restating it.

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
5. If no active SPA equivalent exists, document the exception before introducing a new pattern.
5. If there is no active SPA equivalent, document the exception and the new decision.

## Deployment and build boundary

**VPS code must never import runtime code from outside the `vps/` directory.**

That means no imports from `api_routes/`, `public/`, `src/`, or other legacy/application trees in VPS server or client modules. Those trees may be inspected as references, but required behavior must be deliberately ported into a VPS-owned module. The Docker deployment contains `vps/`; an import that works only because the monorepo happens to have a parent directory is a deployment bug.

When shared behavior is needed:

- use the active WWW SPA code as the reference;
- port the required implementation into `vps/`;
- keep the port’s boundary and ownership clear;
- verify the module graph from the Docker image’s `/app` root before deploying.

## Creations example

The active SPA creations browse surface is the chat/pseudo-channel implementation:

- route construction: `src/chat/chatPage.js`
- card construction: `public/shared/feedCardBuild.js`
- browse layout: `public/global.css` around `.chat-page--pseudo-browse-view`
- shared media/group/badge helpers under `public/shared/`

The deprecated standalone `app-route-creations` implementation and its older fixed `content-cards-image-grid` rules are not the VPS Creations source of truth.

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

Do not continue the beta creation-detail migration until the www SPA routing/overlay lifecycle has been traced clearly enough to reproduce these behaviors. If any part of the www implementation, deep-link defaulting, history ownership, or seed handoff is unclear, stop and resolve that detail before adapting code.

## Completion and cutover

- Preserve the requested feature scope. No silent deletion or replacement of behavior during cleanup.
- A shell, static imports or successful initial load do not establish a completed feature port.
- Resolve document-wide selectors, delayed listeners and navigation globals into mounted feature lifetimes; verify action-specific API contracts and teardown.
- The architecture refactor recorded incomplete creation-detail lifecycle seams on 2026-10-01. Treat them as unresolved until verified; do not claim full completion while they remain. Dated API observations remain in the [cutover log](BETA_CUTOVER_LOG.md#creation-detail-api-observations-2026-10-01).
- Review deep links, seed handoff, Back/Forward, dismiss/reopen, dismissal during loading, scroll retention and session expiry. Retained controllers must survive overlays without duplicate subscriptions; unmount must dispose owned work.
- Building alone does not verify browser behavior. Resolve unclear WWW behavior or ownership before continuing the affected migration step.
