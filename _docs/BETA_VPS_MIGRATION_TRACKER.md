# VPS migration tracker

Current outstanding migration scope. Update this checklist as items are verified. Governing migration and cutover standards live in the [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).

## Remaining product work

The remaining product and cutover scope is listed below.

## Product follow-ups

- [ ] command-palette like we have in www, complete with keyboard shortcuts
- [ ] Serve the pricing view inside the app.
- [ ] Finish the sidebar plus controls and gear/settings control.
- [ ] Help page title shows "Help - Help - parascene" with redundant title which is not consistent with app title separators eg. "Creation · parascene beta"; and noting "beta" in title is not needed
- [ ] generations with the composer don't work right like generations from create form; they mess up on the lifecycle in creations list: queued, generating, done
- [ ] make sure NSFW settings work as they do in WWW, this means refreshing images that are blurred serverside when switching to unblurred - what I'm seeing is very, very inconsistent with www as related to settings and everywhere in the app
- [ ] don't show when "Untitled" on mobile vertical video cards
- [ ] daily credits claim. Sidebar credits indicator should have badge to indicate credits can be claimed
- [ ] beta PWA has issues with updating credits in the mobile header

## Public pages and discoverability

- [ ] Public share pages and their logged-out behavior
- [ ] Blog index, post pages, and publishing/admin workflow
- [ ] Stable public URLs, redirects, and social link previews for shared pages
- [ ] Crawler and indexability review: HTTP access/status, rendered content, robots directives, titles/descriptions, canonical URLs, sitemap coverage, image metadata/alt text, and applicable structured data
- [ ] Verify Google-rendered output with Search Console URL Inspection and test link previews with representative non-Google crawlers

## APIs, services, and administration

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
- [ ] Deployment readiness: secrets/configuration, process and schedule ownership, logs/alerts, backups/restore, rate limits, rollback, and removal of old-runtime dependencies

Resumable uploads, a durable upload ledger, per-file sharing/privacy controls,
richer duration metadata, and more reliable video posters are separate follow-up
work. They are not cutover requirements unless an existing upload flow depends
on them.
