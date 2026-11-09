# VPS migration tracker

This is an open-work list only. Completed ports and confirmed behavior are intentionally omitted. The [migration guide](VPS_MIGRATION_GUIDE.md) owns parity and cutover requirements; the [VPS deployment guide](VPS_DEPLOYMENT.md) owns deployment details.

## Remaining work

### 1. Finish admin behavior parity

- [ ] Decide which legacy-only tools remain operationally required (especially Todo, moderation, policy/cron controls, anonymous-user investigation, and provider/creation repair tools). The root admin currently has no matching page for these; record explicit retirements so parity scope is deliberate.
- [ ] **Jobs:** current root page is a read-only jobs and failed-try table. Compare legacy job detail/status/error visibility and any retry/recovery actions; port required actions with safe confirmation and visible result/error states.
- [ ] **Emails:** current root page has send history and automated-email settings only. Port template preview, recipient/template selection, one-recipient manual sends, feature-request replies, test sends, and broadcast audience preview/send. Preserve eligibility, duplicate-send protection, confirmation, and per-send reporting.
- [ ] **Algo:** current root page has transition rows and related-ranking weights. Port the transition graph and feed editorial pin editor/defaults; verify settings validation and saved values.
- [ ] **Connect:** current root page lists servers only. Port server detail/edit, test, and refresh actions, plus legacy conversation-thread moderation (inspect/delete) if still used. Preserve authorization and require confirmation for destructive actions.
- [ ] **Todo/work queue:** legacy admin opens on a Todo tool with list modes, item editing, dependencies, priority/impact/time controls, and read-only mode. Root `/` is only an overview and has no Todo page/API; decide whether this internal tool is still needed, then port it or explicitly retire it.
- [ ] **Moderation and policy operations:** legacy exposes moderation data, policy/provider inspection, general admin settings, and a run-notifications-cron action. Root has no corresponding admin page/routes; confirm which operations are still used and port the required subset with clear read/write boundaries.
- [ ] **Creation/provider support:** inventory legacy admin recovery actions (provider job probe/recovery, video upload/recovery, and related server operations). Root admin currently exposes none of these. Decide which are needed for production support, then port only those with auditable outcomes and safeguards.
- [ ] **Shared behavior and security:** compare search, filters, sorting, pagination, empty/loading/error states, and mobile behavior per page. Verify page and API role checks independently, no-store handling, destructive-action safeguards, and useful operator/audit feedback. Existing page shells and shared components do not establish parity.

### 2. Move the API off Vercel

- [ ] Inventory the API routes and external consumers currently owned by Vercel. Classify each as migrate, retire, or intentionally retain; the target is no Vercel API runtime.
- [ ] Port required endpoints into VPS-owned services while preserving request/response contracts, auth, authorization, rate limits, idempotency, and error behavior.
- [ ] Move payment endpoints and Stripe webhook handling, preserving the verified checkout/credit behavior. Update Stripe webhook configuration and API URLs only as part of the cutover.
- [ ] Move creation/provider-poll workers and callbacks off the legacy API worker. Define one owner for schedules, queues, writes, retries, polling, and restart recovery.
- [ ] Resolve the published `/api/worker/create` versus mounted `/api/create/worker` path discrepancy and verify every QStash callback targets the chosen endpoint.
- [ ] Move the `visit_pulse_flush` and `feed_beta_catalog_rebuild` jobs out of `_legacy/api_routes`; the QStash schedules currently target `/api/worker/jobs`, which the root app does not expose. Add root-owned handlers and update schedules while preserving cadence and behavior. Keep the existing `feed-beta` Redis key and schedule identifier stable unless changing them as part of a coordinated migration.
- [ ] Remove remaining `_legacy` imports from maintained scripts and tests. The current references are in feed/visit-pulse job scripts, blog migration, audio/video backfills and video metadata repair, debug/monitoring scripts, and `test/messages-presentation-parity.test.js`. Port only supported tooling to root-owned modules; retire obsolete one-off scripts or replace the test's source dependency with root-owned fixtures. Do not port the legacy DB wholesale to preserve scripts.
- [ ] Define cutover and rollback steps, then verify production journeys, responsive behavior, media delivery, monitoring, backups, and alerting before retiring the Vercel API deployment.
