# Media upload rollout

## Beta/CDN proof

The beta proof is accepted. The authenticated beta SPA has a client-side
`/files` page that uploads, lists, previews, and deletes files in the signed-in
user's `prsn_misc/profile/{userId}` folder through `cdn.parascene.com`.

The beta API streams uploads up to 50 MiB, retains the original filename,
supports range reads for media, and limits listing and deletion to the owner.
The temporary `/s/{signed-key}/{filename}` link lets any signed-in Parascene
user who has the link view the file. It does not change the owner-only file
list, upload, delete, or content routes. These temporary links are signed with
`SESSION_SECRET`; rotating that secret invalidates them. Proper file sharing
and per-file visibility controls belong to later product work.

The beta file API is a proof tool, not the www upload contract. The VPS now
also exposes a compatibility `/api/images/generic` contract for www browser
uploads.

## In progress: move www uploads to the CDN

Browser generic, edited, and chat uploads now target the CDN by default. The
shared `ps_session` cookie and credentialed www CORS are supported, and the
client has a temporary legacy switch for rollback.

Chat uploads use the CDN Files endpoint's normal success response and place its
signed `file.public_url` (`/s/...`) in the message. Chat rendering treats those
share URLs exactly like pasted CDN share URLs. Message deletion removes only
the message; share-link-backed files are not auto-deleted.

The remaining migration is to validate the CDN path across www and finish
moving any server-side media helpers, without routing large request or response
bodies through Vercel. Preserve existing www behavior while changing the
transport.

Remaining before calling the cutover complete:

- ~~Implement the VPS compatibility API for `POST /api/images/generic`,
  `GET /api/images/generic/:key`, and `DELETE /api/images/:namespace/:key`.
  Preserve the request headers, response fields, ownership checks, key layout,
  and upload-kind behavior that current callers depend on.~~ Implemented in
  `vps/routes/generic.js`.
- ~~Allow credentialed requests from the www origin through the CDN CORS policy;
  keep the request identity compatible with www sessions.~~ Implemented in
  `vps/routes/middleware/filesCors.js` and the shared `ps_session` cookie.
- Return CDN-hosted media URLs and update URL consumers, renderers, and delete
  helpers so reads and deletes do not silently go back through www/Vercel.
- Preserve the existing public-read behavior needed by current creation and
  chat media references during this transport migration. The beta `/s/` link
  route's sign-in requirement is separate from that www compatibility policy.
- Keep Cloudflare, Nginx, the VPS, and Supabase size limits aligned. Confirm
  that the deployed Nginx configuration is managed by CI and keeps request
  buffering disabled for streamed uploads.

Then exercise the existing www flows against the CDN: generic and edited
images, chat media and files, creation inputs, comments, previews, playback,
and deletion. Include an unchanged file near the 50 MiB limit and verify its
byte count, range playback, owner behavior, and failure handling. Confirm the
upload body and media reads no longer pass through Vercel. Roll out behind a
reversible switch and retain the current www path as rollback until the CDN
path is stable.

## Follow-up: server-side media inspection and chat presentation

After the CDN transport is verified, add `ffmpeg`/`ffprobe` to the VPS media
runtime. Use them to inspect uploaded video/audio and generate reliable media
metadata and video posters server-side rather than depending on browser first-
frame behavior.

Then improve chat attachments using the existing creation video/audio player
patterns while keeping the semantics explicit:

- creations retain creation identity, creator/title context, and creation
  actions;
- uploaded videos render as file attachments with filename, size, duration,
  poster, playback, and download/open actions;
- uploaded audio uses the established player language but is labeled as an
  attachment, not a creation;
- images remain inline media and other files use a type/filename/size download
  card.

Preserve the current upload response fields while adding media metadata and
poster URLs needed by the richer attachment renderer.

## Out of this migration

Resumable uploads, a durable upload ledger, and proper per-file
sharing/privacy controls are separate work. Do not add those as prerequisites
to the www transport cutover unless an existing www upload flow cannot be
preserved without them.

[bump]
