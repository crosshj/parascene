# Plan: Party mode and Google Photos credentials

Party mode and Google Photos share-to-album already ship. On the VPS they stay dark until a new Google OAuth client exists. Feature leftovers stay in `_docs/PLAN_party_mode.md` and `_docs/PLAN_google_photos.md`.

`GOOGLE_PHOTOS_CLIENT_ID` and `GOOGLE_PHOTOS_CLIENT_SECRET` were stored on Vercel and in a local `.env`. Vercel will not show the secret again. That local file was wiped. Create a new OAuth client in Google Cloud and copy both values out of that screen once.

Put them on the same path as the Stripe keys. GitHub environment `beta`, then the fixed list in `scripts/deploy-from-ci.sh`. The deploy rewrites each slot's `.env` from that list, so a name that is only in the Google console never reaches the box. The next deploy of a slot is what writes the file and restarts that container.

A new client invalidates connections made with the old one. People reconnect from `/integrations`. Party push uploads to an album named for the party. Remove-from-album still needs the edit scope and a reconnect, which the party plan already tracks.

Done when a deploy has both values in the runtime env, and a connected account can push a party photo to its album.
