# External image sharing (absolute basics)

## What
Owner/admin can mint a **view-only** external share link (non-user), with optional **revoke-all**.

## No shares table
Use a **versioned URL path** and a **checked-in server-side version registry** (hard-coded is fine here):
- `v -> { secret, sig_bytes, payload_format }`
- Rotate by adding `v2` and minting new links at `/s/v2/...`.

Revocation: by version.\n\n- To revoke `v1`, remove/disable `v1` in the registry (or rotate the `v1` secret).\n- To keep old links working, leave `v1` enabled and mint new links at `v2`.

Minting: **always use the active/latest version** (e.g. `ACTIVE_SHARE_VERSION = 'v1'`). Callers do not choose the version.

## Token (terse)
URL carries version; token does not.\n\nToken: `t = p + '.' + s`
- `p`: base64url(payload_bytes)
- `s`: base64url(hmac_sha256(secret_for_v, p).slice(0,sig_bytes))

Payload bytes (v1, fixed-width big-endian, aggressive small widths):
- `image_id` (u24)
- `shared_by_user_id` (u24)

## API
- `POST /api/create/images/:id/share` (auth: any logged-in user with access to the image)
  - returns `{ url: /s/{ACTIVE_SHARE_VERSION}/:t/:bust }`
  - `bust` is a short cache-buster for social unfurl (e.g. base36 unix seconds). Keep it short; it’s okay if links differ per mint.
- `GET /api/share/v1/:t/image` (no auth)
  - verify sig via registry for `v1`, require `status='completed'`, stream bytes
  - `cache-control: no-store`

## Page
- `GET /s/v1/:t/:bust?` (no auth)
  - minimal viewer with `<img src="/api/share/v1/:t/image">`
  - noindex (`X-Robots-Tag` + `<meta name="robots" content="noindex,nofollow">`)
  - **unfurl-first meta tags** (make it look great on major platforms):
    - Open Graph: `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`
    - Twitter: `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`
  - set response headers to discourage caching: `cache-control: no-store`
  - cache busting: ensure `og:url` matches the full requested URL (including the trailing `/:bust`) so scrapers treat each mint as a new URL and re-fetch.

## UI
Creation detail (owner/admin): “Share externally” → calls share endpoint → copies URL.

## Examples (shape only)
Token: `t = p.s`

- Example (relative):
  - `/s/v1/AAECAwQFBgcICQ.7wQ2m5n8k1M/mb4z3a`

- Example (full):
  - `<app-origin>/s/v1/AAECAwQFBgcICQ.7wQ2m5n8k1M/mb4z3a` (app origin from `getBaseAppUrl()` / `APP_ORIGIN`)
