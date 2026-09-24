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

The beta/CDN proof is accepted. The Files tool streams raw request bodies of up
to 50 MiB to Supabase Storage, supports owner-scoped hard deletion, and keeps
storage credentials server-side. The CDN also exposes the www-compatible
`/api/images/generic` contract, and browser generic/edited/chat uploads use it
by default. A temporary `legacyGenericUploads=1` URL flag or
`parascene:generic-upload-transport=legacy` local-storage value rolls a
browser back to the www path. Remaining production validation and server-side
media-helper work is summarized in `MIGRATION_PLAN.md`.

The VPS image includes `ffmpeg`/`ffprobe`; video uploads are normalized to
browser-streamable H.264/AAC MP4 with fast-start metadata while retaining the
original filename. Reliable video posters and richer file-versus-creation
presentation in chat remain follow-up work.

The authenticated beta SPA includes a client-side `/files` page. It calls the
owner-scoped `https://cdn.parascene.com/api/files` API to upload, enumerate,
stream, and delete objects from the signed-in user's
`prsn_misc/profile/{userId}` prefix. Requests to the CDN hostname are
host-gated: only CDN service routes are exposed, while beta pages remain
available only on the beta hostname.

The Files page also provides a temporary shared URL at
`https://cdn.parascene.com/s/{signed-key}/{original-filename}`. The signed key
keeps the bucket path and storage key out of the URL, and the original filename
is retained in the URL and download disposition. A valid Parascene sign-in and
the link are both required to view the file; the private listing, upload,
delete, and owner content routes remain owner-scoped. The link is temporary
proof behavior, not the final sharing model.

The host Nginx site is versioned at `infra/nginx/parascene.conf`. The CI deploy
installs it over the currently enabled `parascene` site, validates the complete
Nginx configuration, restores the prior file on failure, and reloads Nginx
before public health checks. Unless deployments run as root, the SSH deploy
user therefore needs non-interactive sudo permission for the required Nginx
backup, install, validation, reload, and cleanup commands. Certificates and
private keys remain host-owned and are never copied into the repository.
