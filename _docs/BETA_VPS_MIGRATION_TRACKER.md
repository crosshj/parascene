# VPS migration tracker

## Remaining product work

- [ ] I should be able to paste an audio creation that is not published into comments of another creation and have it play; for now it only shows up if I publish it - not ideal
- [ ] the thing that makes sounds in www when a notification is recieved - is that in vps now?
- [ ] feed should continue to add items on scroll, it does not - just frozen after a point and no new items added
- [ ] Audit CSS across vps. The same rules are redefined in too many stylesheets, and JS is doing layout, positioning, and presentation work that CSS should own. Find the duplicates and those script-driven styles, then fix them.

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

Resumable uploads, a durable upload ledger, per-file sharing/privacy controls,
richer duration metadata, and more reliable video posters are separate follow-up
work. They are not cutover requirements unless an existing upload flow depends
on them.
