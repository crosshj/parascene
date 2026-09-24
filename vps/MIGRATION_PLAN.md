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

The beta file API is a proof tool, not the www upload contract. www still uses
its existing `/api/images/generic` upload and retrieval behavior.

## Remaining: move www uploads to the CDN

The next migration is to send www uploads directly to the VPS and have media
reads use the CDN, without routing large request or response bodies through
Vercel. Preserve existing www behavior while changing the transport.

Before switching the www helpers:

- Implement the VPS compatibility API for `POST /api/images/generic`,
  `GET /api/images/generic/:key`, and `DELETE /api/images/:namespace/:key`.
  Preserve the request headers, response fields, ownership checks, key layout,
  and upload-kind behavior that current callers depend on.
- Allow credentialed requests from the www origin through the CDN CORS policy;
  keep the request identity compatible with www sessions.
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

## Out of this migration

Media optimization/transcoding, resumable uploads, a durable upload ledger, and
proper per-file sharing/privacy controls are separate work. Do not add those as
prerequisites to the www transport cutover unless an existing www upload flow
cannot be preserved without them.
