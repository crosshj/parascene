# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guide](VPS_MIGRATION_GUIDE.md) owns parity and cutover requirements; the [VPS deployment guide](VPS_DEPLOYMENT.md) owns deployment details.

## Remaining work

### 1. Finish admin behavior parity

- [ ] **Shared behavior and security:** compare search, filters, sorting, pagination, empty/loading/error states, and mobile behavior per page. Verify page and API role checks independently, no-store handling, destructive-action safeguards, and useful operator/audit feedback. Existing page shells and shared components do not establish parity.

### 2. Move the API off Vercel

- [ ] Inventory the API routes and external consumers currently owned by Vercel. Classify each as migrate, retire, or intentionally retain; the target is no Vercel API runtime.
- [ ] Port required endpoints into VPS-owned services while preserving request/response contracts, auth, authorization, rate limits, idempotency, and error behavior.
- [ ] Move payment endpoints and Stripe webhook handling, preserving the verified checkout/credit behavior. Update Stripe webhook configuration and API URLs only as part of the cutover.
- [ ] Move creation/provider-poll workers and callbacks off the legacy API worker. Define one owner for schedules, queues, writes, retries, polling, and restart recovery.
- [ ] Port the notifications/digest email worker into the root server, including its campaign queries and delivery-state updates; the legacy Admin Emails page's Run cron now action has no root-owned worker to invoke yet.
- [ ] Resolve the published `/api/worker/create` versus mounted `/api/create/worker` path discrepancy and verify every QStash callback targets the chosen endpoint.
- [ ] Move the `visit_pulse_flush` and `feed_beta_catalog_rebuild` jobs out of `_legacy/api_routes`; the QStash schedules currently target `/api/worker/jobs`, which the root app does not expose. Add root-owned handlers and update schedules while preserving cadence and behavior. Keep the existing `feed-beta` Redis key and schedule identifier stable unless changing them as part of a coordinated migration.
- [ ] Remove remaining `_legacy` imports from maintained scripts and tests. The current references are in feed/visit-pulse job scripts, blog migration, audio/video backfills and video metadata repair, debug/monitoring scripts, and `test/messages-presentation-parity.test.js`. Port only supported tooling to root-owned modules; retire obsolete one-off scripts or replace the test's source dependency with root-owned fixtures. Do not port the legacy DB wholesale to preserve scripts.
- [ ] Define cutover and rollback steps, then verify production journeys, responsive behavior, media delivery, monitoring, backups, and alerting before retiring the Vercel API deployment.
