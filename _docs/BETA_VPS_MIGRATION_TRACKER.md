# VPS migration tracker

## Before prod

Help, the signed-in app, and the pricing screen already run here. The pricing screen calls billing routes that still live on the current site. The remaining product surface is admin, share pages, blog, and Stripe.

- Admin. The admin console is still the old app. This app only saves another user's profile. Creation-detail admin actions call routes that are not mounted here.
- Share pages. The share hostname already allows `/s/...`, and share tokens are already minted for media. Nothing renders the public share page or its logged-out preview.
- Blog. Published posts already show on the first feed page and link to `/blog` and `/blog/{slug}`. Those pages, and the editor, are not served here.
- Stripe. Founder checkout, credit-pack checkout, the return from Checkout, and switching back to Free. The webhook at `/api/webhooks/stripe` writes the plan and grants credits after Checkout.

The overview leaves out the work that still runs only because `api.parascene.com` points at the current site:

- Hourly notification email, at `/api/worker/notifications`
- The jobs worker, at `/api/worker/jobs`: visit-pulse flush, feed catalog rebuild, and embeddings
- Creation callbacks. This app publishes those to `/api/worker/create`. The route it mounts is `/api/create/worker`. On the container, new creations run in-process, so that mismatch shows up when an outside callback hits the container.

Those have to move before `api` points at the prod container. Standing the container up while `www` and `api` stay where they are does not need them.

Two smaller holes sit next to that list. OAuth consent sends an unfinished profile to `/welcome`, and that page is not in this app. Social link previews and the sitemap belong with the share and blog pages.

## Public pages and discoverability

- [ ] Public share pages and their logged-out behavior
- [ ] Blog index, post pages, and publishing/admin workflow
- [ ] Stable public URLs, redirects, and social link previews for shared pages
- [ ] Crawler and indexability review: HTTP access/status, rendered content, robots directives, titles/descriptions, canonical URLs, sitemap coverage, image metadata/alt text, and applicable structured data
- [ ] Verify Google-rendered output with Search Console URL Inspection and test link previews with representative non-Google crawlers

## APIs, services, and administration

- [ ] Hook up Stripe before the pricing overlay can complete a purchase. Founder checkout, credit-pack checkout, the return from Checkout, and switching back to Free still need the www billing endpoints (`/api/subscription/checkout`, `/api/credits/checkout`, `/api/subscription/checkout-return`, and `/api/profile/plan`), including plan and subscription updates on the user record.
- [ ] Inventory WWW API contracts and verify each required endpoint, authorization rule, and data behavior on VPS
- [ ] Inventory and port required background services: scheduled work, queues, retries/recovery, media processing, catalog/feed rebuilds, notifications, and realtime
- [ ] Inventory external integrations and callbacks: storage/CDN, generation providers, billing, email, OAuth, and webhooks
- [ ] Migrate the full admin surface and its permissions; refactor into VPS-owned modules where useful without dropping existing actions

Likely future direction for rich links: have the client ask the server for a preview card. The server should return a translated card when it recognizes the URL, or an explicit result explaining that it could not translate the request. This keeps provider-specific URL interpretation out of individual client renderers.

## Conversation follow-up

- [ ] Private channel creation and invitations
- [ ] Canvas notifications and remaining canvas controls
- [ ] Thread creation and server directory/management

## Cross-cutting and cutover

- [ ] Mobile/responsive review across migrated routes and overlays
- [ ] Verify loading, empty, error, authorization, pagination, and recovery states across routes
- [ ] Verify deep links, Back/Forward, refresh, and stable shared URLs
- [ ] Validate generic and edited image uploads, chat attachments, creation/comment inputs, previews and playback, owner listing/deletion, signed cross-origin media links, audio artwork/downloads, video range playback, near-limit files, and owner isolation
- [ ] Confirm large upload bodies and media reads bypass Vercel; align Cloudflare, Nginx, VPS, and storage limits; verify CI-managed Nginx streaming configuration
- [ ] Complete the reversible CDN rollout, retain the WWW transport as rollback until stable, then remove the temporary legacy transport switch
- [ ] Creation videos follow the files video path. Local dev serves them on the local host. Beta and prod send playback only through `cdn.parascene.com`, with a signed link a video element can load without the session cookie. Do not leave playback on the app host or on a raw Supabase signed URL.
- [ ] Deployment readiness: secrets/configuration, process and schedule ownership, logs/alerts, backups/restore, rate limits, rollback, and removal of old-runtime dependencies
- [ ] Align the beta deploy names with prod. The home directory is parascene-vps and the container is parascene. Prod uses parascene-prod for both. Switch beta to home directory parascene-beta and container parascene-beta. Before the first deploy that uses those names, stop and remove the live parascene container or rename it, and rename or leave the old home directory. It still holds port 3000, so the new container will not start until it is gone. The Nginx site is already parascene-beta. The image tag stays parascene:beta.

Resumable uploads, a durable upload ledger, per-file sharing/privacy controls,
richer duration metadata, and more reliable video posters are separate follow-up
work. They are not cutover requirements unless an existing upload flow depends
on them.
