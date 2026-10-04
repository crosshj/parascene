# VPS migration tracker

Current outstanding migration scope. Update this checklist as items are verified; dated decisions and observations remain in the [cutover log](BETA_CUTOVER_LOG.md). Governing migration and cutover standards live in the [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).

## Completed migrations

- Create workflow and creation/conversation composers are ported to VPS-owned views, components, providers, uploads, and routes.

## Product surfaces

- [ ] Feed
- [ ] Challenges
- [ ] My Files presentation and behavior, using My Creations as the visual reference
- [ ] Comments
- [ ] Explore
- [ ] Library
- [ ] User menu: Profile, Connections, Settings, Help, Reports
- [ ] Sidebar plus controls and gear/settings control

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
