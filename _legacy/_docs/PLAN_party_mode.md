# Plan: Party Mode

POC at `/party`. Source: `pages/party.html`. Group state in `meta.party`.

## Shipped

- Logged-in route `/party`, footer link from Create
- Capture: native picker + in-app live viewfinder
- Landscape 16:9 → auto transform via `/api/create` (Grok i2i)
- Portrait / square → held in queue, no auto transform
- Held review: Transform (normalize to 16:9 + run) or Discard
- Queue: held / processing / ready / failed / pushed (committed)
- Review overlay, settings, party group sync, resume picker
- Google Photos on Push — uploads transformed creation to album named party name (find or create)
- Google Photos on discard from Pushed — remove from album when ids stored (needs edit scope + reconnect)
- Push still updates Parascene party group; GP skipped if not configured; redirect if not connected

## Not done

- Monolith split (`party.html` → modules)
- Link to grouped creation detail, publish / share from party page
- Nav entry beyond Create footer
- Real-time multi-device sync (pull on init + local actions only)
- Portrait/gyro live hold detection (disabled code blocks remain)

## Cross-device limits

- Metadata syncs via group `meta.party`
- Source JPEGs local only; transforms hydrate from group sources

## API

- `GET /api/party/groups`
- `POST /api/create/images/:id/party-settings`
- `POST /api/create/images/group` (party_name / party_settings)
- `POST /api/google-photos/upload` — optional `albumTitle` (party name)
- `POST /api/google-photos/remove` — `{ albumId, mediaItemIds[] }`

## Google Photos notes

- Party album = party name, else "Party Mode"
- New scope on connect: `photoslibrary.edit.appcreateddata` (remove from album)
- Existing connections need reconnect for remove

## Key files

- `pages/party.html`
- `api_routes/create.js`
- `api_routes/googlePhotos.js`
- `public/components/modals/share.js` (reference upload pattern)
