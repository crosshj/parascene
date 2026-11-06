# Plan: Google Photos — remaining work

Shipped: OAuth via `/integrations`, default **Parascene** album, share-row upload, image-export rules match Device Image Share (owner / published / admin).

## QA (v1)

- Revoke Parascene in Google account settings → reconnect path works; share modal does not stay stuck.
- Large image / timeout / API error → readable message; Share CTA resets.
- Disconnect on `/integrations` clears server state and share row behavior.

## API limits (plan around these)

- App can only see **albums and media Parascene created** (post-2025 Library API).
- **No delete from user’s library** — Google does not expose that. “Delete” for items = **remove from album** (`albums.batchRemoveMediaItems`). Album **delete** is also not available via API; user deletes in Google Photos if needed.
- **Update** needs scope `photoslibrary.edit.appcreateddata` (add to consent screen + reconnect flow).

## Scopes

- Today: `appendonly`, `readonly.appcreateddata`.
- Add for CRUD: `photoslibrary.edit.appcreateddata` — update album title/cover, media description, add/remove items in albums, batch add to another app album.

## Albums (folders)

- **List** — `albums.list` (app-created only); show in `/integrations` or dedicated Google Photos section.
- **Create** — `albums.create`; user names folder; stop assuming single **Parascene** album only.
- **Read** — `albums.get` for one folder (title, cover, counts).
- **Update** — `albums.patch` (title, cover photo from app-created media).
- **Delete** — not in API; UI copy: remove in Google Photos app, or hide “delete album” in Parascene.

Storage: keep **default upload album** on connection row (`default_album_id`); full album list lives in Google, not duplicated in DB unless we cache ids/titles for offline UI.

## Media in album

- **List** — `mediaItems.search` with `albumId` (or list + filter app-created); paginate; show thumb via short-lived `baseUrl` from API (do not persist URLs).
- **Read** — `mediaItems.get` / `batchGet` for detail (description, dimensions, creation time).
- **Create** — already via share upload (`batchCreate` + album); extend to **choose target album** when user has multiple.
- **Update** — `mediaItems.patch` (description; maybe map Parascene creation id in description for traceability if useful).
- **Delete** — `albums.batchRemoveMediaItems` (remove from that album only; item may remain in library).

## Backend (new routes, sketch)

- `GET /api/google-photos/albums` — list.
- `POST /api/google-photos/albums` — create `{ title }`.
- `PATCH /api/google-photos/albums/:albumId` — update title / set as default for uploads.
- `GET /api/google-photos/albums/:albumId/media` — list items (cursor).
- `PATCH /api/google-photos/media/:mediaItemId` — update description.
- `POST /api/google-photos/albums/:albumId/media/remove` — `{ mediaItemIds[] }`.
- Adjust `POST /api/google-photos/upload` — optional `albumId` (default = connection’s default album).

## Frontend

- `/integrations` (or sub-section): album list, create folder, pick **default for share**, per-album “view items”.
- Album detail: grid of items, edit description, remove from album, open in Google Photos link if we have product URL.
- Share modal: if multiple albums, small picker or use default (settings wins).

## Order of work

1. Finish v1 QA above.
2. Add `edit.appcreateddata` scope + reconnect banner for existing users.
3. Album list + create + set default (unblocks multi-folder).
4. List media in album + remove from album.
5. Update album title + media description.
6. Share modal target album picker.

## Reference (shipped)

- Routes: `api_routes/googlePhotos.js`
- Share: `public/components/modals/share.js` → `POST /api/google-photos/upload`
- Export access: `api_routes/utils/resolveCreationImageForExport.js`
- DB: `prsn_google_photos_connections` (`album_id` / title = default target today)
