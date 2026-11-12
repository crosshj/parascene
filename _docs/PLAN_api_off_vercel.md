# Plan: API off Vercel

The VPS already serves the site API. `api.parascene.com` stays on Vercel for Stripe and QStash. QStash schedules and `getQStashCallbackBaseUrl()` in `server/services/create/url.js` still target that host. The root app must not import `_legacy/`. Port the behavior into `server/`.

## Still only on Vercel

Stripe. No Stripe code under `server/`. Pricing is hardcoded to `https://api.parascene.com` in `client/views/Pricing/PricingView.js`. Handlers live in `_legacy/api_routes/user.js` and `_legacy/api/webhooks/stripe.js`.

- `POST /api/credits/checkout` and `POST /api/subscription/checkout` create Checkout sessions.
- `POST /api/subscription/checkout-return` records the return.
- `PUT /api/profile/plan` cancels the Stripe subscription and sets the plan back to free.
- `POST /api/webhooks/stripe` verifies the signature and handles `checkout.session.completed` (Founder grant of 700 credits, or a credit pack), `customer.subscription.deleted` (plan back to free), and `invoice.paid` with `billing_reason === "subscription_cycle"` (renewal credits).

Webhook helpers only in `_legacy`: `api_routes/utils/creditPacks.js`, `purchaseNotify.js`, `stripeInvoice.js`, `founderRenewalAdminNotify.js`.

Scheduled jobs. `POST /api/worker/jobs` does not exist on the VPS. `_legacy/api/worker/jobs.js` dispatches three types.

- `embedding` — `_legacy/api_routes/utils/embeddingJob.js`. Nothing in `server/` publishes or runs embedding jobs, so new creations are not getting embeddings from this app.
- `visit_pulse_flush` — `_legacy/api_routes/utils/visitPulseFlush.js`. The VPS records pulse data. The daily Redis-to-Postgres flush does not run here.
- `feed_beta_catalog_rebuild` — `_legacy/api_routes/feedBeta/catalogRebuild.js`, every 15 minutes. The VPS can build and read a catalog snapshot (`server/services/feed/ranking/catalogSnapshot.js`) but nothing calls `saveFeedCatalogSnapshotToRedis`. The feed still reads the Redis snapshot the Vercel cron writes.

Notification email cron. `POST /api/worker/notifications` is `_legacy/api/worker/notifications.js` plus `digestEmailSection.js` and `chatDigestEmail.js`. Hourly it sends the unread/chat digest, welcome, first-creation nudge, reengagement, and creation-highlight mail, and updates campaign state. The admin button is already on the VPS and returns 503 until the worker is wired (`POST /api/admin-tools/run-notifications-cron` in `server/routes/adminTools.js`).

Creation worker path. The job body is already on the VPS at `POST /api/create/worker` (creation, provider poll, landscape, audio cover). QStash is still published to `https://api.parascene.com/api/worker/create`, the thin Vercel function `_legacy/api/worker/create.js`. That function calls the same job runners. Missing piece: serve that path on the VPS and point `getCreationWorkerOrigin()` at it.

## Called by the current app, no VPS route

These hit `www` today and 404. They do not keep the Vercel API deployed.

- `POST /api/creations/transitions` and `GET /api/create/images/:id/children` from creation detail.
- `POST /api/create/landscape` and `POST /api/create/landscape/query`. `scheduleLandscapeJob` exists in `server/services/create/scheduleCreationJob.js` and is never called from a route.
- `POST /api/support-report`.
- `GET` and `PUT /api/profile/comment-stickers`.
- Blog admin: `/api/blog/posts`, `/api/blog/campaigns`, publish, archive, unpublish, tracked URL, analytics. `server/routes/blog.js` only serves the public `/blog` pages.
- `GET /api/policy`. The share page fetches it. The VPS only has `POST /api/policy/seen`, which sets the `ps_cid` cookie. The legacy route checks a Redis fingerprint and returns `{ seen }`.

## In `_legacy`, current client does not call

Leave these unless an external consumer still uses `api.parascene.com` for them: kiosk, `POST /api/landing/event`, `GET /api/templates`, the `/api/provider/*` self-register API, party groups, chat invites, `POST /api/feature-requests`, `GET /api/embeddings/search`, `GET /api/creations/:id/semantic-related`, and `GET /api/creations/:id/summary`. Explore semantic search is already on the VPS.

## Cutover order

1. Mount the three worker entrypoints on the VPS (`/api/worker/create` as an alias of the existing create worker, plus jobs and notifications) and port the three job handlers and the email cron.
2. Port Stripe checkout, plan cancel, and the webhook. Leave the raw body intact for signature verification.
3. Point QStash schedules and the creation-job publisher at the VPS. Then point the Stripe webhook and `PAYMENT_API_ORIGIN` at it.
4. Confirm one full cycle of each job and one test checkout before deleting the Vercel project.

The same-origin gaps (landscape, transitions, stickers, blog admin, policy read, support report) can land in the same port. They do not block the DNS cutover.
