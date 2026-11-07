# VPS migration checklist

## Priorities

1. **Restore admin** in the new WWW app; it is the largest missing operator capability.
2. **Verify current WWW journeys:** payments, blog, OAuth welcome and public metadata; repair anything broken.
3. **Keep `sh` and `api` on Vercel** while they remain available and reliable.
4. **Move hostnames later**, only when retiring their Vercel owners and after beta verification.

## Detailed checklist

### Now: features missing from the new WWW app

- [ ] **Admin:** inventory the legacy UI, endpoints and permissions; use `_legacy/public/pages/admin.js` and `_legacy/api_routes/admin.js` as behavior references.
- [ ] Add a role-gated VPS admin entry point. The current app only supports editing another user's profile; creation-detail admin actions also call routes that are not mounted.
- [ ] Port the seven legacy admin pages: Todo, Users, Analytics, Jobs, Emails, Algo and Connect. The page routes and placeholders now exist; replace each placeholder with its legacy page body and behavior using the [admin UI component inventory](ADMIN_UI_COMPONENT_INVENTORY.md).
- [ ] Restore user/profile/username and founder actions, credits, moderation, editorial pins, blog publishing, server/chat management, provider/job tools, and email/notification operations.
- [ ] Verify authorization, search/pagination, errors, destructive actions and auditability.
- [ ] **Payments:** test Founder checkout, credit packs, Checkout return, switching to Free, and Stripe webhook updates from the new app. Fix broken paths; leave healthy Vercel services in place for now.
- [ ] **WWW pages:** restore the blog index/posts and `/welcome` for incomplete OAuth profiles.
- [ ] Verify WWW sitemap, robots, canonical URLs, redirects and public metadata; fix what is missing or broken.
- [ ] **Share:** verify `sh.parascene.com/s/...`, logged-out previews, media and link previews still work on Vercel. Fix current breakage; otherwise defer migration.

### Later: when retiring Vercel owners

- [ ] **API hostname:** choose/configure a beta hostname, DNS/TLS and environment-specific callback origins.
- [ ] Port required billing endpoints, Stripe webhooks, integrations and API contracts when moving their current owner.
- [ ] Move notification/jobs workers and creation callbacks, recovery and polling repair. Align published `/api/worker/create` with mounted `/api/create/worker`.
- [ ] Ensure one owner per schedule/queue/write path; verify retries, restart recovery, logs, alerts and rate limits before switching `api`.
- [ ] **Share hostname:** choose/configure a beta host; port `/s/...` pages, media and crawler metadata; verify stable links before switching `sh`.
- [ ] **WWW cutover:** verify user journeys, responsive behavior, media delivery, monitoring, backups and rollback before moving `www`.
- [ ] Confirm no runtime imports from `_legacy/`; retain a rollback path during CDN and hostname changes.

### Already ported; retain as regression coverage

- Help, signed-in app, Creation browsing, Feed, Doom Scroll and creation-detail overlay routing.
- Creation/provider-poll jobs currently use QStash to call the legacy API worker; local development runs those jobs in process. This is temporary ownership, not API-host cutover readiness.

For migration boundaries, implementation references and regression requirements, see [VPS/Beta migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).
