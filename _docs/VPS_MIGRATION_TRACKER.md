# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guide](VPS_MIGRATION_GUIDE.md) owns parity and cutover requirements; the [VPS deployment guide](VPS_DEPLOYMENT.md) owns deployment details.

## Remaining work

### 1. Finish admin behavior parity

- [ ] Complete a page-by-page behavior inventory against the legacy admin as a read-only reference. Record which actions exist, are intentionally omitted, or are still missing; use the [admin UI component inventory](ADMIN_UI_COMPONENT_INVENTORY.md) for shared presentation patterns.
- [ ] Port remaining admin behavior, including email template preview/manual send and conversation moderation, if those remain required after the inventory.
- [ ] Verify role enforcement in both page and API access, plus search/pagination, error states, destructive actions, and auditability.
- [ ] Compare each admin page with its required behavior and record explicit exceptions. Existing page shells and shared components alone do not establish parity.

### 2. Move the API off Vercel

- [ ] Inventory the API routes and external consumers currently owned by Vercel. Classify each as migrate, retire, or intentionally retain; the target is no Vercel API runtime.
- [ ] Port required endpoints into VPS-owned services while preserving request/response contracts, auth, authorization, rate limits, idempotency, and error behavior.
- [ ] Move payment endpoints and Stripe webhook handling, preserving the verified checkout/credit behavior. Update Stripe webhook configuration and API URLs only as part of the cutover.
- [ ] Move creation/provider-poll workers and callbacks off the legacy API worker. Define one owner for schedules, queues, writes, retries, polling, and restart recovery.
- [ ] Resolve the published `/api/worker/create` versus mounted `/api/create/worker` path discrepancy and verify every QStash callback targets the chosen endpoint.
- [ ] Move the `visit_pulse_flush` and `feed_beta_catalog_rebuild` jobs out of `_legacy/api_routes`; the QStash schedules currently target `/api/worker/jobs`, which the root app does not expose. Add root-owned handlers and update schedules while preserving cadence and behavior. Keep the existing `feed-beta` Redis key and schedule identifier stable unless changing them as part of a coordinated migration.
- [ ] Remove remaining `_legacy` imports from maintained scripts and tests. The current references are in feed/visit-pulse job scripts, blog migration, audio/video backfills and video metadata repair, debug/monitoring scripts, and `test/messages-presentation-parity.test.js`. Port only supported tooling to root-owned modules; retire obsolete one-off scripts or replace the test's source dependency with root-owned fixtures. Do not port the legacy DB wholesale to preserve scripts.
- [ ] Define cutover and rollback steps, then verify production journeys, responsive behavior, media delivery, monitoring, backups, and alerting before retiring the Vercel API deployment.
