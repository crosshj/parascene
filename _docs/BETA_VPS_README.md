# Parascene VPS beta

This is the focused beta deployment, not a second copy of the full Parascene
application. `server/server.js` is the process entrypoint, `server/routes/` contains
route and middleware code, and `server/db/` composes focused Supabase adapters for
users, sessions, and profile files. Each route receives only the adapter it
uses. `server/pages/` contains server-rendered HTML modules (including `pages/index/` and
`pages/auth/`). The authenticated SPA source lives in `client/`: `app.js`
composes the application, `core/` owns routing and session infrastructure,
`api/` contains browser API clients, and `pages/` contains client-side page
modules. `public/` contains static assets.
Page assets are exposed at page-relative URLs such as `/auth/auth.css`, not
through a `/pages` URL namespace.

The beta/CDN proof is accepted. The Files tool streams raw request bodies of up
to 50 MiB to Supabase Storage, supports owner-scoped hard deletion, and keeps
storage credentials server-side. The CDN also exposes the www-compatible
`/api/images/generic` contract, and browser generic/edited/chat uploads use it
by default. A temporary `legacyGenericUploads=1` URL flag or
`parascene:generic-upload-transport=legacy` local-storage value rolls a
browser back to the www path. Remaining production validation and hardening is
tracked in [`BETA_VPS_MIGRATION_TRACKER.md`](BETA_VPS_MIGRATION_TRACKER.md).

The VPS image includes `ffmpeg`/`ffprobe`; video uploads are normalized to
browser-streamable H.264/AAC MP4 with fast-start metadata while retaining the
original filename. Chat now distinguishes files from creations while using
the creation-style media presentation: shared audio uses the same Suno-like
player, embedded artwork or a generated fallback, and a download action.

The authenticated beta SPA includes a client-side `/files` page. It calls the
owner-scoped `https://cdn.parascene.com/api/files` API to upload, enumerate,
stream, and delete objects from the signed-in user's
`prsn_misc/profile/{userId}` prefix. Both beta and prod mint media URLs on
`cdn.parascene.com`. Beta also accepts manually addressed CDN paths on
`beta-cdn.parascene.com` for testing. Beta's API and share handlers are also
available at `beta-api.parascene.com` and `beta-sh.parascene.com`. These
beta-prefixed hosts are manual test aliases only; the app always mints links to
the canonical `api`, `cdn`, and `sh` hosts.

## Local development

From the repo root, install dependencies and run:

```sh
npm install
npm run dev
```

This starts the Express beta server and Rollup in watch mode together. Changes
to `client/` rebuild the hashed JS/CSS assets; changes to server modules restart
the server; changes to page HTML/CSS are served on the next browser refresh.
The launcher preserves the calling shell's `NODE_ENV` (defaulting to
`development` when unset) and sets `LOCAL_REPORTS_ENABLED=1` so local reports
also work when the shell uses production mode.
Open the local beta origin printed by the server (normally
`http://localhost:3000/`). The first dev loop intentionally uses a normal
browser refresh rather than runtime style injection or hot-module replacement,
so the behavior remains close to the production asset path.

The Reports account-menu item opens the HTML analytics dashboard at
`http://localhost:3000/reports/` (or `/reports/` on the configured local port).
Refresh its data from the repo root with
`node scripts/analytics/overview-refresh.js`, then reload the report. Add
`--full` to rebuild the snapshot or `--no-live` to skip Redis. The server serves
the app's JavaScript, shared CSS and `.output/overview/store.json` beneath
`/reports/`; these routes are available only in local development.
Report requests must come directly from a loopback connection. Production
deployments leave the route disabled unless `LOCAL_REPORTS_ENABLED=1` is set.

The Files page also provides a temporary signed URL at
`https://cdn.parascene.com/s/{signed-key}/{original-filename}`. The signed key
keeps the bucket path and storage key out of the URL, and the original filename
is retained in the URL and download disposition. A valid Parascene sign-in and
the link are both required to view the file; the private listing, upload,
delete, and owner content routes remain owner-scoped. The link is temporary
proof behavior, not the final sharing model.

The host Nginx site is rendered from `infra/nginx/parascene.conf`. A push to
`beta` installs `parascene-beta` and proxies that site's names to port 3000.
A push to `main` installs `parascene-prod` and proxies `www.parascene.com`,
`cdn.parascene.com`, and (after its DNS cutover) `sh.parascene.com` to port
3001. The production apex `parascene.com` permanently redirects to
`https://www.parascene.com`, preserving path and query. The prod deploy checks
that its origin certificate covers the apex before enabling that redirect.
Keep the Cloudflare apex A record proxied and use Full (strict) SSL/TLS; keep
the apex redirect at the origin as a fallback and canonical signal. The API
remains on Vercel for payments and webhooks.
Both VPS sites publish creation and provider-poll jobs through QStash to the
legacy `api.parascene.com` worker. Local development runs those jobs in process.
Each deploy validates the complete Nginx configuration, restores the prior
file on failure, and reloads Nginx before public health checks. Unless
deployments run as root, the SSH deploy user therefore needs non-interactive
sudo permission for the required Nginx backup, install, validation, reload,
and cleanup commands. Certificates and private keys remain host-owned and are
never copied into the repository.
