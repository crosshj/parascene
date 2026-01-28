# IMAGES/META + CREATION TOKEN PLAN

Start time: 2026-01-28T08:51:35Z
End time: 2026-01-28T09:06:43Z
Duration: 15 minutes 8 seconds

Estimated:
Time to implement end-to-end : ~4–8 hours.
Backend core : ~2–4h
Frontend : ~1.5–3h
Polish + edge cases + quick manual verification: ~0.5–1h

## HIGH LEVEL PLAN

*Follow this order when implementing.*

1. **Backend — job logic and scheduler:** Extract `runCreationJob(payload)` (provider call, upload, DB update). Add `scheduleCreationJob(payload)` (QStash if env set, else fire-and-forget inline). DB adapter: insert/update created_images with `meta` (and new columns if any).
2. **Backend — create and worker:** POST /api/create: validate, deduct credits, insert row (`status='creating'`, `meta` with creation_token, timeout_at, server_id, method, args), call scheduleCreationJob, return 200 with id. POST /api/create/worker: verify QStash signature, run runCreationJob; on failure update row to `failed`, refund credits, set meta.credits_refunded.
3. **Backend — reads and mutations:** GET /api/create/images and GET /api/create/images/:id return `meta` (incl. creation_token) and include rows with status `creating` and `failed`. Add POST /api/create/images/:id/retry (allowed only for failed or creating+past timeout). Relax DELETE /api/create/images/:id to allow delete for failed or creating+past timeout.
4. **Frontend — create flow:** Send creation_token in POST /api/create; store creation_token in pending item; on list, dedupe by creation_token and merge pending with API rows.
5. **Frontend — failed/creating UI:** Creations list and creation detail: show image-sized placeholder and Retry/Delete for failed or creating+past timeout. Use existing .route-media-error and .creation-detail-image-wrapper.image-error patterns.
6. **Frontend — creation details modal:** Add "Creation details" link in meta area on creation detail page; web component modal `app-modal-creation-details` showing server, method, args, duration from meta; optional Duplicate. Show link only when meta has relevant fields.

## MOTIVATION / GOALS
- Reliability + UX: current optimistic flow is buggy; "creating" items can disappear with no trace (no durable DB row for failures, and pending tiles are removed on both success/failure).
- Visibility + control: we want failed images to be visible, with best-effort failure reasons when possible, plus:
  - ability to retry generation using the same server/method/args as the original attempt
  - ability to give up by "deleting the image" (i.e., removing the creation record)
- Reproducibility: when an image completes, we want to know how it was created + how long it took so users can:
  - duplicate images they like (re-run generation with same params)
  - see (in UI) what inputs produced a given image

## CURRENT BEHAVIOR (END-TO-END)
- Frontend create UI: `static/components/routes/create.js`
  - On "Create", it immediately adds a local pending item to `sessionStorage.pendingCreations` with id like `pending-${Date.now()}-${rand}`.
  - It navigates to `/creations` optimistically.
  - It POSTs `/api/create` with `{ server_id, method, args }`.
  - On success OR failure, it removes the pending item from sessionStorage (so the optimistic entry disappears).

- Frontend creations list: `static/components/routes/creations.js`
  - Renders pending items (from sessionStorage) as `status="creating"` tiles.
  - Polls `/api/create/images` every 2s *only if* it sees DOM tiles with `data-status="creating"`.
  - Polling compares `data-image-id` to DB ids, but pending ids are `pending-*` strings, so it cannot ever match a DB row today.
    - This poller becomes useful if we switch to "insert row first" and use real numeric ids (or if we add creation_token-based matching).

- Backend create API: `api_routes/create.js` POST `/api/create`
  - Validates server + method.
  - Deducts credits BEFORE provider call.
  - Calls provider server via `fetch(server.server_url)` with `AbortSignal.timeout(30000)` (30s).
  - If provider returns non-2xx: credits are refunded; request returns 502; NO `created_images` DB row is created.
  - If provider fetch throws/timeout: credits are refunded; request returns 504/502; NO `created_images` DB row is created.
  - If provider succeeds: uploads image to storage; then inserts DB row in `created_images` with status `'completed'`; returns JSON containing the new `id`, `filename`, `url`, etc.

- Persistence today
  - There is NO durable "creating" row at request start.
  - There is NO durable "failed" row on provider failures (because insertion happens only after image bytes exist).
  - The only deletion of a created image row is explicit user action: DELETE `/api/create/images/:id` (and only for unpublished images).

## WHAT WE WANT
- Store generation details in `created_images.meta`:
  - Which server was called (server_id + server_url snapshot)
  - What method was called
  - What arguments were used
  - Timeout info used for later reads (so UI can decide "give up / failed / stale")
- Stop "losing" failed/abandoned creations (move away from "no row exists" on failure).
- Add a frontend-supplied `creation_token` to generation requests so optimistic entries can be deduped/merged with later reads.

## WHAT HAS CHANGED ALREADY
- DB schema: `created_images` now includes a `meta` JSON column
  - Supabase: `prsn_created_images.meta jsonb`
  - SQLite: `created_images.meta TEXT` (JSON string)

## WHAT MUST CHANGE (BACKEND)
- Implementation principle: modularize code reasonably/idiomatically (extract reusable logic into separate modules where justified).
- API contract: extend POST `/api/create` request body to include `creation_token` (random string generated client-side).
- Create flow should insert a row BEFORE provider call:
  - Insert `created_images` row with:
    - `status = 'creating'`
    - `meta = { creation_token, server_id, server_url, method, args, timeout_at, started_at, ... }`
    - `timeout_at` is a datetime/timestamp (ISO string) calculated as `now() + provider_timeout_duration` (e.g., now + 30s + small buffer)
  - On provider success:
    - Upload to storage
    - Update same row with `status='completed'`, `filename`, `file_path`, `width`, `height`, `color`, and optionally `meta.completed_at`
  - On provider failure/timeout:
    - Update same row with `status='failed'`, and store error details in `meta.error`; optionally set `meta.error_code` to `'timeout'` or `'provider_error'` (or similar) for UI display
    - DO NOT delete the row
  - On job failure: refund credits and record in `meta` that credits were refunded (e.g. `meta.credits_refunded: true`) so we can track whether a refund actually happened.
- Reads should return enough info for the UI to infer staleness:
  - UI can check `meta.timeout_at` against current time: if `now() > meta.timeout_at` and `status === 'creating'`, treat as failed/stale.
  - NOTE: with "creation_token in meta only" we cannot enforce uniqueness or do fast lookup without extra DB indexing; initial approach can scan recent user images and match `meta.creation_token` in app code.

### Retry
- **POST /api/create/images/:id/retry** — retries generation using same server/method/args from `meta`; calls `scheduleCreationJob` again (same row, same `creation_token`).
- Protections: only allow retry when row is `failed` or `creating` and past `meta.timeout_at`; reject with 400 if status is `creating` (in progress) or `completed`.

### Delete
- **DELETE /api/create/images/:id** — allow delete when:
  - status is `failed`, or
  - status is `creating` and `now() > meta.timeout_at` (exceeded timeout).
- Continue to allow delete for unpublished completed images; continue to disallow delete for published images.

## WHAT MUST CHANGE (FRONTEND)
- Generate `creation_token` per create click (random, statistically significant length).
- Include `creation_token` in the POST `/api/create` request.
- Optimistic item should store `creation_token` (not just a `pending-*` local id).
- When listing creations, dedupe/merge:
  - If DB returns a row with the same `creation_token`, replace the pending local entry with the real DB entry.
  - If no DB row appears and pending exceeds timeout, render as failed/stale.

## UI / UX AFTER THIS CHANGE

### Creation details ("how was this made")
- **Creation detail page:** Add a "Creation details" link in the meta area (e.g. near comments/likes). Clicking it opens a modal that shows how the image was generated (server, method, args, duration from `meta`), with optional "Duplicate" action to start a new creation with the same params.
- **Modal:** Implement as a **web component** modal, following the same approach as existing modals (`app-modal-publish`, `app-modal-credits`, etc.): e.g. `app-modal-creation-details`, defined in `static/components/modals/`, registered with `customElements.define`. Styles in `global.css` per project conventions.
- **Visibility:** Show the link only when `meta` contains the relevant fields (e.g. `server_id`, `method`, `args`). Hide for older rows without meta.

### Failed and timed-out images
- **Image-sized placeholder:** Failed (and timed-out "creating") items have no image URL. Use the **existing** broken/error placeholder treatment so failed items still get a consistent, image-sized block that looks intentional rather than a missing image.
  - **Creations list:** Reuse the same card layout; for `status === 'failed'` or (creating + past `timeout_at`), render the tile with the **same placeholder as load error** — e.g. `.route-media.route-media-error` (or equivalent) so the card keeps image dimensions and shows the existing error state (e.g. `--image-placeholder` background + `::after` icon/label). Existing patterns: `static/global.css` (`.route-media.route-media-error`), `static/components/routes/creations.js` (adds `route-media-error` on img error).
  - **Creation detail page:** For failed/timed-out, render the main image area with the **same** treatment as when an image fails to load: `.creation-detail-image-wrapper.image-error` (see `static/pages/creations.css` and `creation-detail.js`). So we get an image-sized placeholder, consistent with the existing "broken image" state, with optional short message (e.g. "This creation failed" / "Timed out") and actions (Retry, Delete).
- **Actions:** On both list and detail, failed/timed-out items show **Retry** and **Delete** where appropriate (detail page: clear primary/secondary; list: e.g. on the card or in a menu).

## DECISIONS
- **Status vocabulary:** Status values are exactly: `creating`, `completed`, `failed`. For `failed`, the reason (timeout, provider error, etc.) is stored in meta only (e.g. `meta.error` for message, `meta.error_code` for `'timeout'`, `'provider_error'`, etc.). No separate `timeout` status; UI can read `meta.error_code` to display "Timed out" vs "Failed" when needed.

## WORKER-ONLY FLOW (NO SYNC BEHAVIOR)
- We use only the worker flow: creation work (provider call, upload, DB update) always runs via "run creation job," never inline in POST /api/create.
- No sync fallback: POST /api/create never does the provider call itself; it only inserts the row and schedules the job.

## ABSTRACTION: LOCAL VS CLOUD (ONE CODE PATH)
- Module: `api_routes/utils/scheduleCreationJob(payload)` — single interface, different internal implementation.
  - Cloud (Vercel): checks if UPSTASH_QSTASH_TOKEN is set → publishes payload to QStash; QStash later calls POST /api/create/worker.
  - Local: no UPSTASH_QSTASH_TOKEN → invokes runCreationJob(payload) in-process without awaiting (fire-and-forget: void runCreationJob(payload).catch(log) or setImmediate).
- Callers (POST /api/create and, in cloud, the worker HTTP endpoint) call scheduleCreationJob(payload) — same API everywhere.
- Result: same app code path everywhere; no branching in route handlers on "am I local or cloud." Only the scheduler module's internals differ (enqueue vs fire-and-forget inline). Client behavior is the same: quick 200 with creation id, then polling sees completion.
- Env: if UPSTASH_QSTASH_TOKEN (or similar) is set, use QStash; otherwise run job inline (fire-and-forget). No need to "think about" the difference when writing features.

## QSTASH / WORKER DETAILS
- Architecture:
  - POST /api/create → inserts DB row with `status='creating'` + `meta`, calls scheduler (enqueue or inline), returns immediately.
  - Cloud: QStash calls POST /api/create/worker with signed payload; worker verifies signature, runs job logic, updates DB row.
  - Local: scheduler invokes runCreationJob(payload) in-process without awaiting (fire-and-forget); request returns immediately, job runs in same process; no worker HTTP call, no QStash.
- Worker URL for QStash: use `getBaseAppUrl()` from `api_routes/utils/url.js` to build the callback URL (e.g. `${getBaseAppUrl()}/api/create/worker`). Same pattern as elsewhere in the app.
- Env vars (cloud): UPSTASH_QSTASH_TOKEN, UPSTASH_QSTASH_CURRENT_SIGNING_KEY, UPSTASH_QSTASH_NEXT_SIGNING_KEY (already in .env).
- Timeout: "creating" rows that never complete are treated as failed once `now() > meta.timeout_at` (no process will complete them if request/worker was cut off).
- Implementation: modularize — shared "run creation job" (provider call, upload, DB update), scheduler (qstash vs inline), worker route (verify signature + call run job).

## WARNINGS / RISKS (double-check after implementation)

These areas are historically the most complex or error-prone. Verify each after all changes are complete.

- **Credits and refunds**
  - Credits are deducted in POST /api/create before the job runs. On job failure the worker must refund and set `meta.credits_refunded: true`. Risk: refund not run (worker crashes after provider failure, before DB update), or refund run more than once (QStash retry), or retry endpoint deducting again (retry must *not* deduct credits; the row already had credits deducted). Ensure retry reuses the same row and does not deduct a second time.
- **Worker endpoint security**
  - POST /api/create/worker must verify the QStash signature (e.g. Upstash receiver) before running any job. If verification is skipped or wrong, anyone can POST to the worker URL and trigger creation jobs. Treat as security-critical.
- **Local vs cloud scheduler branch**
  - The scheduler branches on presence of UPSTASH_QSTASH_TOKEN (or equivalent). If the condition is wrong (wrong env name, or inverted), production might run jobs inline (blocking the request) or local might try to enqueue (and fail). Verify the branch and env names in the deployed environment.
- **Status and meta updates**
  - Worker must update the same row from `creating` to `completed` or `failed` exactly once. Risk: worker crashes after provider success but before DB update (row stuck `creating`); or QStash delivers twice and we overwrite `completed` with `failed`. Consider checking current status before update (e.g. only transition from `creating`) and merging into `meta` (e.g. partial merge) so we don’t overwrite `creation_token` or other fields.
- **Retry and Delete allowed states**
  - Retry: only allow when status is `failed` or (`creating` and past `meta.timeout_at`). Reject with 400 when status is `creating` (in progress) or `completed`. Delete: only allow when `failed`, or (`creating` and past timeout), or unpublished completed; never allow delete of published. Wrong conditions can allow retry of in-progress (double job) or delete of published content.
- **Worker callback URL**
  - QStash needs the full worker URL. If `getBaseAppUrl()` is wrong in production (e.g. returns localhost or wrong domain), QStash will call the wrong place and jobs will never run. Confirm the value in production (and that it’s not overridden incorrectly by env).
- **Frontend dedupe and list payload**
  - Frontend matches pending items to API rows by `creation_token`. List and detail responses must include enough for the client to match (e.g. `meta.creation_token` or equivalent). If the API doesn’t return it, dedupe breaks and pending items never resolve.
- **Unhandled rejections (local fire-and-forget)**
  - Locally, `runCreationJob(payload)` is invoked without await. If it throws synchronously or the promise rejects, ensure `.catch(...)` (or equivalent) is attached so the process doesn’t get an unhandled rejection. Log and optionally update row to `failed` in the catch.
- **List includes creating/failed rows**
  - GET /api/create/images must return rows with `status = 'creating'` and `status = 'failed'` (not only completed), ordered so new creations appear (e.g. `created_at desc`). If the list query filters them out or order is wrong, the user won’t see their creation or failed items after the flow change.
