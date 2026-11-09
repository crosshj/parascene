# Plan: Reliable Parascene Blue creations

## Problem and target

Blue returns a job ID for image, video, and audio generation. Parascene must
poll that job, collect the finished media before Blue removes it, and commit a
terminal creation status. Today a QStash callback can be lost after a poll
finds the job still running. The next poll has been scheduled inside the
previous poll's 45-second lock, so it exits without scheduling another. The
legacy API repairs stale jobs on owner reads; the VPS read path had disabled
that repair. A finished Blue artifact can therefore remain `queued` or
`processing` in Parascene until it expires at Blue.

The target is that every accepted Blue job reaches `completed` or a truthful
terminal failure without a user opening a page. Duplicate callbacks, worker
restarts, slow transfers, and temporary provider or storage outages must not
create duplicate creations, duplicate refunds, or a dead poll chain.

## Current boundaries

- Both VPS sites publish creation and provider-poll jobs through QStash to the
  legacy `api.parascene.com` worker. The root app must not import `_legacy/`
  runtime code. Keep equivalent behavior in each deployed codebase until the
  worker moves to one canonical owner.
- `prsn_created_images.meta` currently holds provider job ID, status, next
  poll time, lock expiry, and error details. Polls rewrite the whole JSON
  value. This is vulnerable to competing updates.
- Blue's default output retention is one hour, subject to its deployment
  setting. Parascene's four-hour poll cap is not a safe collection deadline.
- Image, video, and audio share the async poll entrypoint, but their artifact
  conversion and storage paths differ. Cover/thumbnail work can outlast a
  quick status poll; video fetches are allowed up to ten minutes.

## Phase 0: stop the current loss

Deploy the current lock-handoff and VPS owner-read-recovery fixes to their
actual targets: the legacy API worker and both VPS sites. Verify a Blue
`text2image` and `image2video` job complete in Parascene without using
"Check again." The read recovery is a temporary backstop, not the long-term
driver of job completion. Recover live stuck rows while Blue still has their
artifacts; a `410` from Blue means the artifact can no longer be collected.

## Phase 1: durable job state and one poll owner

Add a dedicated `prsn_creation_provider_jobs` row keyed by creation ID. Store
the Blue server/method/job ID, phase (`waiting`, `collecting`, `completed`,
`failed`), `next_poll_at`, attempt and error summaries, Blue output expiry,
lease owner/token and expiry, and collection checkpoints. Keep the creation
row's existing status/meta fields as the client-facing projection during the
migration. Backfill in-flight Blue rows from existing metadata before turning
on the new runner.

Implement database-side atomic claim, lease renewal, release, and terminal
transition operations. A claim must require a due, nonterminal row with no
live lease. Every write from a worker must prove it still owns the lease token.
Use short renewable leases rather than a fixed lock that spans the next poll.
Release a lease after saving a nonterminal response, then publish the next
QStash wakeup. A second callback may safely find no due work and exit.

Keep one configured worker as the active executor. Beta and production may
observe the same rows, but they must not independently own poll chains. The
database claim is the final guard against duplicate callbacks and read repair.

## Phase 2: independent reconciliation

Run a separately scheduled reconciler at least once per minute. It queries
due jobs and expired leases, claims them in bounded batches, and republishes
or performs their next check. Its schedule must be independent of per-job
QStash messages and user page reads. Paginate so older jobs cannot be hidden
behind a fixed first page. Record the last successful sweep and alert if it
stops running.

Use Blue's reported `expires_at` when present. If it is absent, use a
conservative deadline shorter than Blue's configured output retention. Escalate
poll frequency when the job has succeeded but collection has not completed.
Do not keep showing "generating" after a known terminal provider error or
after Blue reports that output data was removed. The UI finish clock is a
display concern; it must not silently stop server reconciliation.

## Phase 3: idempotent artifact collection

Treat Blue success and Parascene completion as separate phases. A worker
claims `collecting`, fetches the artifact, renews its lease during long
downloads, converts or extracts media where needed, and uploads to storage.
Record a stable artifact identity or collection checkpoint before the final
creation update. A retry must detect an already-uploaded object and finish
the database commit without uploading another copy. Use a conditional
terminal transition so only one worker marks the creation completed and
applies any credit or audio-usage side effects. Clean up abandoned attempt
objects separately.

Preserve the existing media-specific behavior: image dimensions and PNG
normalization; video bytes, poster frame, dimensions, and source image; audio
CDN object, cover, and voice metadata. Provider failure and timeout refunds
must also be idempotent. A temporary provider, network, or storage error
should leave the job retryable until the artifact deadline, with a bounded
backoff and an explicit terminal reason at the end.

## Verification and rollout

1. Test the shared state machine with Blue-shaped responses for queued,
   running, succeeded media bytes, failed jobs, missing jobs, and expired
   output. Cover text/image-to-image, image-to-video, text/video-to-video,
   reference/video-to-video, and audio methods that are enabled in Parascene.
2. Inject duplicate and out-of-order QStash deliveries, a lost callback, a
   worker death during download, a lease expiry during upload, and transient
   Blue/storage errors. Assert one terminal row, one stored artifact, and at
   most one refund or usage charge.
3. Run the reconciler in report-only mode against beta, then enable a small
   batch of beta Blue jobs. Compare database state with Blue status and inspect
   storage before expanding to all beta jobs.
4. Run real beta image, video, and audio jobs without opening their pages.
   They must complete before Blue's output retention deadline. Repeat with
   the browser open, a forced worker restart, and a dropped poll callback.
5. Enable the same worker path for production. Monitor overdue due jobs,
   expired leases, time from Blue success to Parascene completion, collection
   retries, and Blue `410` responses. Keep the old read repair until the
   independent reconciler has demonstrated reliable completion, then remove
   the duplicate recovery path deliberately.

Completion means a finished Blue creation is collected and shown without
user action, and a failed or expired one receives a specific terminal state.
No accepted job may remain indefinitely `queued` or `processing` merely
because a callback or worker was lost.
