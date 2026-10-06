# Client providers

Providers group client data behavior by domain or capability, rather than by view or backend route. Each provider folder is a small boundary with a public `index.js`; add `api.js`, `model.js`, `query.js`, or other files only when that responsibility needs its own module. These are files within each provider folder, not shared top-level `api/` or `models/` layers.

- `api.js` owns HTTP calls and response validation.
- `model.js` owns domain data shaping when it is shared or substantial.
- `query.js` owns a domain query when it needs its own module. A query may cache results and notify subscribers as its state changes.
- `index.js` creates the provider and exposes the narrow interface its consumers use.

Not every provider needs every file. Small providers can keep their implementation in `index.js`; do not create empty modules to satisfy a template. The generic query/cache implementation stays in `core/` and is named for the query it provides. Views keep presentation and mounted-view work such as pagination, selection, local UI state, and DOM cleanup. A sidebar is a view that combines provider data and preferences, not a backend-shaped provider of its own.

Current folders:

- `threads/` supplies the conversation inbox snapshot—threads, server context, and unread summary—consumed by the Sidebar view. Servers and threads belong under this client capability because server channels participate in the same conversations; the sidebar model remains beside the Sidebar view because it shapes display, not thread data.
- `creations/`, `files/`, and `credits/` supply their respective APIs and queries.

The Creations provider also owns `thumbnails`: a viewer-scoped IndexedDB blob
cache for thumbnails belonging to the newest 30 grid cards. The view supplies
the retained URLs in list order, so browsing older pages does not evict recent
creations. The media loader resolves those URLs through the provider; other
images keep native loading. Full URLs, including blur/thumbnail variants, are
distinct keys. Cache misses deduplicate requests, storage/network failures fall
back to normal image URLs, and image decode failures invalidate the cached blob.
Normal teardown preserves disk entries; logout clears them and aborts downloads.
The cache uses `parascene-creation-thumbnails-v1:<viewerId>` and stores only
same-origin creation media variants, never original/full-resolution images.

## Why this is the next step for threads

WWW has two distinct realtime lifetimes that the VPS threads provider will need to represent:

- A user-scoped `user:<viewerId>` broadcast invalidates inbox/unread data. WWW responds by fetching the authoritative unread summary and, where appropriate, refreshing the thread list. This belongs to the app-level threads provider so Sidebar and other consumers can observe the same update.
- A room-scoped `room:<threadId>` broadcast invalidates messages for the conversation currently open. WWW binds it when a DM or channel thread opens, refetches messages on activity or reconnect, handles thread deletion, and tears the listener down when that conversation closes. This lifetime must follow the active conversation, not the app-wide inbox.

These broadcasts are hints, not message payloads: consumers refetch authoritative data. The VPS client currently has query providers and view-owned lifecycles, but no threads Realtime provider yet. Making the provider boundary clear first gives the WWW port a home for the app-wide inbox behavior and the route-scoped room behavior without putting either listener in the Sidebar presentation or duplicating it in Channel and DirectMessage views. Channel and DirectMessage remain distinct route views; they can consume the shared threads capability while keeping their route-specific presentation and setup.

This refactor is a working example of the provider pattern using existing app data. It establishes where APIs, domain shaping, cached queries, and later observables belong before the much larger chat port begins.
