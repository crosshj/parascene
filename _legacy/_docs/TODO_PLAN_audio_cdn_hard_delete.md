# Plan: validate audio CDN hard-delete

Code is in. Prod has not been proven. Do this before treating hosted audio Creations as done.

## What exists

Admin permanent delete (`DELETE /api/create/images/:id?permanent=1`) reads `meta.audio.cdn_id` and calls Blue `DELETE /cdn/objects/{id}` (`deleteCdnObjectBestEffort` in `api_routes/utils/blueCdn.js`). Blue removes the object dir, derived files, and leftover upload/link records.

Owner delete only marks the Creation unavailable. CDN bytes stay.

Cleanup is best-effort: if Blue fails, the Creation row is still gone and the object can remain on disk. The API still returns success.

Needs www (the hook) and Blue (the delete route) both in prod.

## Validate

- Import a local audio file so the Creation has `meta.audio.cdn_id`.
- Confirm the song plays (GET audio 302s to Blue).
- Owner-delete it: Creation gone from the owner list, CDN object still fetchable (mint a fetch link or check Blue disk).
- Admin permanent-delete a second import (or restore then perm-delete): Blue `DELETE` returns 200, object dir gone, a new fetch link 404s.
- Repeat with Blue unreachable or returning 5xx: Parascene delete still succeeds; note the leftover object for a later sweep.

## Done

- Permanent delete removes CDN bytes in prod.
- Soft-delete does not.
- Leftover objects after a Blue miss are understood (manual delete or a sweeper), not a surprise.
