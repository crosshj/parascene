# Media upload rollout — remaining work

The beta/CDN implementation and the browser upload transport are complete.
This document tracks only work that remains before treating the CDN path as
fully rolled out.

## Production validation

Exercise the deployed CDN path across the existing www flows:

- generic and edited image uploads;
- chat media and file uploads;
- creation inputs, comments, previews, and playback;
- owner listing and deletion behavior;
- signed share links, including cross-origin image, audio, and video reads;
- uploaded audio artwork/fallback and download behavior;
- uploaded video playback and range requests;
- an unchanged file near the size limit, including byte count and failure
  handling;
- owner isolation and invalid/deleted share-link behavior.

Confirm that large upload bodies and media reads do not pass through Vercel.

## Cutover hardening

- Keep Cloudflare, Nginx, VPS, and Supabase size limits aligned.
- Confirm the deployed Nginx configuration is managed by CI and keeps request
  buffering disabled for streamed uploads.
- Roll out behind the existing reversible switch and retain the legacy www
  path as rollback until the CDN path is stable.
- Remove the temporary legacy transport switch after the rollout has been
  accepted in production.

## Optional follow-up

Reliable video posters, richer duration metadata, and additional media
metadata can be added later. They are not prerequisites for the CDN cutover.

## Out of this migration

Resumable uploads, a durable upload ledger, and proper per-file
sharing/privacy controls are separate work. Do not add them as prerequisites
unless an existing upload flow cannot be preserved without them.
