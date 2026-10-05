# VPS client: architecture and cleanup contract

This is the target pattern for `vps/client`, not a claim that the migration is complete. Use ordinary ES modules and explicit dependencies. No new framework is required.

## The short version: what goes where

**`app.js` connects the app systems. Router and state resolve a layout composition. Layout mounts what is missing, retains what still belongs, and unmounts what no longer belongs. Each view's controller shares its lifetime.**

| When the change concerns… | Use… |
| --- | --- |
| Markup, styling, rendering, or local DOM interaction | `View.html`, `View.css`, and `View.js`. |
| Coordinating a feature's data, subscriptions, and user actions | Its adjacent `Controller.js`; keep this in `View.js` while simple. |
| Loading, updating, caching, or sharing server data | A domain provider; its API adapter handles HTTP, and it uses `core/query.js` for query-cache behavior when appropriate. |
| Client state shared across features | App state with named actions/selectors. Keep local UI state in its view/controller; don't duplicate resource data. |
| URL changes, route selection, Back/Forward, or route-driven overlay open/close | Route definitions and the router. Together with relevant state, they resolve the shell and its region contents, including a retained/default background; only the router writes history. |
| Mounting/unmounting views, persistent regions, overlay visibility, focus, Escape, or scroll | Layout. It manages both shell structure and interaction, without implementing feature behavior. |
| Constructing app systems and supplying their dependencies | `app.js`; shell-child declarations belong to layout, route compositions to routes, and lifecycle details to the lifecycle module. |

Split out a controller when data/behavior coordination obscures rendering—not because every view needs another file. Its lifetime is the view's lifetime: mount together, persist together, unmount together. A state update does not itself mean remounting.

Example: a creation card supplies its ID and loaded data → the detail route resolves to sidebar + existing outlet + detail overlay → layout retains the sidebar/outlet and mounts detail, making the overlay visible. Their existing controllers stay subscribed. Dismissal resolves back to sidebar + outlet and unmounts only detail. There is no separate overlay controller.

Call this a **controller-based SPA**, or **MVC with application coordination**. Existing resources and state fill the model role; no separate Model classes or mandatory view-model layer are needed. Derived render data can just be plain objects. “MVVC” is not a widely standardized name; these ownership rules are the contract.

## Why cleanup is needed

The current problem is overlapping ownership, not file length. `app/runtime.js` hides application assembly; sidebar behavior spans `app/sidebar.js`, `app/shell.js`, layout, and session; router, layout, and the copied detail script all manipulate history. App state mostly records outcomes rather than providing a consistent interaction contract. Moving these responsibilities between files does not resolve them.

This document governs client organization. [Migration source of truth](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md) governs which WWW behavior to port; [data and state](BETA_VPS_CLIENT_DATA_AND_STATE.md) provides the detailed resource contract. Creation detail is an explicit migration exception: the active WWW SPA embeds the full detail implementation. Preserve that implementation as a native fragment, with its document/navigation assumptions adapted.

## 1. `app.js` is the composition root

Reading it should reveal the major systems and their relationships. It constructs them, supplies dependencies, and starts their lifecycle. It does not construct feature controllers or explicitly mount individual shell views. Subscription bodies, roster mutations, cache keys, route matching, and markup belong to their owners.

Illustrative target interfaces, to be implemented during cleanup:

```js
const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const state = createApplicationState({ bootstrap });
const providers = createAppProviders({ bootstrap });
const session = createSession({
  initialUser: bootstrap.user,
  onChange: (user) => state.actions.sessionChanged({ status: 'ready', user }),
  onLogout: () => providers.clearCaches(),
});
const services = { state, session, providers };
const routes = createAppRoutes({
  definitions: [
    { name: 'home', path: '/', view: views.Home },
    { name: 'creations', path: '/creations', view: views.Creations },
    { name: 'files', path: '/files', view: views.FileManager },
    {
      name: 'creation-detail',
      path: '/creations/:creationId',
      view: views.CreationDetail,
      presentation: 'overlay',
      defaultBackground: '/creations',
    },
    { name: 'fallback', path: '*', view: views.MockRoute },
  ],
});
const layout = createLayout({
  root: document.getElementById('app-shell'), views, services,
});
const router = createRouter({ routes, state, layout });
const lifecycle = connectLifecycle({ state, session, providers, router });
await lifecycle.start();
```

The router supplies narrow navigation actions when it asks layout to apply a composition; layout passes those actions to newly mounted views. This avoids a second navigation owner and avoids a circular `layout.connectNavigation()` setup step.

Imports include the view barrel and element-registration barrel. Startup resolves the initial route and applies its layout composition. Selecting the app shell implies its declared `SidebarView`, whose mount creates its controller; it is not unconditionally mounted just because layout started. Neither sidebar nor its controller is named in `app.js`. Layout owns shell children; routes select the shell and its content.

`app.js` declares the complete route surface at this basic level: route name, URL pattern, mounted view, presentation mode, and an overlay's default background. Matching, parameter validation, chrome, retained-background resolution, and full region composition remain in `app/routes.js`.

`connectLifecycle` only starts, connects, and disposes the supplied systems; it must not construct a second hidden application. No `let runtime` callbacks waiting for their dependency to exist. Dependency names and public interfaces matter more than a target line count.

## 2. Give each responsibility one owner

| Owner | Responsibility |
| --- | --- |
| `app/state.js` | App-state shape, selectors, and named transitions; uses the existing observable primitive in `core/appState.js`. |
| `app/routes.js` | Explicit route compositions: pattern/params, shell, region views and instance keys, background policy, and header metadata. No DOM mutation or history writes. |
| `core/router.js` | Sole owner of URL/history and deep-link resolution. Resolves routes plus relevant state/history into the desired layout composition and asks layout to reconcile it. |
| `core/layout.js` | Declares shell children and named regions; owns mounted-view handles. Applies the resolved composition, retaining shared children across transitions. Owns overlay visibility, focus, dismissal interaction, and scroll locking/restoration. No creation-specific code, fetching, or history writes. |
| `views/Sidebar/SidebarController.js` | Subscriptions, preferences, roster actions, and deriving sidebar render data. Created and destroyed by the sidebar view; persists while that view persists. |
| `views/*/*View.js` | Public mount entrypoint: markup, rendering, local interaction, and an optional attached controller. Exposes one lifetime/cleanup handle for both. |
| `providers/<domain>/`, `core/resource*` | Domain data behavior and HTTP contracts, and reusable query/cache machinery respectively. `providers/index.js` composes the app's providers; each domain folder exposes `index.js` and adds `api.js`, `model.js`, `resource.js`, or other modules only when useful. |
| `core/session.js` | Identity, authentication refresh, and logout. Account/avatar rendering belongs to the sidebar view. |
| `app/lifecycle.js` | Startup order, browser lifecycle subscriptions, and teardown; delegates refresh/cache policies to resource owners. |

Dependencies flow from composition into infrastructure and features. Features receive narrow services/callbacks; they never import `app.js` or reach through another view's DOM. Layout accepts supplied views rather than importing `CreationDetailView`. Its mount records are runtime handles, not serializable app state. It never chooses a feature by inspecting the URL.

## 3. Views and controllers stay together

Keep `SidebarView.{js,html,css}`, `SidebarController.js`, and the sidebar presentation model in `views/Sidebar/`. Mounting `SidebarView` creates its controller, which subscribes to relevant provider queries, derives render values, and translates emitted actions into provider calls. The view renders those values and emits intent. Threads roster data and credits remain in their respective providers. Callers mount the view, not a separately managed controller.

A small view needs only `View.js`. Split a controller when coordination obscures rendering, not by default. For this migration, `CreationDetailView.js` continues to mount the full fragment and run the adapted existing behavior; do not replace it with a reduced renderer.

Layout reconciles the resolved shell and regions using stable view-instance keys, not every URL or state notification. Persistence means a view is still required by the new composition, not that it was mounted globally at startup:

- Same instance still needed: retain its DOM, controller, and subscriptions; deliver changed inputs through an optional `update()` hook. Resource/state subscriptions update the mounted view without remounting it.
- Different instance needed: unmount the previous instance and mount the replacement. Route definitions make this identity explicit; a changed creation ID can select a new detail instance without replacing the background.
- Instance no longer needed: dispose it and remove its DOM. Covering a view with an overlay is not unmounting or suspending it.

Use a consistent mount contract: inputs include a root, route params, optional seed, and explicit actions/services; the mount returns a `destroy()` handle immediately, plus `update()` if needed. An overlay view also exposes a `backgroundReady` promise that settles when its primary load reaches a terminal ready/error state. Async work starts inside that lifetime. Destroying a view also destroys its controller and releases its listeners, subscriptions, timers, observers, media, and view-owned requests. Shared resources keep their own lifetime. Late results cannot update a replacement view; mount failure cleans up that instance without disturbing other regions.

`views/index.js` exposes mountable view entrypoints; their controllers are implementation details, not independently assembled app components. Internal modules import their concrete dependencies to avoid barrel cycles. Imports must not mount DOM or install routing listeners. `elements/index.js` is the deliberate registration exception: register custom elements once, with per-instance listeners managed by connect/disconnect. Registration does not create global modal instances.

Fragments contain no document wrapper or scripts. Scope DOM queries and CSS to the view root; the persistent shell and overlay own their own styles.

## 4. State has an interaction contract

Separate three kinds of state:

- **Application:** session status and one resolved navigation snapshot containing URL, background route, and optional overlay route. Sidebar selection and header identity derive from it. Overlay visibility derives from layout's mounted content, not a second mutable `overlay.open` flag.
- **Resources:** viewer-scoped roster, credits, creations, files, and their loading/freshness/error state. Do not copy these into a second app-state tree.
- **Local UI:** drafts, selection, menus, and other state owned by a mounted controller/view.

Consumers read selectors and subscribe to relevant changes; owners apply named transitions such as `navigationResolved` and `sessionChanged`. Views request `navigate`, `dismissOverlay`, or domain actions. Arbitrary whole-store `set` calls and window globals are not the cross-feature API. DOM nodes, promises, and service objects stay outside serializable state.

State changes that affect view presence (for example, session state) feed the same layout reconciliation as routing. Ordinary data changes notify existing controllers. State-only surfaces use explicit app-state selection; URL-backed surfaces use the router. Both request mounts through layout, not competing render/visibility paths.

Providers own domain-specific data behavior and lifetime. A provider may expose a query cache, an observable subscription, or both; it should expose only the behavior its consumers need. The current Creations, Files, Sidebar, and Credits providers expose API adapters and query caches built on `core/query.js`. Their views continue to own page-specific work such as pagination, rendering, and mounted-view cleanup. Bootstrap/cached values paint immediately; fetch only missing or stale data. Load providers' query data when needed, and clear private state on identity changes. A sidebar refresh must not reset outlet chrome by independently rereading `location.pathname`.

## 5. Routes describe layout compositions

A route describes more than the view in the outlet. It selects a shell and what should occupy its regions:

| Route | Implied shell children | Outlet | Overlay |
| --- | --- | --- | --- |
| `/creations` | Sidebar | Creations | Empty |
| `/creations/:id` | Sidebar | Retained background, or resolved saved/default route | Creation detail |

Routes can name a shared app shell rather than repeat its sidebar declaration. Layout knows that shell includes a sidebar; applying either composition mounts it if absent and retains it if already present. A route selecting a shell without a sidebar would unmount it and its controller. `app.js` knows none of these child-view decisions.

Declare `/creations/:id` explicitly with `presentation: 'overlay'` and `defaultBackground: '/creations'`. The canonical path is plural. Do not discover detail routes inside the wildcard handler. For in-app entry, retain the current compatible non-overlay outlet and its URL (including query/hash). For deep links or history restoration, resolve valid saved background metadata or the default. Detail A → B keeps the original background; A does not become B's background. These choices belong to route resolution, not layout.

Layout owns the overlay host as a sibling of its page outlet and sidebar. The router supplies the complete composition, including the underlying outlet—not a separate imperative "open overlay" operation. Layout applies only the changed mounts. An occupied overlay region is visible; an empty one is hidden. No separate overlay controller or independent open/close lifecycle exists.

Layout owns focus containment, background interaction suppression, Escape/backdrop/close-button handling, scroll locking, and restoration. Dismissal emits an intent to the route/state owner; that owner changes the desired view set, and layout unmounts the content. It does not hide a still-mounted route behind the router's back. The underlying view, controller, and subscriptions remain alive throughout.

| Transition | Required result |
| --- | --- |
| Card → detail | Preserve current background URL, DOM, controller, subscriptions, and scroll; record focus for restoration; pass the loaded row as seed; push the detail URL and mount detail in the overlay region. |
| Direct load/reload of detail | Resolve a valid saved background or `/creations`, but leave it dormant. Reveal and mount the overlay first. Start mounting/loading the background only when detail's `backgroundReady` settles or the overlay is dismissed, whichever occurs first. Restore without another history push, and do not wait for session refresh to show detail. |
| Detail A → B | Update overlay content and history; retain the original background. |
| Back / Forward | Resolve the history entry through the same route pipeline; update or close/reopen the overlay without remounting an unchanged background. |
| Close / Escape | Dismiss to the recorded background URL; use replace semantics as WWW's full-dismiss path does. Never blindly call `history.back()` on a cold deep link. Nested dialogs get Escape first. |
| Navigate to another page | Dispose the overlay, transition the outlet, and synchronize navigation state and chrome. |

Only the router uses `pushState`, `replaceState`, or navigation `popstate`. Store small return-route metadata in history; retain seeds in a viewer-scoped resource/cache, not in URL state. Treat seeds as partial initial data: paint synchronously, then fill gaps or revalidate through the detail resource. Losing a seed on reload must not break the route, and a seed never grants API access.

WWW references: `src/shared/spaPageOverlay.js` handles history, dismissal, and seed handoff; `ensureUnderlyingOverlayLaneLoaded` in `src/chat/chatPage.js` prepares the background. Port their behavior into these owners. Iframe messaging and standalone-page history patches are not needed for native view hosting.

## 6. Apply this to the existing client

1. **Consolidate navigation and mounting.** Put route resolution/history in the router, replacing wildcard/microtask detail handling with explicit shell/outlet/overlay compositions and background policy. Make layout reconcile those compositions and derive overlay interaction/visibility from occupancy. Remove creation-specific layout navigation, duplicate history listeners, and history monkey-patching from `CreationDetailView.js`. Do not introduce an overlay controller.
2. **Finish the sidebar boundary.** Declare sidebar as a child of the shared app shell, selected through route composition—not an explicit `app.js` mount. Move `app/sidebar.js` beside `SidebarView.js`; create/dispose its controller through the view mount. Absorb sidebar subscriptions from `app/shell.js` and account rendering from session. Keep provider policy in its domain provider. Remove the duplicate sidebar snapshot from app state; retain sidebar/controller across routes that share that shell.
3. **Make composition visible.** Move session/router construction out of `app/runtime.js` into `app.js`; distribute storage/refresh handling to resources and startup/disposal to lifecycle. Remove `app/shell.js` once its bindings have owners. Keep route/view inputs current instead of capturing preferences once at startup.
4. **Creation Detail mount contract (implemented).** Pass `creationId`, seed, and navigation actions through the detail mount; keep page-load listeners within its lifetime and preserve the full feature behavior.
5. **Close the build boundary.** Follow [migration import and build requirements](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md#import-adaptation), including custom-element dependencies.

Verify deep-link → close, grid → A → B → Back/Forward, dismiss/reopen, pending-load dismissal, scroll retention, seed-first paint, and session expiry. Assert that sidebar/background controllers and subscriptions survive overlay transitions, state changes update retained views without duplicate subscriptions, and unmount disposes each controller exactly once. Also check that importing the view barrel does not mutate history and that browser module requests resolve. Building alone does not verify these behaviors.

Completion and cutover requirements: [VPS/Beta migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md#completion-and-cutover).

## Right sidebar interaction contract

The right sidebar is a layout region controlled through `layout.rightSidebar`
(and the same narrow `rightSidebar` dependency supplied to mounted views).
`open({ key, title, mount, onClose })` mounts feature content and returns a lease
with `close()` and `isOpen`; closing a stale lease cannot dismiss its replacement.
Layout owns the squircle panel, responsive placement, saved width, resize grip,
keyboard resizing, close control, Escape, and content disposal. Features own their
content, data, and subscriptions and release their lease on teardown. Changing
outlets prepares the destination rail before disposing the previous outlet. When
both routes have saved rail content, the shell stays visible at the same width
and swaps only feature content for the destination loading state. Retaining an
outlet under a route overlay retains its rail.
Header menus and accessories use `setHeaderMenu` and `setHeaderAccessories`.

This is an explicit user-requested departure from WWW's canvas split-pane shell:
the VPS rail uses the left sidebar's panel styling and delayed resize handle.
The conversation canvas fragment, Markdown renderer, and content styles are ported
from the active WWW chat shell; Channel and DM use shared conversation chrome.
Canvases remain channel-only, with founder creation, author editing/pinning, and
admin removal of a channel pin. Private-channel canvas bodies remain encrypted.

The right rail now persists its descriptor per background route, independently
of feature teardown. The head bootstrap restores width and reserves rail space
before the outlet paints; layout prepares the rail before mounting each outlet,
and the feature replaces its loading placeholder once its data arrives. Explicit
close forgets the descriptor; route changes and teardown preserve it. Width is
limited by available viewport space (leaving room for the outlet), rather than
an arbitrary 600px cap. Canvas chrome uses the outlet header's transparency.

The loading rail repeats body skeleton paragraphs to cover its full available
height, recalculating on viewport and rail resize and clipping at the panel edge.
Content replacement invalidates the previous feature lease before view teardown,
so the outgoing controller cannot close the incoming rail or erase its state.

### Native Feed and Doom Scroll (2026-10-05)

The active WWW SPA feed replaces the earlier progress overview. `views/Feed`
owns the mounted card/spotlight DOM, scoped WWW styles, and controller lifetime;
`providers/feed` owns the feed and doom pagers and native request adapter. Feed
cards use native navigation with creation seeds, and challenge voting shares the
Threads history query and durable vote queue. Retained feed media pauses while an
app overlay is open.

`views/DoomScroll` owns the ported video slides, playback controls and native
comments dialog. The app router owns `/feed/doom/:creationId` and slide URL
updates; its retained overlay instance keeps the timeline mounted across those
updates. Layout retains the underlying feed and its scroll position. Teardown
aborts pending requests, disconnects observers, removes listeners, and releases
media. Server selection, ranking, composition and impressions live under
`services/feed`, with API routes in `routes/feed.js` and queries in `db/feed.js`.

### Shared Create form contract

Basic, Image Edit, Mutate, image-to-video, Advanced and the future creation
composer edit one retained draft. The Create domain owns its reducer, persistence,
projection and subscriptions. `providers.create.draft` exposes the editor API;
`persistSavedCreateForm` maintains compatibility settings. Editors patch values
and issue explicit image actions; omitted/unsupported fields remain saved. Basic
shows and submits only the first image while preserving the full list.

The [client data and state contract](BETA_VPS_CLIENT_DATA_AND_STATE.md#create-provider-draft-contract) defines the shared Create draft behavior.

### Native account and Library fragments (2026-10-04)

The active WWW SPA opens Library, style/audio detail, Profile and Connections
through its page-overlay machinery. Their embedded implementations are the
reference for this port. VPS mounts equivalent content inside its own page or
app-level overlay, with static VPS imports, route-local URLs, native navigation
callbacks and one lifetime per mount. Library retains styles/personas/audio tabs
and recording/edit dialogs; Profile retains its full tabs and editing behavior;
Connections retains credential and application management. Help is served as a
standalone VPS document from VPS-owned Markdown, with the active WWW page structure
and styling ported into the Help route; it is not an SPA view. In-app Help links
open that document in a new tab. Each embedded fragment aborts requests, removes
owned document listeners/observers, and releases media and recording tracks on
teardown.

The Sidebar owns the account menu, Settings and About modal hosts. The menu calls
explicit native navigation/session callbacks. Reports retains the existing
localhost-only link to the separate development analytics server on port 2367;
it is not a production report-service migration.

### Browse grids, search composer and shared lightbox (2026-10-04)

At the user's request, Files and Library use the same `CreationGrid` lane,
columns, gaps and square skeletons as My Creations. Library's personas/styles
catalog reveals additional cached rows on scroll; audio clips fetch successive
pages. The outlet header owns the title and tab-specific buttons (Add style when
permitted on Styles; Record clip on Audio clips); Refresh remains in its menu.

Explore declares `composer: 'search'`. Layout owns and measures its bottom
composer host, using the normal composer placement, sizing, shell and viewport
padding. The mounted Explore view binds search, clear and query updates and
releases those bindings at teardown. Search is not a sticky element in the grid.

`components/MediaLightbox` exposes a view-owned handle to the existing chat
lightbox renderer. Files and Library use the same image/video/audio frames,
playback controls, dismissal behavior and styles as chat. Optional title text
sits at the upper left of the backdrop; explainer text sits below the item and
above custom footer actions. Destroying a handle only closes its owned preview,
never a newer preview opened elsewhere. Unknown files retain their generic file
graphic, on a solid square backing in both grid and preview; they never request
the audio artwork fallback. File audio/video tiles use `creationTypeBadgeMarkup`.

Loading browse views show shared square skeletons; Comments uses the existing
chat-thread skeleton. Status text is reserved for empty, error and recovery
states rather than duplicating loading placeholders.

### Library details and Explore publication chrome (2026-10-04)

Styles open their full details directly in a standard native dialog with Copy
style key; the redundant See All Styles link is removed. Add style and Record
clip also use standard dialog chrome over Library. Audio clip cards and direct
clip links open the full clip details in a single native dialog, attempt playback
once loaded, and release playback and pending requests on dismissal. Style and
audio detail URLs use Library as their page instead of app-overlay presentation.
Library requests audio clips oldest first; the server orders by creation time
and ID before pagination. Other audio pickers retain their existing defaults.

Explore suppresses publication badges in both grid and large-card modes. The
shared card publication updater respects that per-card setting while retaining
published state and the normal badges on other surfaces.

### Profile return from creation detail (2026-10-05)

Profile → creation continues to replace the single app overlay content. The router
records the opening profile URL (including its tab hash) separately from the page
background. Creation dismissal returns to that profile; browser history resolves
the same route. Layout snapshots the departing profile's local browse data through
`getRestoreState()`, disposes the view, and supplies the snapshot on remount. The
profile restores loaded tab rows and pagination; layout restores overlay scroll
after `backgroundReady`. Snapshots are released when leaving the overlay flow.
No second mounted overlay is retained.

Creation detail applies card-provided hero dimensions before its first paint;
feed seeds resolve by creation ID, and profile cards pass their loaded record.
Without known geometry, detail content remains hidden until API dimensions/job
aspect ratio or intrinsic media dimensions establish it. The hero retains its
reserved aspect ratio after media loads. Error states release the visibility gate.

Profile reads use the app-scoped `providers/profile` query cache. Cached
responses render without waiting for background revalidation; refreshed header
and loaded list pages retain the tab controls and edit forms. Restored lists
refresh their loaded range. Profile mutations revalidate queries; the app's
cache clearing and teardown dispose them. Profile data stays in memory only.
