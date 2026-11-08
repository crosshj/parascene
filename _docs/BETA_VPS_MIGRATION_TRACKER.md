# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md) owns port boundaries and regression expectations; the [VPS README](BETA_VPS_README.md) owns deployment topology.

## Remaining work

### 1. Finish admin behavior parity

- [ ] Complete a page-by-page behavior inventory against the legacy admin as a read-only reference. Record which actions exist, are intentionally omitted, or are still missing; use the [admin UI component inventory](ADMIN_UI_COMPONENT_INVENTORY.md) for shared presentation patterns.
- [ ] Port remaining admin behavior, including email template preview/manual send and conversation moderation, if those remain required after the inventory.
- [ ] Verify role enforcement in both page and API access, plus search/pagination, error states, destructive actions, and auditability.
- [ ] Compare each admin page with its required behavior and record explicit exceptions. Existing page shells and shared components alone do not establish parity.

### 2. Close public-site and share verification

- [ ] Deploy and verify the VPS-owned `/sitemap.xml` and `/robots.txt` endpoints. Live `/sitemap.xml` and `/sitemap_index.xml` currently return 404; the current live `robots.txt` is Cloudflare-managed and does not reference the sitemap.
- [ ] Configure production so `robots.txt` matches legacy behavior: `User-agent: *`, `Allow: /`, and the canonical sitemap declaration. The current Cloudflare-managed response differs and does not reference the sitemap.

### 3. Resolve API and background-job ownership before any API retirement

- [ ] Decide whether the legacy API worker remains an intentional long-term owner or will be ported. Keep the payment API and Stripe webhooks on Vercel unless a separate, deliberate payment migration is approved.
- [ ] If retiring or moving the worker, define one owner for schedules, queues, callbacks, writes, retries, and polling; specify restart recovery, logs, alerts, and rate limits.
- [ ] Resolve the published `/api/worker/create` versus mounted `/api/create/worker` path discrepancy and document the chosen endpoint before changing job routing.
- [ ] Verify the transition and rollback path before changing QStash destinations or worker ownership.

### 4. Maintain production operational readiness

- [ ] Confirm the production user journeys, responsive behavior, and media delivery against the active WWW reference.
- [ ] Confirm monitoring, backups, and a tested rollback procedure for the VPS-hosted production site.
- [ ] Keep the app import boundary clean: no runtime imports from `_legacy/`, and pass the repo-root build before frontend changes are considered complete.
