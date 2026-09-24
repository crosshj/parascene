# Parascene VPS beta

This is the focused beta deployment, not a second copy of the full Parascene
application. `server.js` is the process entrypoint, `routes/` contains
route and middleware code, and `db/` composes focused Supabase adapters for
users, sessions, and profile files. Each route receives only the adapter it
uses. `pages/` contains server-rendered HTML modules (including `pages/index/` and
`pages/auth/`). The authenticated SPA source lives in `client/`: `app.js`
composes the application, `core/` owns routing and session infrastructure,
`api/` contains browser API clients, and `pages/` contains client-side page
modules. `public/` contains static assets.
Page assets are exposed at page-relative URLs such as `/auth/auth.css`, not
through a `/pages` URL namespace.

The current migration focus is the canonical `cdn.parascene.com` media-upload
boundary. The VPS will accept the existing browser upload contract, stream
request bodies to Supabase Storage, and keep storage credentials server-side.
See `MIGRATION_PLAN.md` for the implementation and cutover plan.

The authenticated beta SPA includes a client-side `/files` page. It calls the
owner-scoped `https://cdn.parascene.com/api/files` API to enumerate and stream
objects from the signed-in user's `prsn_misc/profile/{userId}` prefix. Requests
to the CDN hostname are host-gated: only CDN service routes are exposed, while
beta pages remain available only on the beta hostname.
