# Parascene VPS beta

This is the focused beta deployment, not a second copy of the full Parascene
application. `server.js` is the process entrypoint, `routes/` contains
route and middleware code, `db/` contains focused database adapters, and
`pages/` contains HTML page modules (including `pages/index/` and
`pages/auth/`), while `public/` contains browser/static assets.
Page assets are exposed at page-relative URLs such as `/auth/auth.css`, not
through a `/pages` URL namespace.

Initial responsibilities are shared Parascene authentication, basic profile
visibility, and later the canonical `cdn.parascene.com` media/upload boundary.
Supabase credentials remain server-side.
