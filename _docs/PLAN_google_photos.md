# Plan: Google Photos — album share

User connects Google and picks one album (default target). Share modal gains a row that feels like device image share: one tap, image lands in that album. Implementation is server-side upload into Google Photos Library API, not `navigator.share({ files })`.

## Progress

- **Current phase:** Done — edit this line when you advance (e.g. `Done`).
- **You** = your Google Cloud account, env files, deploy config, manual QA.
- **Build** = code and migrations in this repo (you or whoever implements).
- Check boxes `[ ]` → `[x]` as steps finish so anyone can see where things stand.

## Phase 1 — Google Cloud + env (you)

- [x] GCP project created (or reuse one you own). — *Parascene* project in use.
- [x] **Photos Library API** enabled for that project.
- [x] **OAuth consent screen** configured (app name, user support email, domain/branding as Google requires).
- [x] Scopes added on consent screen for v1: `photoslibrary.appendonly`, `photoslibrary.readonly.appcreateddata`.
- [x] **OAuth client** type *Web application* (server-side code exchange): created Client ID.
- [x] **Authorized redirect URI** registered: `https://www.parascene.com/api/google-photos/callback` (exact).
- [x] **Client secret** copied (if client type uses it); stored only in env / secret manager, never in git.
- [x] Env vars set on each environment (names can match what Phase 3 code reads, e.g. `GOOGLE_PHOTOS_CLIENT_ID`, `GOOGLE_PHOTOS_CLIENT_SECRET`).
- [x] If consent screen is in **Testing**: add Google accounts of testers under test users.

When Phase 1 is done, set **Current phase** to `Phase 2`.

## Phase 2 — Lock v1 choices (you, short)

- [x] **Video:** still frame only for v1 (match Device Image Share behavior).
- [x] **Albums:** single default album for v1.
- [x] **Connect UX:** Connections UI under `/integrations` (profile menu → Connections).
- [x] **Scopes:** `photoslibrary.appendonly` + `photoslibrary.readonly.appcreateddata`.

When done, set **Current phase** to `Phase 3`.

## Phase 3 — Backend: OAuth connect + token storage (build)

- [x] Env-loaded Google client id/secret (and redirect) wired read-side only.
- [x] `GET` **start**: `/api/google-photos/connect` redirects logged-in user to Google.
- [x] `GET` **callback**: `/api/google-photos/callback` exchanges code; persists refresh token; creates default album if missing.
- [x] Storage shape: dedicated table `prsn_google_photos_connections` (encrypted refresh token + album id/title).
- [ ] Optional: list albums (deferred; v1 uses single default album).

When callback + persistence work in dev, set **Current phase** to `Phase 4`.

## Phase 4 — Backend: album id + upload + disconnect (build)

- [x] Persist default **`albumId`** (created automatically on connect; stored with the connection).
- [x] `POST /api/google-photos/upload`: session auth + creation id, loads still image bytes, uploads via Library API, returns JSON errors for UI.
- [x] `POST /api/google-photos/disconnect`: clears Google tokens and album id for user.

When upload succeeds from curl or temporary UI, set **Current phase** to `Phase 5`.

## Phase 5 — Frontend (build)

- [x] Connections UI under `/integrations`: connect + disconnect + status.
- [x] Share modal `public/components/modals/share.js`: new row when configured; **not** gated on `canShareImageFiles()`.
- [x] Share row calls `/api/google-photos/upload`; uses existing CTA state pattern.

When it works in browser for one happy path, set **Current phase** to `Phase 6`.

## Phase 6 — QA + polish (you + build)

- [x] Supabase: `prsn_google_photos_connections` applied (schema `db/schemas/supabase_12_google_photos.sql`).
- [x] Happy path: OAuth, pick album, open share on a creation, tap row, image appears in that album.
- [ ] Revoke access in Google account settings → app shows reconnect, no stuck modal.
- [ ] Large image / timeout / API error → user-readable message, CTA resets.
- [ ] Disconnect in app clears row and server state.

When all checked, set **Current phase** to `Done` and keep this file as a record.

## Reference — where things live today

- Share modal: `public/components/modals/share.js` — device image share + `data-share-google-photos` → `POST /api/google-photos/upload`.
- Google Photos API routes: `api_routes/googlePhotos.js` (mounted in `api/index.js`).
- Image bytes: `api_routes/create.js` + `storage.getImageBuffer` (same still image as device share).

## Config vs per-user state

- **Env:** Google OAuth *application* credentials (client id, client secret, redirect base if not derived from app URL).
- **DB / grants:** per-user refresh token, scopes, chosen `albumId` — treat like other secrets; not committed to repo.

## Done when (acceptance)

- User can complete OAuth, pick album, see share row, tap once, find asset in chosen Google Photos album.
- Disconnect clears state; failures do not leave modal stuck.
