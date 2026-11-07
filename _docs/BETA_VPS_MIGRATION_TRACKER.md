# VPS migration checklist

## Priorities

1. **Restore admin** in the new WWW app; it is the largest missing operator capability.
2. **Verify current WWW journeys:** payments, OAuth welcome and public metadata; repair anything broken.
3. **Keep `sh` and `api` on Vercel** while they remain available and reliable.
4. **Move hostnames later**, only when retiring their Vercel owners and after beta verification.

## Detailed checklist

### Now: features missing from the new WWW app

- [ ] **Admin:** complete the legacy admin feature inventory using `_legacy/public/pages/admin.js` and `_legacy/api_routes/admin.js` as behavior references. The role-gated VPS entry point, shared navigation, tabs, tables and six pages (Users, Analytics, Jobs, Emails, Algo and Connect) now exist; continue from the [admin UI component inventory](ADMIN_UI_COMPONENT_INVENTORY.md).
- [ ] Port remaining admin functionality, including email template preview/manual send and conversation moderation, then compare each page against its legacy behavior.
- [ ] Verify authorization, search/pagination, errors, destructive actions and auditability across admin pages.
- [ ] **Payments:** the pricing UI now calls the Vercel API at `api.parascene.com`; Checkout can return to either `www` or `beta`. Verify Founder checkout, credit packs, return/cancel, switching to Free and webhook updates. Beta uses the existing live Stripe setup, so avoid test purchases that would charge real money.
- [ ] Verify WWW sitemap, robots, canonical URLs, redirects and public metadata; confirm apex DNS points to the VPS and permanently redirects to `https://www.parascene.com` with the path/query preserved.
- [ ] **Share:** VPS now serves the legacy share page, metadata, image/video/audio handlers, and authenticated link mint endpoint; beta and prod always mint `sh.parascene.com`. Focused route tests pass. Remaining: verify manually on beta, then cut over production `sh` DNS and verify its TLS certificate and crawlers.

### Later: when retiring Vercel owners

- [ ] Keep `api.parascene.com` on Vercel for payments and Stripe webhooks; no Stripe Dashboard or webhook URL change is part of the VPS migration.
- [ ] Port remaining non-payment API functionality only when retiring its current Vercel owner; preserve payment endpoints and webhook handling on Vercel.
- [ ] Move notification/jobs workers and creation callbacks, recovery and polling repair. Align published `/api/worker/create` with mounted `/api/create/worker`.
- [ ] Ensure one owner per schedule/queue/write path; verify retries, restart recovery, logs, alerts and rate limits before switching `api`.
- [ ] **WWW cutover:** verify user journeys, responsive behavior, media delivery, monitoring, backups and rollback before moving `www`.
- [ ] Confirm no runtime imports from `_legacy/`; retain a rollback path during CDN and hostname changes.

### Already ported; retain as regression coverage

- Help, signed-in app, Creation browsing, Feed, Doom Scroll and creation-detail overlay routing.
- Public `/blog` index and posts are served as a standalone server route.
- OAuth `/welcome` onboarding is served as a contained page module and resumes the pending same-site return path.
- Creation/provider-poll jobs currently use QStash to call the legacy API worker; local development runs those jobs in process. This is temporary ownership, not API-host cutover readiness.

For migration boundaries, implementation references and regression requirements, see [VPS/Beta migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).
