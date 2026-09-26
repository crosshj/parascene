# Client data access and UI state

This document describes how data reaches the browser, how it becomes application
state, and what the UI is allowed to assume at each point. It is informed by
the existing `www` SPA (`src/` and its browser-served `public/` counterparts)
and records the conventions the VPS client should preserve as it grows.

The key idea is that a UI should render an explicit state of knowledge, not
guess whether a missing value means “not loaded,” “empty,” or “failed.” Every
data source has a lifecycle, an owner, and a reconciliation rule.

## Data access patterns

### 1. Server-rendered/bootstrap data

The server embeds small, request-specific data in the HTML before the client
bundle starts. VPS currently embeds the authenticated user/profile, requested
route, and files API origin in `window.__PARASCENE_BOOTSTRAP__` (see
`vps/routes/pages.js` and `vps/routes/middleware/spa.js`). The client reads it
once in `vps/client/app.js`; `createSession` uses the user as its initial value
and then refreshes it from `/api/me`.

Bootstrap data is immediately renderable, but it is a snapshot—not a permanent
source of truth. Keep it small, safe to serialize, and scoped to the request.
Treat it as `ready` with a timestamp/source of `bootstrap`; refresh or invalidate
it when its domain requires stronger freshness. Do not block the shell on
secondary requests when useful bootstrap values are already available.

In `www`, server-rendered route HTML and data seeds are also used for page-level
first paint (for example, page routes in `api_routes/pages.js` and seed helpers
in `src/shared/creationDetailSeed.js`). This is the same pattern even when the
data is rendered directly into markup rather than exposed as a global object.

### 2. Persistent browser cache

Data may be read from `localStorage`, `sessionStorage`, or another browser cache
before making a network request. The `www` chat thread cache
(`src/shared/chatThreadsCache.js`) is a concrete cache-then-network example:
it validates the cached shape and viewer id, paints cached threads immediately,
and refreshes when stale. The chat sidebar roster cache
(`src/shared/chatSidebarSessionCache.js`) snapshots threads, joined servers,
presence, and viewer profile so the roster can appear promptly after reload.

A cache is a speed/read-continuity layer, not authority. Represent its status
explicitly (`cached`, `stale`, `refreshing`, `fresh`, `refresh-failed`), retain
usable cached content during refresh failure, and scope user-specific entries
to the authenticated viewer. On account changes, reject or clear data owned by
the prior viewer. Browser storage may be unavailable, malformed, or full; cache
failure must degrade to network/empty loading behavior, never break rendering.

### 3. Post-load fetches

Requests after initial render have two common UI meanings:

- **Refresh/replace:** authoritative data replaces or reconciles bootstrap/cache
  content. Keep existing content visible while refreshing when possible.
- **Fill a known gap:** the UI has a stable placeholder because a specific value
  or page is not yet known. Use a skeleton or local loading marker, then replace
  that region when the request resolves.

The `www` chat code follows both patterns: cached thread lists are refreshed
from `/api/chat/threads`, while message history and other thread-specific
resources are fetched when the selected route/thread needs them
(`src/chat/chatPage.js`). The shared `renderEmptyState` helper in
`src/shared/emptyState.js` distinguishes loading from empty and error content.

VPS `createFilesApi` (`vps/client/api/files.js`) is a network API boundary. The
Files view owns request/loading/error/empty state and supports cancellation for
its route lifetime. **Files is the target example for a cache-then-update-inline
experience:** render a usable cached listing immediately, fetch the current
listing in the background, and reconcile the result in the existing grid
without clearing the page or replacing it with a full loading state. The cache
should be viewer-scoped and validated; successful uploads/deletes should update
the visible listing and cache consistently, while a failed refresh keeps the
last usable listing and exposes only subtle/recoverable stale status.

The VPS Files view now follows this pattern through an app-scoped resource and
viewer-scoped storage cache: it leaves existing cards mounted while refresh is
pending, reconciles the refreshed page by file id, and retains cached content
when refresh fails. Upload, delete, and pagination update the resource snapshot
so cache and visible list stay aligned. `www` chat caches remain a source of
existing data-lifecycle concepts, while Files is the VPS product example for
how cache-backed lists should feel. Keep transport and response normalization
in `client/api/`; keep view-specific presentation in the view, and reusable
resource/cache behavior in `client/core/` or a focused utility/component.

### 4. User-provided data

Text fields, composer drafts, selected files, filters, and other direct input
are data sources too. The browser owns the draft until the user submits or
explicitly saves it. Model input as a separate draft from the last confirmed
server value; validation errors are field/form state, not fetch failures. A
submit should have a clear `idle → submitting → success` or
`idle → submitting → recoverable failure` lifecycle. Preserve the user's input
after a recoverable failure, prevent duplicate submission where appropriate,
and only announce success after the server confirms it (unless an intentional
optimistic interaction has a rollback rule).

### 5. Cache of user-owned data/preferences

Some browser-stored state is user-owned rather than a replica of server data:
layout preferences, dismissed items, local pins, drafts, and similar choices.
Keep these separate from server-authoritative records. Document key/version,
scope (per user, per browser, or per tab), expiry/migration behavior, and what
happens when storage is unavailable. VPS currently persists the home-page
sidebar display choice and width locally; these are presentation preferences,
not roster data (`vps/client/app.js`, `vps/client/views/Sidebar/SidebarView.js`).

### 6. Asynchronous events from connected clients

Realtime notifications are often **hints that data may have changed**, not a
complete replacement for fetching authoritative state. In `www`,
`src/shared/realtimeBroadcast.js` provides user- and room-scoped subscriptions;
callers refresh or invalidate the affected data on `dirty` events and refetch
after a reconnect. Chat uses this for thread/message updates in
`src/chat/chatPage.js` and navigation roster/unread refreshes in
`src/shared/components/navigation/index.js`.

Treat a realtime event as one of: a complete versioned update that can be
applied safely, or an invalidation signal requiring an authoritative refetch.
Do not assume delivery, order, or continuous connectivity. Coalesce bursts,
ignore events for disposed views, unsubscribe on teardown, and reconcile after
reconnect. UI should remain usable while disconnected and should not surface a
transport warning as a content error unless the user action/data truly failed.

### 7. URL and navigation state

The URL is durable, shareable application state: selected route, resource ids,
query filters, and sometimes view modes. `www` uses route state alongside
history/popstate, and the VPS router (`vps/client/core/router.js`) reads
`location.pathname`, intercepts internal links, supports `navigate()`, and
rerenders on `popstate`. Sidebar active state, outlet identity, and page header
must derive from the same normalized location (or a single router state), not
independently drift.

On navigation, dispose route-owned listeners/requests/subscriptions, reset
route-specific scroll where appropriate, and avoid stale responses writing
into the newly selected page. Query/hash must be preserved where they carry
meaning. A direct URL load and browser Back/Forward must produce the same state
as clicking an in-app link.

### 8. Mutations and optimistic updates

Create/update/delete actions are another access pattern. The server confirms
the durable change; the client may either wait for confirmation or update
optimistically. For optimistic changes, record enough prior state to roll back
on failure, and reconcile the server response rather than assuming the local
guess is canonical. `www` chat sidebar actions and its mutation flows demonstrate
this broader class; VPS currently has local mock roster actions in `app.js`,
which should not be mistaken for persisted server mutations.

### 9. Derived and joined data

Some UI values are calculated from other state: active sidebar item from URL,
unread totals from thread state, display labels from profile data, or a combined
view from multiple endpoints. Derived values should have one canonical
calculation and should not be independently persisted unless they are an
intentional snapshot/cache. For multi-source views, track readiness per source
so a slow optional source does not make the entire view look broken.

### 10. Live sidebar rosters (DMs, channels, servers)

The sidebar fixture belongs to `server/mocks/sidebar.js`; client views do not
import mock roster records. The `client/api/sidebar.js` boundary requests the
`www`-shaped endpoints, and `client/models/sidebar.js` adapts those API rows to
the sidebar presentation model. Static product navigation and popup-menu
definitions are kept separately in `client/config/sidebar.js`. The Home page's
full/minimal controls only filter the API-backed roster for visual testing.

The sidebar roster is not just another fetched list. It is a long-lived,
cross-view collection whose rows can change from many independent causes:
initial session/bootstrap data, cached roster, a new incoming message, presence
going online/offline, unread/read changes, a challenge submission affecting
challenge attention, a newly opened DM, pin/unpin, joining/leaving/hiding a
conversation, or a server refresh/reconnect. Each event can affect row
membership, row fields, badges, or order—and those are distinct updates.

This is an area where the legacy `www` behavior is not consistently a good
template: the sidebar can be late to become useful and can glitch when its
roster changes. There are good pieces to reuse, including the viewer-scoped
roster snapshot in `src/shared/chatSidebarSessionCache.js`, user/room
invalidation broadcasts in `src/shared/realtimeBroadcast.js`, and the keyed
DOM-patching helpers in `src/shared/chatSidebarRoster.js`. In particular,
`tryPatchChatSidebarListDomInPlace` updates active/unread/presence chrome when
membership and order are stable rather than replacing row contents. But that
helper deliberately falls back when the row set/order changes; a robust VPS
roster should handle those changes with keyed reconciliation too, not a whole
sidebar render. Reuse the concepts and proven domain rules, not the glitchy
timing or full-replacement fallback as the desired contract.

The intended lifecycle is:

1. **Use a client-side last-known-good snapshot for first paint:** for this
   high-churn, user-specific roster, prefer a compact, versioned browser cache
   over making the initial HTML request assemble the full roster from backend
   dependencies. Read storage synchronously before mounting the sidebar so
   known rows can paint without waiting for the network. This keeps the HTML
   bootstrap small and avoids adding roster queries to document response time.
   A roster snapshot can include rows/order, last-updated/version metadata, and
   only the presentation fields needed for first paint; transient connection
   state can be refreshed afterward.
2. **Establish identity before exposing private cached data:** compare the
   snapshot's `viewerId` with the authenticated bootstrap/session identity. If
   identity is not known yet, defer using the private snapshot until it is
   confirmed. On logout or account switch, clear or quarantine the previous
   viewer's in-memory/cache state before painting the new viewer's sidebar.
   Validate schema/version and tolerate missing, corrupt, or unavailable
   storage; fall back to first-load loading UI rather than failing the shell.
3. **Reconcile authoritative data inline:** fetch/refresh the roster and related
   summaries. Merge by stable identity and update the existing view inline.
   Keep each section usable if another section or optional presence source is
   still pending or fails.
4. **Normalize each change into a roster event/action:** for example
   `presenceChanged(userId, status)`, `unreadChanged(threadId, count)`,
   `messageArrived(threadId, message)`, `dmOpened(thread)`,
   `pinChanged(threadId, pinned)`, `membershipChanged(itemId, action)`, or
   `snapshotReceived(snapshot)`. Events update one canonical roster model (and
   relevant unread summaries); views do not each invent their own order/badge
   interpretation.
5. **Derive order and row presentation deterministically:** define the policy
   for pinned items, notes-to-self, recent message/interactions, unread priority,
   stable tie-breaking, and section membership in one domain selector/reducer.
   A message or pin may change order; presence may only change the avatar/row
   treatment; a read action may only change unread chrome. Challenge activity
   should update the relevant challenge unread/attention state and only alter a
   roster row/order if product policy explicitly says it does.
6. **Apply a keyed DOM diff:** preserve row elements when identities remain,
   patch text/avatar/presence/badge/active state in place, and move/insert/remove
   only rows whose position or membership changed. Avoid replacing the whole
   list, sidebar, or app state subtree. Preserve scroll position, expanded
   sections, keyboard focus, and open popup state where the row remains valid.
7. **Recover from missed events:** realtime messages are hints, not a durable
   log. On reconnect, visibility regain where appropriate, or a detected
   version gap, refresh the authoritative snapshot and reconcile it through
   the same path. Write the resulting user-scoped last-known-good snapshot to
   storage for the next paint. A refresh failure must not erase a valid cached
   roster; retain it and mark it stale in state, with unobtrusive feedback only
   if useful to the user.

This roster should be a strong candidate for a shared keyed resource because
the sidebar is persistent while the outlet route changes, and other surfaces
may need unread counts or the selected thread. Keep it domain-modular: the
roster resource owns roster data/order and its event/reconcile policy, while
session, route, composer draft, and unrelated page results remain separate.
Cross-view consumers subscribe to the roster/unread resource rather than
copying arrays or relying on DOM events as the source of truth.

For high-frequency changes, coalesce redundant invalidations and render at most
once per animation frame, but do not debounce away meaningful latest state.
Protect local user intent during pending writes: e.g. pin/unpin should update
the optimistic order immediately and reconcile/roll back when the server
confirms or rejects it. A stale network response must not overwrite newer
message/realtime/mutation state; use versions, timestamps, or request
generation checks and merge only fields the response is authoritative for.

## UI state contract

For each asynchronous resource, distinguish at minimum:

| State | Meaning | Typical UI |
| --- | --- | --- |
| `idle` | Not requested yet / not applicable | No loading indicator unless the resource is needed now |
| `loading` | First usable value is not available yet | Stable skeleton/placeholder; `aria-busy` where useful |
| `ready` | Usable value arrived (including a valid empty value) | Render content or explicit empty state |
| `refreshing` | Usable prior value exists while a request is running | Keep content; subtle refresh feedback if helpful |
| `error` | No usable value exists because the request failed | Local, recoverable error + retry; do not render as empty |
| `stale-error` | Cached/prior value remains usable but refresh failed | Keep content and optionally indicate it may be outdated |

`null`, `[]`, and `0` can all be valid data. “Not loaded” must be represented
separately from those values. A successful empty result is not an error; a
failed request is not an empty result; and a refresh failure does not erase a
previously usable value.

When multiple fields arrive at different times, use per-resource/per-field
readiness rather than a single page-wide boolean if that avoids hiding usable
content. Loading indicators belong to the smallest region whose data is
actually pending. Give failures a recovery path and keep failures scoped so an
optional sidebar request cannot replace the whole outlet with an error.

## Ownership and synchronization rules

- **Server/API owns durable domain truth.** Bootstrap, browser caches, and
  realtime messages are snapshots, accelerators, or invalidation signals.
- **Application state owns the current in-memory client view.** It should have a
  clear owner and mutation path; UI components subscribe/render rather than
  inventing parallel copies.
- **URL owns navigable selection.** Router actions and browser history update
  it; route-aware views derive selected state from it.
- **View owns transient presentation state.** Open menus, current form errors,
  loading indicators, and route-local request lifecycles should not leak into
  global state unless another surface genuinely needs them.
- **Caches have explicit identity and validity.** Include viewer identity for
  private data, validate shape/version, and define staleness/invalidation.
- **Async work has a lifetime.** Abort or ignore stale requests after route
  disposal, logout/account switch, or a newer request supersedes an older one.
- **One change updates all dependent surfaces.** Mutations, route changes, and
  realtime invalidations should flow through shared state/router interfaces so
  sidebar, header, outlet, badges, and URL agree.
- **Errors are data, not exceptions to the UI model.** Normalize API/network
  failures at the boundary, preserve actionable status/details, log unexpected
  faults for diagnosis, and render a local fallback/retry rather than silently
  converting failure to `[]` or throwing away already-rendered content.

## Centralized management without a monolithic store

The goal is centralized *management*, not necessarily centralized *data*.
Avoid both extremes: every view inventing its own fetch/cache/loading/error
conventions, and one global store that owns every draft, menu, result list, and
temporary UI detail. Keep domain state modular and let its lifetime/scope match
who needs it, while giving all domains a shared, well-defined way to load,
observe, cache, invalidate, and report failures.

A useful separation is:

1. **Request layer (`client/api/`)** — performs HTTP, credentials, abort
   signals, response parsing, and consistent error normalization. Domain API
   modules (`files.js`, etc.) describe endpoints and payloads; views should not
   repeatedly hand-roll `fetch` parsing and status checks.
2. **Resource/lifecycle layer (`client/core/`)** — wraps a loader with explicit
   status, current data, error, refresh, cancellation, and optional cache and
   deduplication policies. It does not need to know how a particular page
   renders.
3. **Scope/registry layer (`client/core/`)** — decides who owns a resource. A
   view can create a local resource by default; if another view later needs the
   same data or its loading state, register/promote it under a stable key in an
   app-scoped registry. The resource contract stays the same; only its owner and
   lifetime change.
4. **View/component layer** — subscribes to the resource state and maps it to
   local UI: skeleton, cached content, inline refresh state, empty result, or
   recoverable error. Ephemeral state remains local unless there is a real
   cross-view consumer.

Conceptually, both local and shared use can follow one shape:

```js
const makeFilesResource = () => createResource({
  key: ['files', viewerId],
  load: ({ signal }) => filesApi.list({ signal }),
  cache: filesCache,
  maxAge: 5 * 60_000
});

// View-local by default:
const localResource = makeFilesResource();

// Promote/share only when needed; consumers subscribe to the same lifecycle:
const lease = appResources.acquire(['files', viewerId], makeFilesResource);
const sharedResource = lease.resource;
```

The VPS client now implements this shape in `client/core/resource.js` and
`client/core/resourceRegistry.js`; the snippet is illustrative usage, not a
prescription that every resource be app-scoped. Important properties are stable
resource identity, explicit ownership/release, and predictable transitions—not
a particular library or a mandatory global singleton.

The request wrapper and resource wrapper solve different problems. A shared
request function makes network behavior/error handling consistent even for a
one-off local view. A resource makes the result observable and gives loading,
cached/stale, refresh, and error states a reusable lifecycle. Sharing the
resource is an independent opt-in. A later cross-view consumer should be able
to subscribe to the same keyed resource (and therefore know it is loading)
without moving unrelated route state into a global store or changing the
endpoint call itself.

Cross-view loading should be shared only when it describes the same resource
operation. Do not make one global `isLoading` flag: it conflates independent
requests and makes one view's spinner affect another. A keyed resource can
expose `loading`/`refreshing` to any consumer while keeping unrelated resources
isolated. For work that is intentionally app-wide (for example session
refresh), expose a named app-level status with an explicit owner and meaning.

Promotion from local to shared should have clear rules:

- Use a stable key containing all identity dimensions (resource and, for
  private data, viewer/account id; include query/filter/page where applicable).
- Deduplicate equivalent in-flight reads only when their request semantics
  match; a caller's abort should not cancel work still owned by other consumers.
- Track subscribers/owners and release or abort work when the final owner leaves,
  unless a deliberate background-refresh policy retains it.
- Keep cache policy, freshness, invalidation, and mutation reconciliation
  attached to the resource/domain, not decided ad hoc by whichever view happens
  to render it.
- Scope mutation state separately when its lifecycle is action-specific; do
  not let a shared read resource hide submit/upload/delete progress.
- Make cross-view dependencies explicit. A mutation or realtime invalidation
  should update/invalidate the keyed resource, and all subscribed surfaces then
  converge through that one path.

This provides a central place in the codebase to understand and enforce data
behavior while preserving modular runtime state. It also gives a safe migration
path: start with a local resource, establish its correct lifecycle, and share
it only when a real second consumer appears.

## Current VPS status

The VPS client now has a small centralized data foundation: a common JSON
request/error boundary, observable resource lifecycle, app-scoped keyed resource
registry, and versioned storage-cache helper. This is deliberately separate
from `createAppState`, which remains a simple observable value holder rather
than a bucket for every domain. Files, sidebar roster, and credits are the
first resources. Files is cache-first and reconciles inline. Sidebar rows come
from authenticated mock-backed `/api/chat/threads` and `/api/servers` endpoints
with the `www` payload shapes, then cache per viewer; pin/hide/read actions
update the resource locally, and keyed row reconciliation preserves stable DOM
nodes. The credits modal/footer use `/api/credits` and `/api/credits/claim`,
with a viewer-scoped cached balance and server-authoritative daily claims.

The VPS roster API is currently a mock, so it does not yet receive actual
message, presence, or challenge realtime events. Shared sidebar and credit
resources revalidate on focus/visibility and periodically; live event
subscriptions and server-backed roster mutations remain follow-up work. When
adding them, route events through the roster resource's canonical update and
reconcile policy rather than adding independent DOM mutation paths.

As real domains are brought over from `www`, preserve the proven behaviors:
bootstrap for fast first paint, cache-then-network where stale display is safe,
explicit loading/empty/error distinctions, viewer-scoped private caches,
route-aware cancellation/disposal, and realtime invalidation followed by
authoritative reconciliation. Avoid one generic “fetch everything” mechanism;
generalize the lifecycle/state contract and API/cache/realtime plumbing while
letting each domain define its identity, freshness, and recovery semantics.

## Practical checklist for a new VPS data-backed view

1. Name the resource and its authority (URL, server, browser preference, draft,
   or realtime-derived invalidation).
2. Define its state shape and legal transitions before rendering it.
3. Decide whether bootstrap/cache can safely paint it before network freshness.
4. Specify identity, validation, staleness, and invalidation for any cache.
5. Make empty, loading, refreshing, first-load error, and stale-refresh error
   visibly and semantically distinct.
6. Ensure requests/subscriptions cannot update a disposed route or another
   signed-in user's state.
7. Route user actions through one mutation/state path; define rollback or
   reconciliation behavior.
8. Test direct URL load, internal navigation, Back/Forward, empty response,
   slow response, failed response, reconnect, and account change where relevant.
